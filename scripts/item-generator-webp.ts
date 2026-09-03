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
// - `qualityFloor`/`distortionTolerance` re-rate the lossy winner AFTER min-pick has chosen the
//   codec. `quality` is a single global number, but what a texture gets for those bits is not
//   global at all: lossy VP8 is YUV 4:2:0, so a texture whose channels are independent data
//   carries a chroma-subsampling error that `quality` cannot touch, and the DCT quantization
//   error it CAN touch is a rounding difference on top of it. Measured over a 42-texture sample
//   stratified by size rank, the two populations separate cleanly at q95 -> q70 (per-channel
//   RMSE against the source):
//
//     ht_poly_camo_pattern_mask  19.04 -> 20.65   11.52 -> 6.00 MB
//     cloud_camo_01              13.37 -> 14.59    7.73 -> 3.01 MB
//     ak47_default_rough          7.05 ->  8.89    3.82 -> 1.01 MB
//     famas_snake_song_roughness  1.22 ->  4.75    5.74 -> 2.73 MB
//     sg556_default_color         1.52 ->  4.51    4.48 -> 1.29 MB
//
//   The first three are already distorted at q95 and 25 quality points buy them essentially
//   nothing; the last two are clean, and the same 25 points cost them 3-4x their error. So the
//   rule is measured per texture rather than declared: take the LOWEST quality whose distortion
//   stays within `distortionTolerance` of what full quality achieves ON THIS TEXTURE, bounded by
//   an absolute ceiling so a texture that starts out badly damaged cannot be damaged without
//   limit. Bits are spent only where they measurably buy fidelity. On that sample it is 24.1% of
//   the lossy bytes at a tolerance of 10%, and it leaves 15 of 42 textures at full quality.
//
//   Distortion is per-channel RMSE, worst channel, against the same pixels the encoder was fed
//   (so alpha quantization is already applied and does not count as error). Per-channel because
//   a packed data texture's channels are independent -- a pooled figure lets a wrecked mask
//   channel hide behind two clean ones. Channels are compared pairwise up to the narrower of the
//   two buffers: libwebp drops a fully-opaque alpha plane on its own, and a plane it dropped for
//   being constant contributes no error.
//
//   This runs ONLY when the lossy candidate already won min-pick. Re-rating before the
//   comparison would let a cheaper lossy encode undercut a VP8L winner, which is exactly the
//   trade min-pick exists to refuse -- those textures are the masks and ID maps whose lossy
//   artifacts the comparison retires, and shipping a smaller lossy version of one would bring
//   the mosaic back. Every VP8L win is therefore bit-identical to what it was before this step.
//
//   Cost: 1.39x the wall time of the encoder without it (34.2s -> 47.5s over 142 jobs). The
//   ladder is searched binary rather than walked, which relies on distortion being monotone in
//   quality -- verified on the sample, where every texture's RMSE fell with every step up the
//   ladder. The VP8L candidate, still the expensive half of a job, is untouched.
//
//   Verified end to end on a 142-job random sample: lossy bytes fell 22.7%, every VP8L winner
//   and every quantized normal came out byte-identical, no texture exceeded its budget (worst
//   ratio 1.100, worst absolute increase 1.23 levels), and max error moved by at most a few
//   levels in either direction -- so the added error is spread, not concentrated in new blocks.
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
// - `alphaQuantizeBits` snaps the alpha plane onto the same ladder before min-pick runs, and is
//   the biggest remaining win in the corpus. WebP stores a lossy image's alpha in a separate ALPH
//   chunk that is always compressed LOSSLESSLY, so `quality` never touches it: measured over the
//   11,263 lossy textures that carry one, ALPH is 1.17 GiB of the 6.95 GiB corpus, and on the
//   worst files it is nearly all of them (mp5_statics_blue albedo: 6.29 MB alpha, 6.81 MB total).
//
//   What makes those planes incompressible is dither, not detail -- the same thing that made
//   normals incompressible. AK-47 | AUTOEXEC's g_tPattern alpha holds 72 distinct values, but
//   90% of its pixels are 87 or 88 and 7% are 42 or 43: it is a two-plateau wear mask with an LSB
//   rattle laid over it. Snapping that rattle away takes the file from 4.21 MB to 1.59 MB.
//
//   Quantizing is deliberate in preference to libwebp's own `alphaQuality`, which reaches similar
//   sizes (4.21 MB -> 1.54 MB on the same texture) by running the alpha plane through the LOSSY
//   VP8 encoder. That is the 16px-macroblock artifact this file already routes normals and masks
//   around, and pattern alpha feeds `smoothstep` wear thresholds in csgo_customweapon_ps_style6,
//   where a lattice-aligned dip reads as square patches of wear. Quantization error follows the
//   mask's own gradients instead and is bounded at 255/(2^bits-1)/2. Note also that `alphaQuality`
//   is a cliff, not a dial -- 100/95/90 were byte-identical in every texture measured, and the
//   drop only lands somewhere below 90 -- so it is not tunable even if the artifact were tolerable.
//
//   Only the min-pick path takes this. The quantized path leaves alpha alone on purpose (a
//   sticker's g_tNormalRoughnessSticker0 packs roughness into it), and `dropAlpha` discards the
//   plane outright, so neither has an alpha worth snapping.
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
import sharp, { type Sharp } from "sharp";

interface EncodeJob {
    src: string;
    dest: string;
    quality: number;
    dropAlpha?: boolean;
    quantizeBits?: number;
    alphaQuantizeBits?: number;
    qualityFloor?: number;
    distortionTolerance?: number;
    distortionCeiling?: number;
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

// The pixels the encoder is fed, decoded once: alpha dropped and/or snapped onto the ladder,
// whichever the job asked for. One decode serves both candidates AND the distortion measurements
// below, all of which have to see the same input -- error is measured against what was encoded,
// not against the file on disk, so a deliberate alpha quantization does not read as encoder error.
//
// sharp treats a raw input buffer as read-only, so handing the same one to several pipelines is
// safe; it is the *instance* that cannot be reused. An instance carries the pipeline it was
// configured with, so a shared one would apply removeAlpha() twice and leave the encodes sharing
// mutable state. Hence a factory rather than a pipeline. Peak memory is one decoded surface plus
// the encoded buffers, per worker rather than per job.
async function prepareSource(src: string, dropAlpha: boolean, alphaQuantizeBits: number | undefined) {
    const pipeline = dropAlpha ? sharp(src).removeAlpha() : sharp(src);
    const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });
    const hasAlpha = info.channels === 4 || info.channels === 2;
    if (alphaQuantizeBits !== undefined && !dropAlpha && hasAlpha) {
        const table = quantizationTable(alphaQuantizeBits);
        for (let index = info.channels - 1; index < data.length; index += info.channels) {
            data[index] = table[data[index]!]!;
        }
    }
    return { data, info, open: () => sharp(data, { raw: info }) };
}

// Per-channel RMSE against the encoded input, worst channel. Channels are paired positionally up
// to the narrower buffer: libwebp drops a fully-opaque alpha plane by itself, and a plane dropped
// for being constant carries no error. A grayscale input decodes back as three equal channels, so
// pairing from index 0 still compares the one channel that exists.
function distortion(
    reference: Buffer,
    referenceChannels: number,
    decoded: Buffer,
    decodedChannels: number,
    pixels: number
) {
    let worst = 0;
    for (let channel = 0; channel < Math.min(referenceChannels, decodedChannels); channel += 1) {
        let sum = 0;
        for (let pixel = 0; pixel < pixels; pixel += 1) {
            const delta = reference[pixel * referenceChannels + channel]! - decoded[pixel * decodedChannels + channel]!;
            sum += delta * delta;
        }
        const rmse = Math.sqrt(sum / pixels);
        if (rmse > worst) worst = rmse;
    }
    return worst;
}

// The lowest quality on the ladder whose distortion stays within budget of what full quality
// achieves on this same texture, encoded. Returns the full-quality buffer when nothing qualifies.
//
// Timing: the VP8L pass is the expensive half of a job -- measured 5.3x the lossy encode's wall
// time over a 60-texture stratified sample of the corpus (26.3s vs 5.0s). The ladder is searched
// binary rather than walked, so this adds ~3 lossy encodes and their decodes on top of that, and
// only on jobs where lossy already won. Binary search is valid because distortion is monotone in
// quality: on the 42-texture sample every texture's RMSE fell at every step up the ladder.
//
// If encode time ever dominates, the cheap guard is a size floor -- the search is worth ~24% of a
// 4 MB texture and ~24% of a 40 KB one, and only the first is worth three extra encodes.
async function selectQuality(
    open: () => Sharp,
    reference: Buffer,
    info: { width: number; height: number; channels: number },
    fullQuality: Buffer,
    quality: number,
    floor: number,
    tolerance: number,
    ceiling: number
) {
    const ladder: number[] = [];
    for (let step = quality - QUALITY_LADDER_STEP; step >= floor; step -= QUALITY_LADDER_STEP) {
        ladder.push(step);
    }
    if (ladder.length === 0) return fullQuality;

    const pixels = info.width * info.height;
    const measure = async (buffer: Buffer) => {
        const { data, info: decoded } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true });
        return distortion(reference, info.channels, data, decoded.channels, pixels);
    };
    const budget = await measure(fullQuality);
    const encoded = new Map<number, Buffer>();
    const fits = async (candidate: number) => {
        const buffer = await open().webp({ quality: candidate, exact: true }).toBuffer();
        encoded.set(candidate, buffer);
        const measured = await measure(buffer);
        return measured <= budget * (1 + tolerance) && measured - budget <= ceiling;
    };

    // The ladder descends and acceptance is monotone, so the qualities that fit are a prefix of
    // it and the answer is the last index that fits.
    let low = 0;
    let high = ladder.length - 1;
    let best = -1;
    while (low <= high) {
        const middle = (low + high) >> 1;
        if (await fits(ladder[middle]!)) {
            best = middle;
            low = middle + 1;
        } else {
            high = middle - 1;
        }
    }
    return best === -1 ? fullQuality : encoded.get(ladder[best]!)!;
}

// Quality points between rungs of the search ladder. Five is the granularity libwebp's own
// quality scale is meaningful at; finer steps cost encodes to land on sizes a percent apart.
const QUALITY_LADDER_STEP = 5;

// A 256-entry lookup mapping every byte to its nearest rung on a ladder of 2^bits evenly spaced
// levels, PLUS the two neutral values. Evenly spaced across the full range means 0 and 255 map to
// themselves. Pinning 127/128 is for normal maps, whose neutral is "pointing straight out": on a
// uniform 16-rung ladder it falls exactly between rungs (127 -> 119), which tilts every flat
// surface in the texture by a uniform ~5 degrees rather than adding noise. It costs two extra
// rungs and nothing measurable in bytes, and it is harmless for the alpha ladder.
//
// Cached per bit depth: a job runs one of at most a handful of depths, and rebuilding the 256x18
// nearest-rung search per texture is pure waste in the pool.
const ladderCache = new Map<number, Buffer>();

function quantizationTable(bits: number) {
    // Validated rather than trusted. A bad value here does not fail loudly, it silently ships:
    // `levels` of 0 divides by zero, the NaN coerces to 0 on the way into a Buffer, and every
    // texture encodes as solid black in ~200 bytes. That is what a null `quantizeBits` reaching
    // this function once did to every non-normal in the corpus.
    if (!Number.isInteger(bits) || bits < 1 || bits > 8) {
        throw new Error(`quantize bits must be an integer in 1..8, received ${bits}`);
    }
    const cached = ladderCache.get(bits);
    if (cached !== undefined) return cached;
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
    ladderCache.set(bits, table);
    return table;
}

// Quantize each colour channel onto the ladder, then encode VP8L. Alpha is copied through
// untouched. bits=8 is the identity ladder, which is how a texture asks for a bit-exact lossless
// encode without opting into min-pick.
async function encodeQuantized(src: string, bits: number, dropAlpha: boolean) {
    const table = quantizationTable(bits);
    const pipeline = dropAlpha ? sharp(src).removeAlpha() : sharp(src);
    const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });
    const hasAlpha = info.channels === 4 || info.channels === 2;
    for (let index = 0; index < data.length; index += 1) {
        if (hasAlpha && index % info.channels === info.channels - 1) continue;
        data[index] = table[data[index]!]!;
    }
    return sharp(data, { raw: info }).webp({ lossless: true, quality: 100, exact: true }).toBuffer();
}

async function encode({
    src,
    dest,
    quality,
    dropAlpha,
    quantizeBits,
    alphaQuantizeBits,
    qualityFloor,
    distortionTolerance,
    distortionCeiling
}: EncodeJob) {
    try {
        await mkdir(dirname(dest), { recursive: true });
        if (dropAlpha) await assertAlphaIsConstant(src);
        // Loose inequality on purpose: this must reject null as well as undefined.
        if (quantizeBits != null) {
            await writeFile(dest, await encodeQuantized(src, quantizeBits, dropAlpha === true));
            console.log(`done ${dest}`);
            return;
        }
        const source = await prepareSource(src, dropAlpha === true, alphaQuantizeBits ?? undefined);
        const lossy = await source.open().webp({ quality, exact: true }).toBuffer();
        const lossless = await source.open().webp({ lossless: true, quality: 100, exact: true }).toBuffer();
        // Ties go to lossy: it is the status quo, and preferring it keeps the winner stable for
        // any texture where the two happen to land on the same byte count.
        //
        // A VP8L winner is written exactly as it was encoded. Re-rating happens only on the other
        // branch, so no texture can trade a bit-exact encode for a cheaper lossy one.
        if (lossless.length < lossy.length) {
            await writeFile(dest, lossless);
            console.log(`done ${dest}`);
            return;
        }
        const rated =
            qualityFloor != null && distortionTolerance != null && distortionCeiling != null
                ? await selectQuality(
                      source.open,
                      source.data,
                      source.info,
                      lossy,
                      quality,
                      qualityFloor,
                      distortionTolerance,
                      distortionCeiling
                  )
                : lossy;
        await writeFile(dest, rated);
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
