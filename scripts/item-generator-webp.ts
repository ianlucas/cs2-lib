/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Encodes a batch of PNG textures to WebP. Invoked once per run by the C# item-generator
// (AssetProcessor.ProcessMaterialTextures) with a JSONL manifest of jobs. Output bytes feed the
// content hashes embedded in CDN filenames, so sharp is pinned exact and nothing here may change
// encoded bytes. By default a texture is encoded fully lossless (VP8L) verbatim -- `exact` must stay
// on: shader logic reads RGB under fully-transparent pixels.
//
// A job MAY carry an `encode` descriptor (only sticker textures do -- see StickerTextureOptimization
// on the C# side, which owns all tier policy). It selects a smaller per-texture encoding. A job with
// no descriptor takes the exact original lossless path below, so its bytes -- and filename hash --
// never change. Descriptor fields mirror the C# tier: mode, quality, stripAlpha, minWidth (skip when
// narrower -> stays lossless), maxWidth (Lanczos downscale cap), smartSubsample (force 4:4:4).

import { mkdir, readFile } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { dirname } from "node:path";
import sharp from "sharp";

interface EncodeSpec {
    mode: "lossless" | "lossy" | "nearLossless";
    quality?: number;
    stripAlpha?: boolean;
    minWidth?: number;
    maxWidth?: number;
    smartSubsample?: boolean;
}

interface EncodeJob {
    src: string;
    dest: string;
    encode?: EncodeSpec;
}

// The default encoding, used for every texture without a descriptor and for a tiered texture that
// falls back (too narrow to touch). Kept byte-for-byte as the historical path for hash stability.
const LOSSLESS = { lossless: true, exact: true } as const;

const manifestPath = process.argv[2];
if (manifestPath === undefined) {
    console.error("usage: tsx item-generator-webp.ts <jobs.jsonl>");
    process.exit(1);
}

const jobs: EncodeJob[] = (await readFile(manifestPath, "utf-8"))
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));

let failed = 0;

async function encode({ src, dest, encode: spec }: EncodeJob) {
    try {
        await mkdir(dirname(dest), { recursive: true });
        if (spec === undefined) {
            await sharp(src).webp(LOSSLESS).toFile(dest);
        } else {
            await encodeTiered(src, dest, spec);
        }
        console.log(`done ${dest}`);
    } catch (error) {
        failed += 1;
        console.error(`error ${src}: ${error instanceof Error ? error.message : error}`);
    }
}

async function encodeTiered(src: string, dest: string, spec: EncodeSpec) {
    const width = (await sharp(src).metadata()).width ?? 0;
    // Width gates: a texture narrower than minWidth, or already within maxWidth, has nothing to gain
    // -- fall back to the default lossless encoding (identical bytes to an untiered texture).
    const tooNarrow = spec.minWidth !== undefined && width < spec.minWidth;
    const downscale = spec.maxWidth !== undefined && width > spec.maxWidth;
    if (tooNarrow || (spec.maxWidth !== undefined && !downscale)) {
        await sharp(src).webp(LOSSLESS).toFile(dest);
        return;
    }

    // Build the shared pixel pipeline (downscale/strip-alpha) once, then encode per mode.
    const pipeline = () => {
        let p = sharp(src);
        if (downscale) p = p.resize({ width: spec.maxWidth, withoutEnlargement: true, kernel: "lanczos3" });
        if (spec.stripAlpha) p = p.removeAlpha();
        return p;
    };

    if (spec.mode === "lossless") {
        await pipeline().webp({ lossless: true, exact: true, effort: 6 }).toFile(dest);
        return;
    }

    const lossyOptions =
        spec.mode === "nearLossless"
            ? { nearLossless: true, quality: spec.quality ?? 100, exact: true }
            : { quality: spec.quality ?? 90, exact: true, ...(spec.smartSubsample ? { smartSubsample: true } : {}) };
    await pipeline().webp(lossyOptions).toFile(dest);
}

const workers = Math.max(2, availableParallelism());
let next = 0;
await Promise.all(
    Array.from({ length: Math.min(workers, jobs.length) }, async () => {
        while (next < jobs.length) {
            await encode(jobs[next++]!);
        }
    })
);

if (failed > 0) {
    console.error(`${failed} of ${jobs.length} encode jobs failed.`);
    process.exit(1);
}
