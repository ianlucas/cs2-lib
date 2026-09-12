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
// A job MAY carry an `encode` descriptor selecting a smaller per-texture encoding. The descriptor is
// tagged with the family that owns it, because the two families are tuned on different evidence and
// must not share a code path:
//
//   kind "sticker"  the plain width/quality tier owned by StickerTextureOptimization. Unchanged.
//   kind "weapon"   the guarded tier owned by WeaponTextureOptimization. C# owns the POLICY (which
//                   property gets which tier and with what thresholds); this file owns the
//                   MEASUREMENT -- every "guard" below is a texture-driven classifier evaluated
//                   against the pristine PNG, never against a filename.
//
// A job with no descriptor takes the exact original lossless path below, so its bytes -- and filename
// hash -- never change.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { dirname } from "node:path";
import sharp from "sharp";

// A weapon tier's encode knobs. Everything optional is off unless the C# tier names it.
//   stripAlpha      drop the alpha channel before encoding.
//   minWidth        only touch textures at least this wide; narrower ones fall back to default lossless.
//   maxWidth        downscale (aspect-preserving) so the long side is at most this.
//   smartSubsample  force 4:4:4. Use when RGB packs independent data rather than a colour.
//   alphaQuality    compress the ALPHA plane too (a coverage mask can dominate the file).
//   effort          libwebp's method (0-6). Pure encoder search time at the same quality target, so it
//                   is free size; everything here runs at 6.
//   decimate        point-sample the RGB downscale instead of averaging it. Only for GRAIN textures:
//                   a decimated white-noise field is still white noise with the same amplitude and
//                   histogram, while any averaging kernel collapses it toward the mean.
//   grainBoost      after decimating, scale each texel's deviation from its own 2x2 block mean by this,
//                   to offset the contrast the sampler's bilinear magnification puts back.
//   maskKernel      area-downscale EVERY plane, not just alpha. For a texture whose RGB is data rather
//                   than a picture, Lanczos' negative lobes overshoot each region edge and invent
//                   weights outside the range the two neighbouring regions had. Box averaging cannot.
//   posterize       quantize each plane to buckets this wide before a LOSSLESS encode, holding 0 and
//                   255 exact. The error is HARD-BOUNDED at posterize/2 per texel, which is what makes
//                   it usable on data planes where lossy is not.
//   flattenAlpha    replace alpha with a constant 255, so WebP omits the ALPH chunk entirely. Only for
//                   a DEGENERATE alpha plane -- see maskGuard and flattenGuard.
//   greyscale       encode the R plane alone (what greyGuard turns on).
//
// The guards, in the order this file runs them:
//   greyGuard       SINGLE-CHANNEL property (one whose shader samples .r and nothing else): if the
//                   pristine PNG is a replicated luma (R=G=B) with a constant-255 alpha, encode only
//                   the R plane and drop the other three. Runs FIRST, ahead of every other guard, so
//                   the fidelity gate measures what actually ships. Nothing is thrown away that the
//                   shader could read: the two chroma planes were copies of R and the alpha was a
//                   constant 255, which is exactly what a missing alpha plane decodes to.
//   noiseGuard      mean lag-1 autocorrelation of the RGB planes. Artwork sits at ~0.99; a spray or
//                   stipple grain sits near 0.3. Below `maxLag1` the texture takes `fallback` --
//                   otherwise lossyGuard would (correctly, by its own metric) call it "complex" and
//                   spend the whole budget keeping noise lossless, which is the one thing that cannot
//                   be seen.
//   sfxGuard        a packed data texture whose THIRD plane is optional (g_tMetalness' B = SFX mask):
//                   if B carries real data the file is routed to `guardFallback` so no DCT touches it.
//                   A lossy encode cannot hold a constant plane still.
//   lossyGuard      encode the tier lossy at NATIVE resolution, decode it, and measure RGB PSNR
//                   against the pristine PNG. Below `minPsnr` the texture is a high-frequency
//                   region/coverage mask or camo whose values matter, and it takes `guardFallback`
//                   (or plain lossless when the tier names none).
//   alphaGuard      independent of everything above: measure what fraction of the mask is SOFT
//                   (neither 0 nor 255) and only compress alpha when that clears `minSoft`. A hard
//                   binary cut mask is left lossless -- lossy ringing at its 0/255 edges is what the
//                   viewer magnifies into a wear-boundary artifact.
//   maskGuard       for a 4-plane data mask: flattens a degenerate alpha plane, and records whether
//                   R==G==B so maskBudget knows which ladder the texture belongs on.
//   flattenGuard    maskGuard's counterpart for a property whose alpha is real transparency: the plane
//                   is dropped only when it spans at most DEGENERATE_ALPHA_SPAN counts AND tops out at
//                   255. Both halves are required -- a plane spanning two counts near ZERO is fully
//                   transparent, and flattening that one to 255 would paint the overlay on at full
//                   strength.
//   sizeBudget      LAST pass on a lossy tier: if the encode still lands above `maxBytes`, step
//                   quality down until it fits or hits `minQuality`. `minAlphaQuality` opts the ALPHA
//                   plane into the same walk -- off by default, because on most properties the mask
//                   must not be degraded to pay for the colour.
//   maskBudget      the counterpart for a mask tier: down the `qualities` ladder for a replicated
//                   mask, or the posterize `steps` ladder for a chromatic one. A mask that already
//                   fits is never touched at all.
interface EncodeSpec {
    kind?: "sticker" | "weapon";
    mode: "lossless" | "lossy" | "nearLossless";
    quality?: number;
    stripAlpha?: boolean;
    minWidth?: number;
    maxWidth?: number;
    smartSubsample?: boolean;
    alphaQuality?: number;
    effort?: number;
    decimate?: boolean;
    grainBoost?: number;
    maskKernel?: boolean;
    posterize?: number;
    flattenAlpha?: boolean;
    greyscale?: boolean;
    greyGuard?: boolean;
    noiseGuard?: { maxLag1: number; fallback: EncodeSpec };
    sfxGuard?: boolean;
    lossyGuard?: { minPsnr: number };
    guardFallback?: EncodeSpec;
    alphaGuard?: { minSoft: number; alphaQuality: number };
    maskGuard?: boolean;
    flattenGuard?: boolean;
    sizeBudget?: { maxBytes: number; minQuality: number; minAlphaQuality?: number };
    maskBudget?: { maxBytes: number; qualities: number[]; steps: number[] };
}

interface EncodeJob {
    src: string;
    dest: string;
    encode?: EncodeSpec;
}

// The default encoding, used for every texture without a descriptor and for a tiered texture that
// falls back (too narrow to touch). Kept byte-for-byte as the historical path for hash stability.
const LOSSLESS = { lossless: true, exact: true } as const;

// An alpha plane whose whole range spans this many counts or fewer carries no weight a blend can show.
const DEGENERATE_ALPHA_SPAN = 2;

// Any channel already using few enough distinct values is a PRE-QUANTIZED selector plane: VP8L
// compresses it to almost nothing, so posterizing it buys no bytes worth having and only risks MERGING
// two palette levels the artist deliberately kept apart.
const POSTERIZE_SKIP_DISTINCT = 32;

// A guarded encode materializes 16 MP raw buffers, two at a time for a PSNR check, so weapon jobs run
// on a tighter leash than the plain lossless ones that make up the rest of the batch.
const GUARDED_CONCURRENCY = 4;

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
            console.log(`done ${dest}`);
        } else if (spec.kind === "weapon") {
            const { data, label } = await encodeWeapon(src, spec);
            await writeFile(dest, data);
            console.log(`done ${dest} ${label}`);
        } else {
            await encodeSticker(src, dest, spec);
            console.log(`done ${dest}`);
        }
    } catch (error) {
        failed += 1;
        console.error(`error ${src}: ${error instanceof Error ? error.message : error}`);
    }
}

async function encodeSticker(src: string, dest: string, spec: EncodeSpec) {
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

// ---------------------------------------------------------------------------------------------
// Pixel measurement and resampling. Everything below reads the PRISTINE PNG, never a WebP, so a
// guard's verdict is about the source art rather than about some earlier encode of it.
// ---------------------------------------------------------------------------------------------

// Quantize each channel of a raw plane in place to `step`-wide buckets, holding 0 and 255 EXACT: a
// region-weight plane's "fully off" and "fully on" must stay exactly off/on, or a palette slot bleeds
// in where the artist put none. The LUT is clamped because Math.round(254 / 16) * 16 is 256, which
// wraps to 0 in a byte and would turn the brightest texels black.
function posterizePlanes(plane: Buffer, channels: number, step: number, skipDistinct: number): void {
    for (let c = 0; c < channels; c++) {
        const seen = new Uint8Array(256);
        for (let i = c; i < plane.length; i += channels) seen[plane[i]!] = 1;
        let distinct = 0;
        for (let v = 0; v < 256; v++) distinct += seen[v]!;
        if (distinct <= skipDistinct) continue;
        const lut = new Uint8Array(256);
        for (let v = 0; v < 256; v++) {
            lut[v] = v === 0 ? 0 : v === 255 ? 255 : Math.max(0, Math.min(255, Math.round(v / step) * step));
        }
        for (let i = c; i < plane.length; i += channels) plane[i] = lut[plane[i]!]!;
    }
}

// Area-average ("box") downscale of a single raw plane, srcW x srcH -> dstW x dstH, `channels` deep.
// Unlike Lanczos this kernel has NO negative lobes, so a hard step edge (an alpha cut mask's 0/255
// boundary) averages toward the mean with zero overshoot -- no ringing, no wear-boundary artifact once
// the viewer upsamples for its bake. Separable (horizontal then vertical) with fractional edge weights,
// so it is exact for the 2x case and correct for any ratio. Only used to downscale; never enlarges.
function areaDownscale(src: Buffer, srcW: number, srcH: number, dstW: number, dstH: number, channels: number): Buffer {
    const accumulate = (
        input: ArrayLike<number>,
        inLen: number, // length of the resampled axis in the input
        outLen: number, // length of the resampled axis in the output
        lines: number, // count of the perpendicular axis
        strideAlong: number, // element step along the resampled axis
        stridePerp: number, // element step along the perpendicular axis
        write: (line: number, out: number, ch: number, value: number) => void
    ): void => {
        const scale = inLen / outLen;
        for (let o = 0; o < outLen; o++) {
            const start = o * scale;
            const end = start + scale;
            const i0 = Math.floor(start);
            const i1 = Math.min(inLen - 1, Math.ceil(end) - 1);
            for (let line = 0; line < lines; line++) {
                for (let c = 0; c < channels; c++) {
                    let acc = 0;
                    let wsum = 0;
                    for (let i = i0; i <= i1; i++) {
                        const w = Math.min(i + 1, end) - Math.max(i, start);
                        if (w <= 0) continue;
                        acc += input[line * stridePerp + i * strideAlong + c]! * w;
                        wsum += w;
                    }
                    write(line, o, c, wsum === 0 ? 0 : acc / wsum);
                }
            }
        }
    };
    // Horizontal pass: srcW -> dstW, keeping srcH rows. Store intermediate as Float32 for accuracy.
    const tmp = new Float32Array(dstW * srcH * channels);
    accumulate(src, srcW, dstW, srcH, channels, srcW * channels, (row, ox, c, v) => {
        tmp[(row * dstW + ox) * channels + c] = v;
    });
    // Vertical pass: srcH -> dstH over the dstW-wide intermediate, rounding to bytes.
    const out = Buffer.alloc(dstW * dstH * channels);
    accumulate(tmp, srcH, dstH, dstW, dstW * channels, channels, (col, oy, c, v) => {
        out[(oy * dstW + col) * channels + c] = Math.max(0, Math.min(255, Math.round(v)));
    });
    return out;
}

// Point-sample ("nearest") downscale of a raw plane. For a NOISE field this is the only kernel that
// preserves the signal: white noise decimated is still white noise, with an unchanged amplitude and
// histogram, only at half the frequency -- whereas every averaging kernel drives it toward the mean
// (a 2x box halves the standard deviation), which reads as the grain "washing out" into blotches.
// For artwork this is plain aliasing, so it is gated behind noiseGuard.
function decimatePlane(src: Buffer, srcW: number, srcH: number, dstW: number, dstH: number, channels: number): Buffer {
    const out = Buffer.alloc(dstW * dstH * channels);
    const sx = srcW / dstW;
    const sy = srcH / dstH;
    for (let y = 0; y < dstH; y++) {
        const iy = Math.min(srcH - 1, Math.floor((y + 0.5) * sy));
        for (let x = 0; x < dstW; x++) {
            const ix = Math.min(srcW - 1, Math.floor((x + 0.5) * sx));
            for (let c = 0; c < channels; c++)
                out[(y * dstW + x) * channels + c] = src[(iy * srcW + ix) * channels + c]!;
        }
    }
    return out;
}

// Restores the grain contrast that the sampler's bilinear magnification will smooth back out, by
// scaling each decimated texel's deviation from its own source-block mean. `local` (the area downscale
// of the same plane) IS that block mean, so this boosts only the high-frequency residual and leaves the
// texture's low-frequency structure -- its soft colour blobs -- untouched.
function boostGrain(decimated: Buffer, local: Buffer, gain: number): Buffer {
    const out = Buffer.alloc(decimated.length);
    for (let i = 0; i < decimated.length; i++) {
        const value = local[i]! + (decimated[i]! - local[i]!) * gain;
        out[i] = Math.max(0, Math.min(255, Math.round(value)));
    }
    return out;
}

// RGB PSNR (dB) between the pristine PNG and a candidate WebP buffer, both at native resolution.
// Alpha is ignored: it is encoded losslessly and is not what the gate is judging.
async function psnrRgb(png: string, webp: Buffer): Promise<number> {
    const [a, b] = await Promise.all([
        sharp(png).removeAlpha().raw().toBuffer(),
        sharp(webp).removeAlpha().raw().toBuffer()
    ]);
    const n = Math.min(a.length, b.length);
    let sse = 0;
    for (let i = 0; i < n; i++) {
        const d = a[i]! - b[i]!;
        sse += d * d;
    }
    const mse = sse / n;
    return mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse);
}

// Mean lag-1 autocorrelation of the RGB planes (horizontal and vertical). It says what KIND of signal
// the RGB is: ~0.99 is painted artwork (neighbouring texels agree), ~0.3 is spray/stipple grain in
// independent selector fields. Rows are subsampled: this only has to separate two populations that sit
// an order of magnitude apart, not measure either precisely.
async function lag1Autocorrelation(png: string, width: number, height: number): Promise<number> {
    const rgb = await sharp(png).removeAlpha().raw().toBuffer();
    const step = Math.max(1, Math.floor(height / 512));
    const mean = [0, 0, 0];
    const sd = [0, 0, 0];
    for (let c = 0; c < 3; c++) {
        let s = 0;
        let s2 = 0;
        let count = 0;
        for (let y = 0; y < height; y += step) {
            const row = y * width * 3;
            for (let x = 0; x < width; x++) {
                const v = rgb[row + x * 3 + c]!;
                s += v;
                s2 += v * v;
                count++;
            }
        }
        mean[c] = s / count;
        sd[c] = Math.sqrt(Math.max(1e-9, s2 / count - mean[c]! * mean[c]!));
    }
    let lagH = 0;
    let lagV = 0;
    let lagHn = 0;
    let lagVn = 0;
    for (let y = 0; y < height; y += step) {
        const row = y * width * 3;
        const rowBelow = y + 1 < height ? (y + 1) * width * 3 : -1;
        for (let x = 0; x < width; x++) {
            const i = row + x * 3;
            const dr = rgb[i]! - mean[0]!;
            const dg = rgb[i + 1]! - mean[1]!;
            const db = rgb[i + 2]! - mean[2]!;
            if (x + 1 < width) {
                const j = i + 3;
                lagH += dr * (rgb[j]! - mean[0]!) + dg * (rgb[j + 1]! - mean[1]!) + db * (rgb[j + 2]! - mean[2]!);
                lagHn += 3;
            }
            if (rowBelow >= 0) {
                const j = rowBelow + x * 3;
                lagV += dr * (rgb[j]! - mean[0]!) + dg * (rgb[j + 1]! - mean[1]!) + db * (rgb[j + 2]! - mean[2]!);
                lagVn += 3;
            }
        }
    }
    const varMean = (sd[0]! * sd[0]! + sd[1]! * sd[1]! + sd[2]! * sd[2]!) / 3;
    return (lagH / lagHn + lagV / lagVn) / 2 / varMean;
}

// Fraction of the alpha plane that is SOFT -- neither fully transparent nor fully opaque. A binary cut
// mask sits near 0 (every texel is 0 or 255, so the mask is all hard edges); a coverage/translucency
// ramp sits near 1. Rows are subsampled: this only has to tell two far-apart populations apart.
async function alphaSoftFraction(png: string, width: number, height: number): Promise<number> {
    const alpha = await sharp(png).extractChannel(3).raw().toBuffer();
    const step = Math.max(1, Math.floor(height / 512));
    let soft = 0;
    let seen = 0;
    for (let y = 0; y < height; y += step) {
        const row = y * width;
        for (let x = 0; x < width; x++) {
            const v = alpha[row + x]!;
            if (v !== 0 && v !== 255) soft++;
            seen++;
        }
    }
    return seen === 0 ? 0 : soft / seen;
}

interface MaskFacts {
    replicated: boolean;
    alphaSpan: number;
    alphaMax: number;
    blueSpan: number;
}

// The facts greyGuard / maskGuard / flattenGuard / sfxGuard need, in one pass over the pristine PNG.
// Scanned in FULL, not subsampled: all of them are extremes (a max deviation, a min/max span) rather
// than averages, and one stray texel is exactly what would make an "independent" mask look replicated
// or a real alpha plane look degenerate.
async function analyzeMaskPlanes(png: string): Promise<MaskFacts> {
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const n = info.width * info.height;
    let maxRG = 0;
    let maxBG = 0;
    let aMin = 255;
    let aMax = 0;
    let bMin = 255;
    let bMax = 0;
    for (let i = 0; i < n; i++) {
        const o = i * 4;
        const g = data[o + 1]!;
        const b = data[o + 2]!;
        const rg = Math.abs(data[o]! - g);
        const bg = Math.abs(b - g);
        if (rg > maxRG) maxRG = rg;
        if (bg > maxBG) maxBG = bg;
        if (b < bMin) bMin = b;
        if (b > bMax) bMax = b;
        const a = data[o + 3]!;
        if (a < aMin) aMin = a;
        if (a > aMax) aMax = a;
    }
    // Tolerance rather than exact equality: a field replicated through an 8-bit round-trip can sit a
    // count apart on one channel and is still one field.
    return { replicated: maxRG <= 2 && maxBG <= 2, alphaSpan: aMax - aMin, alphaMax: aMax, blueSpan: bMax - bMin };
}

// ---------------------------------------------------------------------------------------------
// The guarded weapon encode.
// ---------------------------------------------------------------------------------------------

// A compact description of what a texture actually got, appended to its `done` line so a build log
// records the route each guard took rather than just that something happened.
const specLabel = (s: EncodeSpec): string => {
    const qual = s.mode === "lossless" ? "" : ` q${s.quality}`;
    const alpha = s.alphaQuality !== undefined ? ` a${s.alphaQuality}` : "";
    const kernel = s.decimate === true ? " decimate" : s.maskKernel === true ? " area" : "";
    const post = s.posterize !== undefined ? ` post/${s.posterize}` : "";
    const flat = s.flattenAlpha === true ? " -flatA" : "";
    const chroma = s.smartSubsample === true ? " 4:4:4" : "";
    const grey = s.greyscale === true ? " grey" : "";
    const strip = s.stripAlpha === true ? " -A" : "";
    const cap = s.maxWidth !== undefined ? ` <=${s.maxWidth}px` : "";
    return `${s.mode}${qual}${alpha}${chroma}${grey}${kernel}${post}${flat}${strip}${cap}`;
};

// The tier a never-regress fallback encodes with. Two things it must not get wrong, both of which were
// measured the hard way:
//
//   KEEP THE CAP. Dropping the resolution cap along with the lossy mode ships a 4K source LOSSLESS AT
//   4096 whenever its lossy-at-2048 encode happens to lose on bytes.
//
//   USE THE AREA KERNEL. Never-regress fires precisely when lossless beats lossy, which is the
//   signature of a flat, few-distinct-value stencil/region mask -- the exact content Lanczos handles
//   worst. Its negative lobes ring at every hard edge and each ring is a new intermediate value, so a
//   near-flat image becomes a noisy one and VP8L's predictors lose. Measured on the two textures this
//   branch actually produced (usaf_round_psd, tiger_camo_psd, both 4096 binary-alpha stencils):
//       native 4096 lossless   281K / 344K   (what the missing cap shipped)
//       2048 Lanczos lossless  537K / 518K   (capping with the wrong kernel -- WORSE than not capping)
//       2048 area lossless     210K / 210K   (capping with the right one)
//   So fixing only the cap would have made both files ~1.6x bigger. Both parts are required.
const losslessFallback = (base: EncodeSpec): EncodeSpec => ({
    kind: "weapon",
    mode: "lossless",
    quality: 100,
    maxWidth: base.maxWidth,
    stripAlpha: base.stripAlpha,
    maskKernel: true
});

async function encodeWeapon(src: string, baseSpec: EncodeSpec): Promise<{ data: Buffer; label: string }> {
    const meta = await sharp(src).metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;

    // Width gate: an already-small texture keeps the default lossless encoding, byte-identical to what
    // an untiered texture gets.
    if (baseSpec.minWidth !== undefined && width < baseSpec.minWidth) {
        return { data: await sharp(src).webp(LOSSLESS).toBuffer(), label: "lossless (below minWidth)" };
    }

    const encodeWith = async (spec: EncodeSpec): Promise<Buffer> => {
        const downscale = spec.maxWidth !== undefined && width > spec.maxWidth;
        const resizeOpts = { width: spec.maxWidth, withoutEnlargement: true, kernel: "lanczos3" as const };
        const outW = downscale ? spec.maxWidth! : width;
        const outH = downscale ? Math.max(1, Math.round((outW / width) * height)) : height;
        let pipeline: ReturnType<typeof sharp>;
        if (spec.greyscale === true) {
            // SINGLE-PLANE path (greyGuard verified R=G=B and an opaque alpha): encode the R plane on
            // its own. Materialized to raw first for the same reason the paths below do it -- a fused
            // resize would premultiply against alpha -- and area-downscaled if a cap is ever asked for,
            // since a scalar data field is a mask, not a picture.
            const plane = await sharp(src).extractChannel(0).raw().toBuffer();
            const data = downscale ? areaDownscale(plane, width, height, outW, outH, 1) : plane;
            pipeline = sharp(data, { raw: { width: outW, height: outH, channels: 1 } });
        } else if (spec.maskKernel === true && spec.stripAlpha !== true) {
            // MASK path: every plane is data, so they all area-downscale together and none of them goes
            // near Lanczos. Materializing the raw RGBA first is also what keeps the four planes
            // INDEPENDENT -- sharp fuses resize into the loader and premultiplies RGB by alpha, which on
            // a paint-by-number mask would zero the RGB weights everywhere the 4th palette slot is
            // absent. Posterization (when the budget pass asks for it) happens here, on the final
            // pixels, so what gets quantized is exactly what gets encoded.
            const channels = meta.hasAlpha === true ? 4 : 3;
            const raw =
                channels === 4
                    ? await sharp(src).ensureAlpha().raw().toBuffer()
                    : await sharp(src).removeAlpha().raw().toBuffer();
            const data = downscale ? areaDownscale(raw, width, height, outW, outH, channels) : Buffer.from(raw);
            if (spec.posterize !== undefined) {
                posterizePlanes(data, channels, spec.posterize, POSTERIZE_SKIP_DISTINCT);
            }
            // A degenerate alpha plane becomes a constant 255, which makes the image fully opaque and
            // libwebp then omits the ALPH chunk altogether.
            if (spec.flattenAlpha === true && channels === 4) {
                for (let i = 0; i < outW * outH; i++) data[i * 4 + 3] = 255;
            }
            pipeline = sharp(data, { raw: { width: outW, height: outH, channels } });
        } else if ((downscale || spec.flattenAlpha === true) && meta.hasAlpha === true && spec.stripAlpha !== true) {
            // Resize RGB and alpha as INDEPENDENT planes. sharp fuses resize into the loader and
            // premultiplies RGB by alpha, which zeroes every RGB pixel wherever alpha is 0 -- a data
            // texture whose alpha is fully transparent (e.g. a normal map) then decodes to a blank
            // image, and a paint pattern's RGB under its cut mask (which the shader still samples) gets
            // darkened. A pipelined removeAlpha() does NOT help (the loader premultiplies first), so we
            // materialize each plane to a raw buffer and resize fresh instances that have no alpha to
            // premultiply against. `exact` alone only covers the encode step, not the resize.
            const [rgbRaw, alphaRaw] = await Promise.all([
                sharp(src).removeAlpha().raw().toBuffer(),
                sharp(src).extractChannel(3).raw().toBuffer()
            ]);
            let rgbData: Buffer;
            if (!downscale) {
                rgbData = Buffer.from(rgbRaw);
            } else if (spec.decimate === true) {
                // Grain: point-sample, then put back the contrast bilinear magnification will remove.
                const picked = decimatePlane(rgbRaw, width, height, outW, outH, 3);
                rgbData =
                    spec.grainBoost === undefined
                        ? picked
                        : boostGrain(picked, areaDownscale(rgbRaw, width, height, outW, outH, 3), spec.grainBoost);
            } else {
                // RGB downscales with Lanczos for sharp artwork; sharp sizes the output, so mirror its
                // rounding here to keep the hand-rolled alpha kernel lined up with it.
                rgbData = await sharp(rgbRaw, { raw: { width, height, channels: 3 } })
                    .resize({ ...resizeOpts, height: outH })
                    .raw()
                    .toBuffer();
            }
            // Alpha always area-averages, decimated grain or not: it is a shape/coverage mask, and
            // point-sampling one would jag its edges exactly the way it preserves the grain. A flattened
            // plane skips all of that: a constant 255 makes the image opaque and libwebp then omits the
            // ALPH chunk, which is what a degenerate-opaque plane already meant.
            const alphaData =
                spec.flattenAlpha === true
                    ? Buffer.alloc(outW * outH, 255)
                    : downscale
                      ? areaDownscale(alphaRaw, width, height, outW, outH, 1)
                      : Buffer.from(alphaRaw);
            pipeline = sharp(rgbData, { raw: { width: outW, height: outH, channels: 3 } }).joinChannel(alphaData, {
                raw: { width: outW, height: outH, channels: 1 }
            });
        } else {
            pipeline = sharp(src);
            if (downscale) pipeline = pipeline.resize(resizeOpts);
            if (spec.stripAlpha === true) pipeline = pipeline.removeAlpha();
        }
        const options =
            spec.mode === "nearLossless"
                ? { nearLossless: true, quality: spec.quality ?? 100, exact: true }
                : spec.mode === "lossless"
                  ? { lossless: true, exact: true, effort: 6 }
                  : {
                        quality: spec.quality ?? 90,
                        exact: true,
                        // libwebp method 6: same quality target, the encoder just searches harder.
                        effort: spec.effort ?? 6,
                        ...(spec.smartSubsample === true ? { smartSubsample: true } : {}),
                        ...(spec.alphaQuality !== undefined ? { alphaQuality: spec.alphaQuality } : {})
                    };
        return pipeline.webp(options).toBuffer();
    };

    // The never-regress baseline: what this texture would weigh on the untiered path. Computed lazily
    // and once, because only a lossy tier can lose to it and most textures never ask.
    let losslessBytes: number | undefined;
    const baselineBytes = async (): Promise<number> => {
        losslessBytes ??= (await sharp(src).webp(LOSSLESS).toBuffer()).length;
        return losslessBytes;
    };

    let spec = baseSpec;
    let maskFacts: MaskFacts | undefined;

    // GREY guard, FIRST: it changes what every later gate is looking at. A property whose shader reads
    // only .r can drop the other three planes outright -- but only once this has confirmed, on the
    // pristine PNG, that R really is replicated across G/B and that alpha really is a constant 255
    // (dropping an alpha that is anything else would hand the shader 1.0 where it read something).
    if (baseSpec.greyGuard === true) {
        maskFacts = await analyzeMaskPlanes(src);
        const opaque =
            meta.hasAlpha !== true || (maskFacts.alphaSpan <= DEGENERATE_ALPHA_SPAN && maskFacts.alphaMax >= 253);
        if (maskFacts.replicated && opaque) spec = { ...spec, greyscale: true };
    }

    // Grain gate, ahead of the fidelity gate. A stipple/spray pattern fails the PSNR test by
    // construction (lossy destroys noise), so lossyGuard would file it under "complex" and keep it
    // lossless -- paying full price for a realization nothing can see, while the averaging downscale
    // quietly washed the grain out anyway. Route it to the tier built for it instead.
    if (baseSpec.noiseGuard !== undefined) {
        const lag1 = await lag1Autocorrelation(src, width, height);
        if (lag1 < baseSpec.noiseGuard.maxLag1) {
            const grain = baseSpec.noiseGuard.fallback;
            let data = await encodeWith(grain);
            // Same never-regress rule as the main path: a small grain texture can encode larger lossy
            // than lossless, and there is no reason to take a fidelity loss for a bigger file.
            if (data.length >= (await baselineBytes())) {
                const fallback = losslessFallback(baseSpec);
                data = await encodeWith(fallback);
                return { data, label: `${specLabel(fallback)} (grain, regressed)` };
            }
            return { data, label: `${specLabel(grain)} (grain)` };
        }
    }

    // SFX guard, also ahead of the fidelity gate: a packed data texture whose optional third plane is
    // actually in use must not go anywhere near a DCT, because lossy cannot hold that plane still.
    let sfxRouted = false;
    if (baseSpec.sfxGuard === true && baseSpec.guardFallback !== undefined) {
        maskFacts ??= await analyzeMaskPlanes(src);
        if (maskFacts.blueSpan > DEGENERATE_ALPHA_SPAN) {
            spec = baseSpec.guardFallback;
            sfxRouted = true;
        }
    }

    // Texture-driven fidelity gate. CLASSIFY at native resolution (no downscale) so the candidate
    // matches the PNG pixel-for-pixel and the RGB PSNR is meaningful: if the lossy reconstruction is too
    // far from the source, this is a region-weight mask / camo whose values matter -- encode it lossless
    // instead of lossy. The chosen tier's downscale is then applied to the OUTPUT below, independent of
    // the classification (artwork lossy-downscale, masks lossless-downscale).
    let gateRejected = false;
    if (baseSpec.lossyGuard !== undefined && baseSpec.mode === "lossy" && !sfxRouted) {
        const nativeCandidate = await encodeWith({ ...spec, maxWidth: undefined });
        if ((await psnrRgb(src, nativeCandidate)) < baseSpec.lossyGuard.minPsnr) {
            gateRejected = true;
            spec =
                baseSpec.guardFallback ??
                ({ kind: "weapon", mode: "lossless", quality: 100, maxWidth: baseSpec.maxWidth } as EncodeSpec);
        }
    }

    // ALPHA gate, applied to whichever tier the guards above landed on. Only a lossy tier that has not
    // already declared an alphaQuality is eligible: a grain tier sets its own, and a lossless tier has
    // no alpha plane to trade.
    if (
        baseSpec.alphaGuard !== undefined &&
        spec.mode === "lossy" &&
        spec.alphaQuality === undefined &&
        meta.hasAlpha === true &&
        (await alphaSoftFraction(src, width, height)) >= baseSpec.alphaGuard.minSoft
    ) {
        spec = { ...spec, alphaQuality: baseSpec.alphaGuard.alphaQuality };
    }

    // MASK guard, on the pristine PNG. Flattening is applied unconditionally when the alpha plane is
    // degenerate -- there is nothing there to preserve at any file size -- while the replication verdict
    // is only consulted if the maskBudget below actually has to spend something.
    if (baseSpec.maskGuard === true) {
        maskFacts ??= await analyzeMaskPlanes(src);
        if (meta.hasAlpha === true && maskFacts.alphaSpan <= DEGENERATE_ALPHA_SPAN) {
            spec = { ...spec, flattenAlpha: true };
        }
    }

    // FLATTEN guard, the maskGuard's counterpart for a property whose alpha is real TRANSPARENCY rather
    // than a data plane. Same evidence, stricter test: the plane goes only if it spans at most
    // DEGENERATE_ALPHA_SPAN counts AND reaches 255, so "opaque to within rounding" is dropped while
    // "transparent to within rounding" -- which flattening would turn into a fully painted overlay --
    // is not. Unconditional, not budget-triggered: there is nothing in such a plane to preserve.
    if (baseSpec.flattenGuard === true && meta.hasAlpha === true) {
        maskFacts ??= await analyzeMaskPlanes(src);
        if (maskFacts.alphaSpan <= DEGENERATE_ALPHA_SPAN && maskFacts.alphaMax >= 253) {
            spec = { ...spec, flattenAlpha: true };
        }
    }

    let candidate = await encodeWith(spec);

    // SIZE BUDGET, last: every guard above has already picked a tier, and this only asks whether the
    // result is still too big. Steps quality down in coarse increments (the curve is shallow) and stops
    // at the first fit, or at minQuality. Alpha is NOT touched by default: the alphaGuard has already
    // made that call on its own evidence, and a mask-dominated file should not have its mask degraded to
    // pay for its colour. A tier that sets `minAlphaQuality` opts out of that rule, because on it the
    // mask IS the file and an RGB-only walk would grind to minQuality without moving the bytes. Alpha
    // then walks its own range linearly across the SAME rungs, so the two levers arrive at the bottom
    // together and a file that fits early never reaches either of them.
    if (
        baseSpec.sizeBudget !== undefined &&
        spec.mode === "lossy" &&
        candidate.length > baseSpec.sizeBudget.maxBytes &&
        (spec.quality ?? 0) > baseSpec.sizeBudget.minQuality
    ) {
        const { maxBytes, minQuality, minAlphaQuality } = baseSpec.sizeBudget;
        const steps: number[] = [];
        for (let q = (spec.quality ?? 0) - 6; q > minQuality; q -= 6) steps.push(q);
        steps.push(minQuality);
        const alphaFrom = spec.alphaQuality;
        const walkAlpha = minAlphaQuality !== undefined && alphaFrom !== undefined && alphaFrom > minAlphaQuality;
        for (let i = 0; i < steps.length; i++) {
            const quality = steps[i]!;
            const alphaQuality = walkAlpha
                ? Math.round(alphaFrom! - ((alphaFrom! - minAlphaQuality!) * (i + 1)) / steps.length)
                : spec.alphaQuality;
            spec = { ...spec, quality, alphaQuality };
            candidate = await encodeWith(spec);
            if (candidate.length <= maxBytes) break;
        }
    }

    // MASK BUDGET. Only fires when the encode is still over budget, so a mask that already fits stays
    // bit-exact. Which ladder it walks is decided by the maskGuard's replication verdict, because the
    // two populations fail under opposite encoders. Both walk gentlest-first and stop at the first fit.
    if (baseSpec.maskBudget !== undefined && candidate.length > baseSpec.maskBudget.maxBytes) {
        const { maxBytes, qualities, steps } = baseSpec.maskBudget;
        if (maskFacts?.replicated === true) {
            // Replicated greyscale: chroma is constant, so 4:2:0 costs nothing and quality is the lever.
            for (const quality of qualities) {
                spec = { ...spec, mode: "lossy", quality, smartSubsample: true };
                candidate = await encodeWith(spec);
                if (candidate.length <= maxBytes) break;
            }
        } else {
            // Independent planes: lossy would shred them through the chroma subsampler, so trade a
            // HARD-BOUNDED quantization error instead.
            for (const posterize of steps) {
                spec = { ...spec, posterize };
                candidate = await encodeWith(spec);
                if (candidate.length <= maxBytes) break;
            }
        }
    }

    // Never regress: if the chosen encode loses to plain lossless, ship lossless from the same PNG. This
    // is also what keeps a true paint-by-number/region mask off the lossy path -- few distinct values
    // compress better losslessly than lossily -- so it is load-bearing, not just a size guard.
    if (spec.mode !== "lossless" && candidate.length >= (await baselineBytes())) {
        spec = { ...losslessFallback(baseSpec), greyscale: spec.greyscale };
        candidate = await encodeWith(spec);
        return { data: candidate, label: `${specLabel(spec)} (regressed)` };
    }

    return { data: candidate, label: `${specLabel(spec)}${gateRejected ? " (gate)" : ""}` };
}

// ---------------------------------------------------------------------------------------------
// Job loop.
// ---------------------------------------------------------------------------------------------

// Two pools rather than one, because a guarded job holds several full-resolution raw planes at once
// (two of them just to score a PSNR) and so has to run narrow. Sharing a single pool would let the
// guarded jobs occupy every slot and idle the plain lossless ones behind them; running the two
// alongside each other keeps the machine busy on the cheap jobs while the expensive ones trickle.
async function drain(list: EncodeJob[], concurrency: number): Promise<void> {
    let next = 0;
    await Promise.all(
        Array.from({ length: Math.min(concurrency, list.length) }, async () => {
            while (next < list.length) await encode(list[next++]!);
        })
    );
}

const workers = Math.max(2, availableParallelism());
await Promise.all([
    drain(
        jobs.filter((job) => job.encode?.kind === "weapon"),
        GUARDED_CONCURRENCY
    ),
    drain(
        jobs.filter((job) => job.encode?.kind !== "weapon"),
        workers
    )
]);

if (failed > 0) {
    console.error(`${failed} of ${jobs.length} encode jobs failed.`);
    process.exit(1);
}
