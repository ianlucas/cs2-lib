/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Encodes a batch of PNG textures to WebP. Invoked once per run by the C# item-generator
// (AssetProcessor.ProcessMaterialTextures) with a JSONL manifest of jobs. Output bytes feed the
// content hashes embedded in CDN filenames, so sharp is pinned exact and nothing here may change
// encoded bytes. Constraints:
// - Every job is compared BOTH ways -- lossy VP8 at Config.WebpQuality against fully-lossless
//   VP8L -- and the smaller output wins, with near-ties going to VP8L (see WEBP_LOSSLESS_MARGIN).
//   Most jobs settle that comparison from a cheap lossless probe rather than a real VP8L encode,
//   but only where the probe PROVES the outcome, so the codec each texture gets is the codec it
//   would get from encoding both in full; see WEBP_LOSSLESS_PROBE_INFLATION. This
//   replaces the param-name carve-outs that selected a codec from the material binding; see below
//   for why picking on bytes is both smaller and safer. Note the lossy candidate is encoded at
//   Config.WebpQuality even though a lossy winner ships at Config.WebpLossyQualityCeiling: the
//   comparison picks a codec, and making its lossy side cheaper would hand masks to VP8.
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
//   Cost: a second encode per texture, and it is the expensive one -- VP8L runs 5.3x the lossy
//   encode, and 86% of them are discarded. Most of that is refunded by the probe.
// - `qualityCeiling`/`qualityFloor`/`distortionTolerance` re-rate the lossy winner AFTER min-pick
//   has chosen the codec, and the winner is re-encoded from `qualityCeiling` down -- the
//   comparison encode is discarded. `quality` is a single global number, but what a texture gets
//   for those bits is not
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
//   limit. Bits are spent only where they measurably buy fidelity.
//
//   "Full quality" here means `qualityCeiling`, not `quality`. The budget is measured on the
//   ceiling encode, so lowering the ceiling both caps the top rung and loosens the tolerance below
//   it -- the two compound, and a texture typically lands 0-10 points under the ceiling rather
//   than at it. Measured over 24 textures sampled probability-proportional-to-size from the lossy
//   population that carries alpha, ceiling 85 ships 46.3% of the q95 bytes.
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
//   normals incompressible, and the reason the saving does not scale with file size. A plane that
//   is genuine per-pixel noise has no rattle to snap and barely responds at any depth:
//   gun_grunge_psd's alpha is 1.51 MiB at 5 bits, 1.28 at 4, and still 0.67 at ONE bit, against
//   2.17 unquantized. A dithered plane collapses; that one does not, and no setting here fixes it. AK-47 | AUTOEXEC's g_tPattern alpha holds 72 distinct values, but
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
    qualityCeiling?: number;
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

// The lowest quality on the ladder whose distortion stays within budget of what the CEILING
// quality achieves on this same texture, encoded. Returns the ceiling encode when nothing below it
// qualifies -- so a texture that resists the search still ships at the ceiling, never at the
// comparison quality that min-pick was decided on.
//
// The reference is the ceiling and not `quality` on purpose. The tolerance is relative, so it only
// ever means "within 10% of some anchor"; anchoring it at the quality a texture SHIPS at is what
// makes the ladder below it reachable, and anchoring it at the comparison quality would hold every
// texture to a budget measured on an encode none of them ship.
//
// Returns the rung AND the buffer encoded at it. Every rung is encoded at WEBP_EFFORT_SHIP and
// kept, so the answer is always a buffer this function already produced and the caller writes it
// straight out: a lossy winner pays for the encodes the search needed and not one more. That is
// only affordable because effort 5 costs about what effort 4 does; see WEBP_EFFORT_SHIP.
//
// Timing: three encodes and three decodes per lossy winner, one of which ships. The ladder is
// searched binary rather than walked, which relies on distortion being monotone in quality --
// verified on the 42-texture sample, where every texture's RMSE fell at every step up the ladder.
//
// A size floor is the obvious guard if this ever needs cutting again, but it is not where the time
// is: the search costs ~24% of a texture's bytes whether it is 4 MB or 40 KB, and the encodes it
// pays for scale with pixels, so skipping the small files skips almost no work.
async function selectQuality(
    open: () => Sharp,
    reference: Buffer,
    info: { width: number; height: number; channels: number },
    qualityCeiling: number,
    floor: number,
    tolerance: number,
    distortionCeiling: number
) {
    const ladder: number[] = [];
    for (let step = qualityCeiling - QUALITY_LADDER_STEP; step >= floor; step -= QUALITY_LADDER_STEP) {
        ladder.push(step);
    }

    // Memoized so the rung the search settles on is returned rather than re-encoded. At most three
    // rungs are ever visited (the ceiling, then two steps of the binary search), so this holds
    // three buffers for the life of one job.
    const encoded = new Map<number, Buffer>();
    const probe = async (quality: number) => {
        const cached = encoded.get(quality);
        if (cached !== undefined) return cached;
        const buffer = await open().webp({ quality, exact: true, effort: WEBP_EFFORT_SHIP }).toBuffer();
        encoded.set(quality, buffer);
        return buffer;
    };
    if (ladder.length === 0) return { quality: qualityCeiling, buffer: await probe(qualityCeiling) };
    const pixels = info.width * info.height;
    const measure = async (buffer: Buffer) => {
        const { data, info: decoded } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true });
        return distortion(reference, info.channels, data, decoded.channels, pixels);
    };
    const budget = await measure(await probe(qualityCeiling));
    const fits = async (candidate: number) => {
        const measured = await measure(await probe(candidate));
        return measured <= budget * (1 + tolerance) && measured - budget <= distortionCeiling;
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
    const chosen = best === -1 ? qualityCeiling : ladder[best]!;
    return { quality: chosen, buffer: await probe(chosen) };
}

// Quality points between rungs of the search ladder. Five is the granularity libwebp's own
// quality scale is meaningful at; finer steps cost encodes to land on sizes a percent apart.
const QUALITY_LADDER_STEP = 5;

// libwebp's compression effort, split by what the encode is FOR.
//
// Effort is not a smooth dial on the lossy encoder. libwebp maps `method` onto a rate-distortion
// search level and the steps are 4 = RD_OPT_BASIC, 5 = trellis quantization on the mode it picks,
// 6 = trellis in every mode of every pass. Measured over 16 textures drawn
// probability-proportional-to-size from the manifest, encoding the same pixels at q85:
//
//   effort 4   9.99 MiB  11.4s      effort 5   9.74 MiB  12.0s      effort 6   9.60 MiB  88.3s
//
// So 5 buys 2.5% of the bytes for 5% of the time, and 6 buys another 1.4% for 7.4x. 5 is the only
// one of the three that is not a bad trade in one direction or the other, and it is what ships.
//
// The min-pick candidates stay at 4, and not because 5 is expensive. A cheaper lossy candidate wins
// min-pick more often, and the textures it would win are the masks whose lossy artifacts min-pick
// exists to retire -- so the comparison stays pinned to the effort its margin was calibrated at
// (see WEBP_LOSSLESS_MARGIN) and only the winner is re-rated.
//
// Because effort 5 is what a lossy winner ships at AND what the search ladder is probed at, the
// rung the search picks has already been encoded and is written as-is. The lossy side of a job
// therefore pays for one candidate and three ladder encodes, and no fifth encode of the winner on
// top of them. That is what makes 5 affordable where 6 was not: at effort 6 the
// ladder cannot be probed at shipping effort, so the winner has to be encoded a fifth time, and
// the fifth encode alone was 32% of the whole encoder's run time.
const WEBP_EFFORT_CANDIDATE = 4;
const WEBP_EFFORT_SHIP = 5;

// `quality` on a LOSSLESS encode is a compression-effort dial and not a fidelity one -- the output
// decodes bit-identically at every value, verified on sample normals at 100/90/50 -- and at effort
// 6 it hides libwebp's single largest cliff. VP8LEncodeImage brute-forces every entropy
// configuration when, and only when, method == 6 && quality == 100; every other pairing evaluates
// one. Measured over 16 normals drawn probability-proportional-to-size:
//
//   e6 q100  54.42 MiB  452.9s      e6 q90  57.92 MiB   76.9s      e6 q50  58.16 MiB  53.9s
//   e5 q100  57.90 MiB  128.1s      e4 q90  58.96 MiB  100.3s
//
// The brute force is worth 6.4% and costs 5.9x; every other combination lands within 0.5% of every
// other, and (6, 90) is the smallest AND the fastest of them -- it beats effort 5 at quality 100 on
// both. So the quantized path gives up the brute force: against ~2.5 GiB of normals that is ~160
// MiB, and it was ~40% of the encoder's total run time.
//
// This is the quantized path only. The min-pick lossless CANDIDATE stays at quality 100 and effort
// 4, which is not the brute-force pairing and so is not on the cliff, because its bytes both decide
// min-pick and ship unchanged for a VP8L winner.
const WEBP_LOSSLESS_QUALITY = 90;

// The cheap lossless probe that lets most textures skip the real VP8L candidate, and the bound that
// makes skipping safe.
//
// Encoding every texture losslessly is what min-pick costs, and 86% of that work is discarded:
// measured over 620 textures sampled systematically by size, only 14.2% of min-pick jobs are VP8L
// winners and the rest pay a full lossless encode purely to be told they are not. A lossless encode
// at effort 1 / quality 10 costs 24% of the real candidate and was never more than
// WEBP_LOSSLESS_PROBE_INFLATION times its size, so
//
//     probe > lossy * WEBP_LOSSLESS_MARGIN * WEBP_LOSSLESS_PROBE_INFLATION
//
// PROVES the real candidate would have lost too, and the texture takes the lossy branch without one
// being encoded. Anything that does not clear the bound falls through to the real candidate and the
// comparison is settled on exact bytes as before -- so no texture's codec changes, and no VP8L
// winner's bytes change.
//
// 2.0 is measured, with headroom. Across those 620 textures the worst inflation was 1.967, on a
// VP8L winner sitting at ratio 0.760 and therefore nowhere near the line, and the p99 was 1.331.
// The figure that actually bounds the risk is how close the rule comes to firing on a texture that
// should have won: over all 88 VP8L winners the tightest is a factor of 1.67 clear, so a probe
// would have to come out 67% larger than anything measured before one crossed. The rule skips 61%
// of the lossy population and takes the candidate stage to 53% of its cost.
//
// Effort 1 is the floor, not a tuning choice. Effort 0 sets libwebp's `low_effort` flag, which
// drops the predictor and cross-colour transforms -- precisely what makes a mask compressible --
// and inflation explodes to 69x on the low-entropy textures the probe most needs to recognise.
const WEBP_LOSSLESS_PROBE_QUALITY = 10;
const WEBP_LOSSLESS_PROBE_EFFORT = 1;
const WEBP_LOSSLESS_PROBE_INFLATION = 2.0;

// How much larger the VP8L candidate may be and still win min-pick.
//
// Without it, every knob that makes the lossy candidate cheaper is a one-directional thumb on a
// scale that decides FIDELITY, not just size. The alpha ladder is one: it shrinks a separate ALPH
// chunk faster than it shrinks alpha carried inside VP8L's own entropy coding, so taking it from 5
// bits to 4 moves near-ties toward lossy with the pixels unchanged. Measured on 40 of the
// non-normal VP8L winners, that alone crosses one of them -- and those winners are the masks and
// ID maps whose lossy artifacts min-pick was built to retire, so a flip lands exactly where it
// hurts. Running the candidates at different efforts would be another such thumb, which is why
// both are encoded at WEBP_EFFORT_CANDIDATE; at effort 6 on both, five of those 40 cross instead.
//
// The ladder can also make a VP8L candidate BIGGER, which is the same thumb pressing harder.
// sig_z4kr_holo_color goes 155,244 -> 179,492 bytes lossless when its alpha is snapped, while its
// lossy candidate shrinks -- a 0.948 -> 1.169 swing in the ratio from a change to neither codec.
// (Dropping the ladder from the lossless path is not the answer: measured over 60 VP8L winners it
// makes them 18.2% bigger in aggregate, larger on 48 of 60, and flips 26 of 60. The holo textures
// are the minority case, so the ladder stays and the margin absorbs them.)
//
// 25% is measured, not guessed, and it is nearly free because the two populations are bimodal with
// a wide gap between them. Across 60 VP8L winners the ratio runs 0.015 to 1.179 -- 57 of them below
// 0.99, then nothing until three holo textures at 1.169-1.179. Across 60 of today's LOSSY winners
// the SMALLEST ratio is 1.379; lossless is never within reach for a texture that genuinely wants
// VP8. So anything in (1.18, 1.38) separates the populations perfectly, and the margin costs the
// lossy population exactly nothing: keeping all 60 VP8L winners bit-exact costs 76,758 bytes in
// total, all of it on the three holo files.
//
// Raise it if a future knob makes lossy cheaper again and masks start flipping; the cost of raising
// it is bounded by the margin itself, on files that are small by construction.
const WEBP_LOSSLESS_MARGIN = 1.25;

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
    return sharp(data, { raw: info })
        .webp({ lossless: true, quality: WEBP_LOSSLESS_QUALITY, exact: true, effort: 6 })
        .toBuffer();
}

async function encode({
    src,
    dest,
    quality,
    dropAlpha,
    quantizeBits,
    alphaQuantizeBits,
    qualityCeiling,
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
        // The lossy candidate exists to pick a codec, not to ship: it is encoded at `quality`
        // rather than `qualityCeiling`, and at WEBP_EFFORT_CANDIDATE rather than at the effort a
        // winner ships at. A cheaper lossy candidate wins min-pick more often, and the textures it
        // would win are the masks whose lossy artifacts min-pick exists to retire -- so neither
        // knob is allowed to make one side of the comparison cheaper than it was.
        const lossy = await source.open().webp({ quality, exact: true, effort: WEBP_EFFORT_CANDIDATE }).toBuffer();
        // The largest size a lossless candidate may come out at and still win.
        const budget = lossy.length * WEBP_LOSSLESS_MARGIN;
        // The lossless candidate is the expensive half of a job and is thrown away five times out
        // of six. Encode a cheap one first: if even that clears the budget by the bound, the real
        // one would have cleared it too, and it is never encoded at all. The bound is what keeps
        // this from being a guess -- see WEBP_LOSSLESS_PROBE_INFLATION.
        const losslessProbe = await source
            .open()
            .webp({
                lossless: true,
                quality: WEBP_LOSSLESS_PROBE_QUALITY,
                exact: true,
                effort: WEBP_LOSSLESS_PROBE_EFFORT
            })
            .toBuffer();
        const lossless =
            losslessProbe.length > budget * WEBP_LOSSLESS_PROBE_INFLATION
                ? undefined
                : await source
                      .open()
                      .webp({ lossless: true, quality: 100, exact: true, effort: WEBP_EFFORT_CANDIDATE })
                      .toBuffer();
        // Ties, and near-ties inside WEBP_LOSSLESS_MARGIN, go to lossless -- it is bit-exact, and
        // the margin is what keeps the alpha ladder from walking marginal textures across the line.
        // See WEBP_LOSSLESS_MARGIN.
        //
        // A VP8L winner is written exactly as it was encoded. Re-rating happens only on the other
        // branch, so no texture can trade a bit-exact encode for a cheaper lossy one.
        if (lossless !== undefined && lossless.length <= budget) {
            // Written exactly as the comparison saw it. Effort is worth only ~0.6% to a lossless
            // encode against ~6x its time, and quality 100 at effort 4 is off the brute-force
            // cliff (see WEBP_LOSSLESS_QUALITY), so there is nothing left to re-encode for.
            await writeFile(dest, lossless);
            console.log(`done ${dest}`);
            return;
        }
        // The search encodes its ladder at WEBP_EFFORT_SHIP and hands back the buffer for the rung
        // it settled on, so the winner ships an encode that has already been paid for. Only a job
        // that opted out of the search has to encode one here.
        const rated =
            qualityCeiling != null && qualityFloor != null && distortionTolerance != null && distortionCeiling != null
                ? await selectQuality(
                      source.open,
                      source.data,
                      source.info,
                      qualityCeiling,
                      qualityFloor,
                      distortionTolerance,
                      distortionCeiling
                  )
                : { buffer: await source.open().webp({ quality, exact: true, effort: WEBP_EFFORT_SHIP }).toBuffer() };
        await writeFile(dest, rated.buffer);
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
