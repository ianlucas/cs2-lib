/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Encodes a batch of PNG textures to WebP. Invoked once per run by the C# item-generator
// (AssetProcessor.ProcessMaterialTextures) with a JSONL manifest of jobs. Output bytes feed the
// content hashes embedded in CDN filenames, so sharp is pinned exact and nothing here may change
// encoded bytes. Constraints:
// - `exact` must stay on: shader logic reads RGB under fully-transparent pixels.
// - `quality` is overloaded: the near-lossless level for near-lossless jobs (normal maps), VP8L
//   compression effort for lossless jobs (paint masks, AO — bytes are bit-exact regardless),
//   and lossy Q otherwise.
// - `lossless` is only forwarded when true so lossy and near-lossless outputs stay
//   byte-identical to previous runs.
// - `dropAlpha` marks a texture whose game format has no alpha channel, so the exported one is
//   ValveResourceFormat's invention. Nothing may be chained after `removeAlpha()`: sharp orders
//   its pipeline internally, not by call order, and puts `resize` FIRST — so `.removeAlpha()
//   .resize()` still premultiplies against the alpha we are removing. On the BC5 normals, whose
//   fabricated alpha is 0 rather than 255, that zeroes the whole image (measured: 68.6 MB of
//   normals encode to 0.00 MB). Any future resize step has to run as its own pass.

import { mkdir, readFile } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { dirname } from "node:path";
import sharp from "sharp";

interface EncodeJob {
    src: string;
    dest: string;
    quality: number;
    nearLossless: boolean;
    lossless?: boolean;
    dropAlpha?: boolean;
}

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

// A texture classified as having no alpha in the game must have a constant one in the export.
// If it varies, the classification is wrong and dropping the channel would discard real data —
// the exact failure this flag exists to prevent — so fail the job instead of guessing.
async function assertAlphaIsConstant(src: string) {
    const { channels } = await sharp(src).stats();
    const alpha = channels[3];
    if (alpha !== undefined && alpha.min !== alpha.max) {
        throw new Error(
            `dropAlpha requested but alpha varies (${alpha.min}..${alpha.max}); ` +
                `the source format was classified as having none`
        );
    }
}

async function encode({ src, dest, quality, nearLossless, lossless, dropAlpha }: EncodeJob) {
    try {
        await mkdir(dirname(dest), { recursive: true });
        if (dropAlpha) await assertAlphaIsConstant(src);
        const pipeline = sharp(src);
        await (dropAlpha ? pipeline.removeAlpha() : pipeline)
            .webp({ quality, nearLossless, ...(lossless ? { lossless: true } : {}), exact: true })
            .toFile(dest);
        console.log(`done ${dest}`);
    } catch (error) {
        failed += 1;
        console.error(`error ${src}: ${error instanceof Error ? error.message : error}`);
    }
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
