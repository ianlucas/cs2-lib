/*---------------------------------------------------------------------------------------------
 *  Re-encodes the sticker textures bound to a small set of target material properties, writing the
 *  result under scripts/workdir/output so we can eyeball the size win in cs2-3d-viewer without re-
 *  running the whole item-generator. Filenames (and their embedded hashes) are preserved on
 *  purpose — see opt-testing.txt.
 *
 *  Each texture is (re)encoded from its PRISTINE decompiled PNG source, located via the item-
 *  generator's webp-jobs manifest, NOT from the output WebP. That makes every run idempotent:
 *  quality never compounds across runs and there is no need to reset workdir from a baseline.
 *  `.unoptimized-output` is consulted read-only, only to size the lossless "before" for the report.
 *
 *  Usage: npx tsx scripts/tool-reencode-stickers.ts [outputDir] [--dry]
 *         (outputDir defaults to scripts/workdir/output)
 *--------------------------------------------------------------------------------------------*/

import { existsSync, readFileSync, statSync, writeFileSync } from "fs";
import { basename, join } from "path";
import sharp from "sharp";
import { CS2Economy, type CS2EconomyItem } from "../src/economy.ts";
import { CS2_ITEMS } from "../src/items.ts";
import { english } from "../src/translations/english.ts";

// The item-generator writes this manifest (src PNG -> staged webp) when it encodes textures. We
// only need the `src` side: a decompiled PNG whose basename (minus .png) is `<base>_<srchash>` —
// exactly the output filename with its trailing `_<outhash>.webp` removed.
const WEBP_JOBS_MANIFEST = "scripts/workdir/item-generator/build/webp-jobs.jsonl";
const BASELINE_DIR = ".unoptimized-output"; // read-only: lossless "before" sizes for the report

const DEFAULT_OUTPUT_DIR = "scripts/workdir/output";

// Per-property encode tiers. Tweak these to iterate. `quality` for a near-lossless job is the
// near-lossless *level* (higher = closer to lossless, larger); for a lossy job it is the usual
// VP8 quality. `exact` stays on everywhere: shader logic reads RGB under transparent pixels.
//   stripAlpha      drop the alpha channel before encoding. Use only when alpha is unused (per the
//                   property catalog) — it both frees a channel and dodges the webp trap where a
//                   fully-zero alpha makes lossy VP8 discard the RGB as "nothing shown".
//   minWidth        only touch textures at least this wide; narrower ones are already small.
//   maxWidth        downscale (Lanczos, aspect-preserving) so the long side is at most this. Values
//                   stay exact under lossless — no ringing/bleed — so it is the safe lever for a
//                   compositing mask whose values matter but whose spatial detail can be reduced.
//   smartSubsample  force 4:4:4 (no chroma subsampling). REQUIRED when RGB pack independent data
//                   masks rather than a color, or 4:2:0 bleeds the channels into each other.
type Tier = {
    mode: "near-lossless" | "lossy" | "lossless";
    quality: number;
    stripAlpha?: boolean;
    minWidth?: number;
    maxWidth?: number;
    smartSubsample?: boolean;
    // Gloss-aware exemption (texture-driven, no name/material lists): measure the Nth percentile of
    // `channel` from the pristine PNG; if it is below `below`, the surface is glossy enough that lossy
    // would facet its normals — so keep that texture LOSSLESS instead of applying this tier. For
    // g_tNormalRoughnessSticker0 the roughness is packed in B (channel 2); low roughness = glossy.
    glossyExempt?: { channel: number; percentile: number; below: number };
};
const TARGETS: Record<string, Tier> = {
    // Sticker normal (RG=hemi-oct normal, B=roughness, A=self-illum). Lossy facets normals on GLOSSY
    // stickers (even q95); gloss-aware lossy left the glossy tail heavy. Back to lossless-downscale
    // to 512 for ALL — exact values (no faceting), lower spatial detail, uniform small output.
    g_tNormalRoughnessSticker0: { mode: "lossless", quality: 100, maxWidth: 512 },
    // g_tNormal left LOSSLESS: lossy (even q95) facets normals on glossy stickers (e.g. BIG (Gold)).
    // Only ~7 stickers carry a real one (~3 MB total), so the win never justified the artifacts.
    g_tSticker0: { mode: "lossy", quality: 90 },
    g_tColor: { mode: "lossy", quality: 90 },
    // Holo spectrum is an RGB view-angle gradient LUT with a dead alpha channel; lossy-compress
    // the wide (>=1024) ones and drop the alpha rather than downscaling the gradient.
    g_tHoloSpectrumSticker0: { mode: "lossy", quality: 90, stripAlpha: true, minWidth: 1024 },
    // SFX mask is a high-entropy holo pattern that GATES the spectrum composite, so lossy value
    // error shifts the rendered holo (confirmed bad even at q95). Instead keep values exact
    // (lossless) and only downscale the 1024^2 ones to 512 — clean detail reduction, no artifacts.
    g_tSfxMaskSticker0: { mode: "lossless", quality: 100, maxWidth: 512 }
};

const isTextureRef = (value: string): boolean => /^\/textures\/.+\.webp$/.test(value);
const isMaterialRef = (value: string): boolean => /^\/materials\/.+\.(vmat|vcompmat)\.json$/.test(value);
const asName = (value: unknown): string | undefined =>
    typeof value === "string" && value.length > 0 ? value : undefined;

interface TextureRef {
    property: string;
    path: string;
}

function walk(value: unknown, contextName: string | undefined, textures: TextureRef[], materials: string[]): void {
    if (typeof value === "string") {
        if (isTextureRef(value)) textures.push({ property: contextName ?? "(unnamed)", path: value });
        else if (isMaterialRef(value)) materials.push(value);
        return;
    }
    if (Array.isArray(value)) {
        for (const entry of value) walk(entry, contextName, textures, materials);
        return;
    }
    if (value !== null && typeof value === "object") {
        const record = value as Record<string, unknown>;
        const name = asName(record.m_name) ?? asName(record.m_strName) ?? contextName;
        for (const [key, child] of Object.entries(record)) walk(child, name ?? key, textures, materials);
    }
}

const outputDir = process.argv.find((a, i) => i >= 2 && !a.startsWith("--")) ?? DEFAULT_OUTPUT_DIR;
const dryRun = process.argv.includes("--dry");

const outputFileFor = (resourcePath: string): string => join(outputDir, resourcePath.replace(/^\//, ""));
const baselineFileFor = (resourcePath: string): string => join(BASELINE_DIR, resourcePath.replace(/^\//, ""));

// The decompiled PNG identity for an output texture: its filename with the trailing `_<outhash>`
// removed (leaving `<base>_<srchash>`), which is the PNG's basename minus the extension.
const pngIdentity = (resourcePath: string): string => basename(resourcePath).replace(/_[0-9a-f]{8}\.webp$/, "");

// Map `<base>_<srchash>` -> absolute decompiled PNG path, from the item-generator's encode manifest.
const pngBySource = new Map<string, string>();
if (existsSync(WEBP_JOBS_MANIFEST)) {
    for (const line of readFileSync(WEBP_JOBS_MANIFEST, "utf-8").split("\n")) {
        if (line.trim().length === 0) continue;
        const src = (JSON.parse(line) as { src?: string }).src;
        if (src !== undefined && src.endsWith(".png")) pngBySource.set(basename(src, ".png"), src);
    }
} else {
    console.error(`WARNING: manifest not found at ${WEBP_JOBS_MANIFEST}; nothing to source.`);
}

CS2Economy.load({ items: CS2_ITEMS, language: english });
const stickers = [...CS2Economy.items.values()].filter((item) => item.isSticker());

// Walk every sticker's material tree once, bucketing each texture resource by whether it feeds a
// target property. A texture that ALSO feeds a non-target property is excluded, so we never re-
// encode (and possibly corrupt) something a mask/data path reads.
const targetPaths = new Map<string, string>(); // resource path -> property (first seen)
const nonTargetPaths = new Set<string>();

for (const sticker of stickers) {
    const root = sticker.materialPath ?? sticker.parent?.materialPath;
    if (root === undefined) continue;
    const visited = new Set<string>();
    const stack = [root];
    while (stack.length > 0) {
        const materialPath = stack.pop()!;
        if (visited.has(materialPath)) continue;
        visited.add(materialPath);
        const file = outputFileFor(materialPath);
        if (!existsSync(file)) continue;
        const textures: TextureRef[] = [];
        const materials: string[] = [];
        walk(JSON.parse(readFileSync(file, "utf-8")), undefined, textures, materials);
        for (const { property, path } of textures) {
            if (property in TARGETS) {
                if (!targetPaths.has(path)) targetPaths.set(path, property);
            } else {
                nonTargetPaths.add(path);
            }
        }
        for (const m of new Set(materials)) if (!visited.has(m)) stack.push(m);
    }
}

for (const path of nonTargetPaths) targetPaths.delete(path);

type Outcome = { before: number; after: number; skipped: boolean; bucket: string; label: string };

// Nth-percentile value (0..255) of a single raw channel: the value below which `percentile` of the
// pixels fall. Used to classify a texture's glossiness from its own roughness channel.
async function channelPercentile(png: string, channel: 0 | 1 | 2 | 3, percentile: number): Promise<number> {
    const { data } = await sharp(png).extractChannel(channel).raw().toBuffer({ resolveWithObject: true });
    const hist = new Uint32Array(256);
    for (let i = 0; i < data.length; i++) {
        const idx = data[i]!;
        hist[idx] = hist[idx]! + 1;
    }
    let acc = 0;
    for (let v = 0; v < 256; v++) {
        acc += hist[v]!;
        if (acc / data.length >= percentile) return v;
    }
    return 255;
}

const tierLabel = (t: Tier): string => {
    const qual = t.mode === "lossless" ? "" : ` q${t.quality}`;
    return `${t.mode}${qual}${t.stripAlpha ? " -A" : ""}${t.minWidth ? ` w>=${t.minWidth}` : ""}${t.maxWidth ? ` <=${t.maxWidth}px` : ""}`;
};

// Encode `resourcePath` from its pristine PNG per `tier`, writing the result to the output dir.
// "before" is the lossless baseline size (read-only from BASELINE_DIR) so the report is stable no
// matter how many times we re-run. Reads pixels from the PNG, never from the (possibly already
// re-encoded) output — so quality never compounds.
async function reencode(resourcePath: string, baseTier: Tier): Promise<Outcome> {
    const outFile = outputFileFor(resourcePath);
    const baselineFile = baselineFileFor(resourcePath);
    const before = existsSync(baselineFile) ? statSync(baselineFile).size : statSync(outFile).size;
    const property = targetPaths.get(resourcePath)!;

    const png = pngBySource.get(pngIdentity(resourcePath));
    if (png === undefined || !existsSync(png)) {
        // no source; leave the output untouched
        return { before, after: before, skipped: true, bucket: property, label: tierLabel(baseTier) };
    }

    // Gloss-awareness: classify the texture from its own roughness channel and, if glossy, swap the
    // lossy tier for lossless (lossy would facet the glossy normals). Splits the property into two
    // reported buckets so we can see how many stickers each path took.
    let tier = baseTier;
    let bucket = property;
    if (baseTier.glossyExempt !== undefined) {
        const { channel, percentile, below } = baseTier.glossyExempt;
        const p = await channelPercentile(png, channel as 0 | 1 | 2 | 3, percentile);
        if (p < below) {
            tier = { mode: "lossless", quality: 100 };
            bucket = `${property} (glossy→lossless)`;
        } else {
            bucket = `${property} (matte→lossy)`;
        }
    }
    const label = tierLabel(tier);

    const meta = await sharp(png).metadata();
    const width = meta.width ?? 0;
    // Width gate: leave already-small textures at their lossless baseline (never written).
    if (tier.minWidth !== undefined && width < tier.minWidth) {
        return { before, after: before, skipped: true, bucket, label };
    }
    // Downscale gate: if the texture is already within maxWidth there is nothing to gain here.
    const downscale = tier.maxWidth !== undefined && width > tier.maxWidth;
    if (tier.maxWidth !== undefined && !downscale) {
        return { before, after: before, skipped: true, bucket, label };
    }

    const options =
        tier.mode === "near-lossless"
            ? { nearLossless: true, quality: tier.quality, exact: true }
            : tier.mode === "lossless"
              ? { lossless: true, exact: true, effort: 6 }
              : { quality: tier.quality, exact: true, ...(tier.smartSubsample ? { smartSubsample: true } : {}) };
    const encode = (extra?: Record<string, unknown>): Promise<Buffer> => {
        let pipeline = sharp(png);
        if (downscale) pipeline = pipeline.resize({ width: tier.maxWidth, withoutEnlargement: true, kernel: "lanczos3" });
        if (tier.stripAlpha) pipeline = pipeline.removeAlpha();
        return pipeline.webp(extra ?? options).toBuffer();
    };

    let candidate = await encode();
    // Never regress: if lossy loses to plain lossless, ship lossless from the same PNG instead, so
    // the output is self-consistent regardless of any prior run.
    if (candidate.length >= before) candidate = await encode({ lossless: true, exact: true });

    if (!dryRun) writeFileSync(outFile, candidate);
    return { before, after: candidate.length, skipped: false, bucket, label };
}

const perBucket = new Map<string, { label: string; count: number; skipped: number; before: number; after: number }>();
let done = 0;
const entries = [...targetPaths.entries()];
console.log(
    `Re-encoding ${entries.length} unique sticker textures from PNG source -> ${outputDir}${dryRun ? " (DRY RUN)" : ""}`
);

const CONCURRENCY = 8;
let cursor = 0;
async function worker(): Promise<void> {
    while (cursor < entries.length) {
        const [path, property] = entries[cursor++]!;
        const tier = TARGETS[property]!;
        const result = await reencode(path, tier);
        const agg = perBucket.get(result.bucket) ?? { label: result.label, count: 0, skipped: 0, before: 0, after: 0 };
        agg.count++;
        if (result.skipped) agg.skipped++;
        agg.before += result.before;
        agg.after += result.after;
        perBucket.set(result.bucket, agg);
        if (++done % 500 === 0) console.log(`  ${done}/${entries.length}`);
    }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

const MB = 1024 * 1024;
console.log("");
console.log("| Property | Tier | Files | Skipped | Before | After | Saved |");
console.log("| --- | --- | --- | --- | --- | --- | --- |");
let tb = 0;
let ta = 0;
for (const [bucket, agg] of [...perBucket.entries()].sort((a, b) => b[1].before - a[1].before)) {
    tb += agg.before;
    ta += agg.after;
    console.log(
        `| ${bucket} | ${agg.label} | ${agg.count} | ${agg.skipped} | ${(agg.before / MB).toFixed(1)} MB | ${(agg.after / MB).toFixed(1)} MB | ${((1 - agg.after / agg.before) * 100).toFixed(0)}% |`
    );
}
console.log(
    `| **total** | | ${entries.length} | | ${(tb / MB).toFixed(1)} MB | ${(ta / MB).toFixed(1)} MB | ${((1 - ta / tb) * 100).toFixed(0)}% |`
);
