/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Encodes a batch of PNG textures to WebP. Invoked once per run by the C# item-generator
// (AssetProcessor.ProcessMaterialTextures) with a JSONL manifest of jobs. Output bytes feed the
// content hashes embedded in CDN filenames, so sharp is pinned exact and nothing here may change
// encoded bytes. Constraints:
// - Every job is encoded BOTH ways -- lossy VP8 at Config.WebpQuality and fully-lossless VP8L --
//   and the smaller output wins. This replaces the param-name carve-outs that selected a codec
//   from the material binding; see below for why picking on bytes is both smaller and safer.
//
//   Size: min-pick can never exceed the all-lossy size, because all-lossy is one of the two
//   candidates. It is strictly smaller in practice -- low-entropy data textures (masks, ID maps)
//   compress far better as VP8L, e.g. pist_deagle_masks 15.7 KB lossy -> 1.6 KB lossless.
//
//   Fidelity: every texture that picks VP8L becomes bit-exact, which is what retires the
//   artifact class the old carve-outs existed for. Lossy VP8 is YUV 4:2:0, so a texture whose
//   channels are independent data rather than a color dips flat macroblocks on a 16px lattice:
//   measured on weapon_pist_deagle_masks, 118 fully-saturated 16x16 blocks in the paint-zone
//   channel fell off 255 by up to 138. The shader blends bare metal with (1 - g_tMasks.x), so
//   each dipped block rendered as a pixelated square on Desert Eagle | Blaze. That texture is
//   27.9 KB lossy vs 10.3 KB lossless, so min-pick takes VP8L and the error goes to zero.
//
//   Why not select on the material param name: the binding does not predict the outcome. Both
//   the textures that shrink and the ones that grow under VP8L bind as g_tPaintByNumberMasks
//   (137 of 213 shrink, 76 grow), so no name-based rule separates them -- but g_tMasks,
//   g_tLayerId, g_tTintId and g_tLayerMask shrink unanimously (150/150). Bytes decide correctly
//   in every one of those cases without enumerating params, and without needing the
//   composite-material loose-variable walk the old collector required to find most of them.
//
//   Determinism: libwebp output is a pure function of (input bytes, settings, pinned version),
//   so the comparison yields the same winner on a clean run and an incremental one. It reads
//   only the source PNG -- unlike a rule built from decompiler state, which would vary with
//   what the workdir already had. Ties go to lossy, so the choice is total.
//
//   Cost: a second encode per texture. See the timing note in encode().
// - `exact` must stay on: 9,422 textures (2.4 GB) still carry a genuine varying alpha with
//   fully-transparent pixels, and shader logic reads the RGB underneath. Dropping alpha where
//   the game format has none did not retire this — it only removed the fabricated planes.
//   Turning `exact` off saves 0.43% on exactly those files while raising their max RGB error
//   under alpha=0 from 49 to 147 (measured, q95, 25-texture sample).
// - `dropAlpha` marks a texture whose game format has no alpha channel, so the exported one is
//   ValveResourceFormat's invention. Nothing may be chained after `removeAlpha()`: sharp orders
//   its pipeline internally, not by call order, and puts `resize` FIRST — so `.removeAlpha()
//   .resize()` still premultiplies against the alpha we are removing. On the BC5 normals, whose
//   fabricated alpha is 0 rather than 255, that zeroes the whole image (measured: 68.6 MB of
//   normals encode to 0.00 MB). Any future resize step has to run as its own pass.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { dirname } from "node:path";
import sharp from "sharp";

interface EncodeJob {
    src: string;
    dest: string;
    quality: number;
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

// Both candidate encodes of one source. Each gets its own sharp instance: an instance carries
// the pipeline it was configured with, so reusing one would apply removeAlpha() twice and, worse,
// leave the two encodes sharing mutable state. Buffers, not files -- only the winner is written.
//
// Timing: the VP8L pass is the expensive half -- measured 5.3x the lossy encode's wall time over a
// 60-texture stratified sample of the corpus (26.3s vs 5.0s), so min-pick costs roughly 6x
// lossy-only encoding. That is the whole price of this approach, and it buys ~1% corpus-wide:
// on that same sample VP8L won only 3 of 60 (8.3 MB -> 8.2 MB). The wins are not spread evenly,
// they are concentrated in the low-entropy data textures, where they are large (masks and ID maps
// shrink 60-90%) and where they also retire the lossy artifacts. If this ever dominates run time,
// the cheap guard is to skip the VP8L attempt when the lossy encode's bits-per-pixel is high;
// measured on 368 mask textures, every VP8L winner sat under 1.68 bpp.
//
// Both encodes of a job run sequentially inside one worker so the pool below still bounds total
// concurrency and peak memory (two full-size buffers per worker, not per job).
async function encodeBoth(src: string, quality: number, dropAlpha: boolean) {
    const open = () => {
        const pipeline = sharp(src);
        return dropAlpha ? pipeline.removeAlpha() : pipeline;
    };
    const lossy = await open().webp({ quality, exact: true }).toBuffer();
    const lossless = await open().webp({ lossless: true, quality: 100, exact: true }).toBuffer();
    return { lossy, lossless };
}

async function encode({ src, dest, quality, dropAlpha }: EncodeJob) {
    try {
        await mkdir(dirname(dest), { recursive: true });
        if (dropAlpha) await assertAlphaIsConstant(src);
        const { lossy, lossless } = await encodeBoth(src, quality, dropAlpha === true);
        // Ties go to lossy: it is the status quo, and preferring it keeps the winner stable for
        // any texture where the two happen to land on the same byte count.
        const winner = lossless.length < lossy.length ? lossless : lossy;
        await writeFile(dest, winner);
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
