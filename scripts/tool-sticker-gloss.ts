/*---------------------------------------------------------------------------------------------
 *  Measures the isotropic-roughness (B channel) distribution of every g_tNormalRoughnessSticker0
 *  texture, so we can classify "glossy" stickers (whose normals facet under lossy) purely from the
 *  texture itself — no name lists, no material-tree metadata. Low roughness = glossy.
 *
 *  Prints, per candidate roughness threshold, how many sticker-normal textures would be flagged
 *  glossy by (a) their p5 roughness and (b) the fraction of pixels below the threshold — plus a
 *  coarse histogram of p5 roughness to reveal any glossy/matte split.
 *
 *  Usage: npx tsx scripts/tool-sticker-gloss.ts [outputDir]
 *--------------------------------------------------------------------------------------------*/

import { existsSync, readFileSync } from "fs";
import { basename, join } from "path";
import sharp from "sharp";
import { CS2Economy } from "../src/economy.ts";
import { CS2_ITEMS } from "../src/items.ts";
import { english } from "../src/translations/english.ts";

const WEBP_JOBS_MANIFEST = "scripts/workdir/item-generator/build/webp-jobs.jsonl";
const DEFAULT_OUTPUT_DIR = "scripts/workdir/output";
const TARGET_PROPERTY = "g_tNormalRoughnessSticker0";

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
const outputFileFor = (resourcePath: string): string => join(outputDir, resourcePath.replace(/^\//, ""));
const pngIdentity = (resourcePath: string): string => basename(resourcePath).replace(/_[0-9a-f]{8}\.webp$/, "");

const pngBySource = new Map<string, string>();
for (const line of readFileSync(WEBP_JOBS_MANIFEST, "utf-8").split("\n")) {
    if (line.trim().length === 0) continue;
    const src = (JSON.parse(line) as { src?: string }).src;
    if (src !== undefined && src.endsWith(".png")) pngBySource.set(basename(src, ".png"), src);
}

CS2Economy.load({ items: CS2_ITEMS, language: english });
const stickers = [...CS2Economy.items.values()].filter((item) => item.isSticker());

// Map each unique normal-roughness texture -> the sticker names that use it (first few, for labels).
const texToStickers = new Map<string, string[]>();
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
            if (property !== TARGET_PROPERTY) continue;
            const arr = texToStickers.get(path) ?? [];
            arr.push(sticker.name);
            texToStickers.set(path, arr);
        }
        for (const m of new Set(materials)) if (!visited.has(m)) stack.push(m);
    }
}

const paths = [...texToStickers.keys()];
console.log(`Analyzing roughness (B channel) of ${paths.length} unique ${TARGET_PROPERTY} textures\n`);

type Stat = { path: string; p1: number; p5: number; fracBelow: (t: number) => number; sample: string };
const stats: Stat[] = [];
const THRESHOLDS = [160, 176, 192, 208, 224, 240];

let cursor = 0;
async function worker(): Promise<void> {
    while (cursor < paths.length) {
        const path = paths[cursor++]!;
        const png = pngBySource.get(pngIdentity(path));
        if (png === undefined || !existsSync(png)) continue;
        const { data } = await sharp(png).extractChannel(2).raw().toBuffer({ resolveWithObject: true });
        // Histogram over 0..255 of the roughness channel.
        const hist = new Uint32Array(256);
        for (let i = 0; i < data.length; i++) hist[data[i]!]++;
        const total = data.length;
        // pN: value below which N% of pixels fall (the glossiest region).
        const percentile = (frac: number): number => {
            let acc = 0;
            for (let v = 0; v < 256; v++) {
                acc += hist[v]!;
                if (acc / total >= frac) return v;
            }
            return 255;
        };
        const prefix = new Uint32Array(257);
        for (let v = 0; v < 256; v++) prefix[v + 1] = prefix[v]! + hist[v]!;
        stats.push({
            path,
            p1: percentile(0.01),
            p5: percentile(0.05),
            fracBelow: (t: number) => prefix[t]! / total,
            sample: texToStickers.get(path)![0]!
        });
    }
}
await Promise.all(Array.from({ length: 8 }, worker));

// p5 histogram (buckets of 16).
console.log("p5-roughness histogram (glossier <-- --> mattier), bucket width 16:");
const buckets = new Array(16).fill(0);
for (const s of stats) buckets[Math.min(15, Math.floor(s.p5 / 16))]++;
for (let b = 0; b < 16; b++) {
    const lo = b * 16;
    const bar = "#".repeat(Math.round((buckets[b] / stats.length) * 80));
    console.log(`  ${String(lo).padStart(3)}-${String(lo + 15).padStart(3)} | ${String(buckets[b]).padStart(5)} ${bar}`);
}

console.log(`\nGlossy-classification counts by threshold (of ${stats.length} textures) — these stay LOSSLESS:`);
console.log("| Threshold | p1 < t | p5 < t | >=10% px < t | >=25% px < t |");
console.log("| --- | --- | --- | --- | --- |");
for (const t of THRESHOLDS) {
    const byP1 = stats.filter((s) => s.p1 < t).length;
    const byP5 = stats.filter((s) => s.p5 < t).length;
    const byFrac10 = stats.filter((s) => s.fracBelow(t) >= 0.1).length;
    const byFrac25 = stats.filter((s) => s.fracBelow(t) >= 0.25).length;
    console.log(`| ${t} | ${byP1} | ${byP5} | ${byFrac10} | ${byFrac25} |`);
}

// Show the glossiest 15 textures (lowest p5) with a sample sticker name, to eyeball whether the
// classifier is catching the expected metallic/foil set.
console.log("\nGlossiest 15 (lowest p5 roughness):");
for (const s of [...stats].sort((a, b) => a.p5 - b.p5).slice(0, 15)) {
    console.log(`  p5=${String(s.p5).padStart(3)}  ${s.sample}`);
}
console.log("\nMattest 5 (highest p5 roughness):");
for (const s of [...stats].sort((a, b) => b.p5 - a.p5).slice(0, 5)) {
    console.log(`  p5=${String(s.p5).padStart(3)}  ${s.sample}`);
}
