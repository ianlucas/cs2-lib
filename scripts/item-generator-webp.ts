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
// - `quantizeBits` overrides min-pick for normal maps, which min-pick cannot serve. A normal's
//   three channels are an independent vector, not a color, and lossy VP8 is YUV 4:2:0 -- so the
//   chroma planes carry X and Y at half resolution and the downsample/upsample shifts local means.
//   Measured on ak47_normal that biases 923 of 16,384 blocks by up to 4 levels; on
//   ak47_autoexec_camo_normal, 6,284 of 16,384. Every biased block mirrors a slightly different
//   patch of the environment, which renders as the square mosaic on AK-47 | AUTOEXEC's blue paint.
//
//   Quality does not fix it, because it is resolution loss and not quantization: at q100 the
//   count only falls to 703 and 4,503 for 1.6x and 1.4x the bytes, with the bias unchanged at
//   ~4 levels. Any chroma-free encode sits at 0 biased blocks -- the same encoder at the same
//   quality, fed one channel at a time as grayscale, measures maxerr 6/7/8 against 91/54/45.
//   Min-pick cannot reach one: VP8L is 4-6x the lossy size for a dithered normal, so lossy wins
//   on bytes every time and ships the mosaic with it.
//
//   So normals skip the comparison and take a fixed path: quantize the LSB dither away, then
//   VP8L. The dither is what makes a normal incompressible losslessly, and dropping it is what
//   buys back the size -- 4 bits per channel lands at 1.6x lossy, against 5.1x for the
//   near-lossless path this replaces (measured over 22 normals). Endpoints are preserved (the
//   ladder is round(v/255*(L-1)) * 255/(L-1), so 0 and 255 map to themselves), which matters
//   because flat normal regions sit at exactly 255 and the default normal is (127,127,255):
//   against a plain bit-mask that halves the residual bias for free.
//
//   The tradeoff is a different artifact, not the absence of one. Quantization error follows the
//   surface's own gradients rather than a 16px grid, so it reads as banding instead of mosaic,
//   and at 4 bits a block's mean can shift by 8 levels (3.6 degrees of normal tilt). That is
//   larger than the lossy bias it replaces; it is preferred because it is not lattice-aligned.
//   Raising Config.WebpNormalQuantizeBits is the knob if banding shows up on a mirror surface.
//
//   Alpha is never quantized. A sticker's g_tNormalRoughnessSticker0 packs roughness into it,
//   and a shader reads that as data.
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
    quantizeBits?: number;
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

// Quantize each colour channel onto a ladder of 2^bits evenly spaced levels, then encode VP8L.
// Alpha is copied through untouched. bits=8 is the identity ladder, which is how a texture asks
// for a bit-exact lossless encode without opting into min-pick.
async function encodeQuantized(src: string, bits: number, dropAlpha: boolean) {
    // Validated rather than trusted. A bad value here does not fail loudly, it silently ships:
    // `levels` of 0 divides by zero, the NaN coerces to 0 on the way into a Buffer, and every
    // texture encodes as solid black in ~200 bytes. That is what a null `quantizeBits` reaching
    // this function once did to every non-normal in the corpus.
    if (!Number.isInteger(bits) || bits < 1 || bits > 8) {
        throw new Error(`quantizeBits must be an integer in 1..8, received ${bits}`);
    }
    const pipeline = dropAlpha ? sharp(src).removeAlpha() : sharp(src);
    const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });
    // Evenly spaced rungs across the full range, so 0 and 255 map to themselves, PLUS the two
    // neutral values. A normal map's neutral is 127/128 -- "pointing straight out" -- and on a
    // uniform 16-rung ladder it falls exactly between rungs (127 -> 119), which tilts every flat
    // surface in the texture by a uniform ~5 degrees rather than adding noise. Pinning it costs
    // two extra rungs and nothing measurable in bytes.
    const levels = (1 << bits) - 1;
    const rungs = new Set<number>([127, 128]);
    for (let step = 0; step <= levels; step += 1) {
        rungs.add(Math.round((step * 255) / levels));
    }
    const ladder = [...rungs].sort((a, b) => a - b);
    const table = Buffer.alloc(256);
    for (let value = 0; value < 256; value += 1) {
        let best = ladder[0]!;
        for (const rung of ladder) {
            if (Math.abs(rung - value) < Math.abs(best - value)) best = rung;
        }
        table[value] = best;
    }
    const hasAlpha = info.channels === 4 || info.channels === 2;
    for (let index = 0; index < data.length; index += 1) {
        if (hasAlpha && index % info.channels === info.channels - 1) continue;
        data[index] = table[data[index]!]!;
    }
    return sharp(data, { raw: info }).webp({ lossless: true, quality: 100, exact: true }).toBuffer();
}

async function encode({ src, dest, quality, dropAlpha, quantizeBits }: EncodeJob) {
    try {
        await mkdir(dirname(dest), { recursive: true });
        if (dropAlpha) await assertAlphaIsConstant(src);
        // Loose inequality on purpose: this must reject null as well as undefined.
        if (quantizeBits != null) {
            await writeFile(dest, await encodeQuantized(src, quantizeBits, dropAlpha === true));
            console.log(`done ${dest}`);
            return;
        }
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
