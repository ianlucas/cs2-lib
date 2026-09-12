/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

namespace ItemGenerator;

// Per-property WebP encode tiers for WEAPON and KNIFE textures, the counterpart to
// StickerTextureOptimization. Every texture in the pipeline is lossless by default (see
// item-generator-webp.ts); this file and that one are the only places that opt a texture into a
// smaller encoding. It is deliberately the sole tuning surface for the weapon set -- edit Targets,
// rebuild, done.
//
// THE SPLIT OF RESPONSIBILITY. This file owns POLICY: which material property gets which tier, with
// which thresholds and budgets. scripts/item-generator-webp.ts owns MEASUREMENT: every "guard" named
// below is a TEXTURE-DRIVEN classifier it evaluates against the pristine decompiled PNG. Nothing here
// keys on a filename, a skin, or a resolution the artist happened to choose -- a tier states what the
// property's channels MEAN, and the guards decide per texture whether this particular image can take
// the encoding that meaning allows.
//
// HOW THE TIERS WERE DERIVED. Out of band, against ../cs2-3d-viewer, using
// scripts/tool-reencode-weapons.ts -- which re-encodes the same textures in place under
// scripts/workdir/output so a candidate tier can be eyeballed without a full generator run -- plus the
// scripts/probe-*.ts measurement harnesses each tier comment cites. Every tier below carries the
// numbers that chose it and the skins it was verified on. Against the production build the set falls
// from 5963 MB to 1276 MB.
//
// SCOPE. Unlike the sticker properties, most of these parameter names are NOT weapon-exclusive:
// g_tColor, g_tNormal, g_tMetalness, g_tAmbientOcclusion and g_tSurface are bound by glove, character,
// sticker and simple-prop materials too, and on g_tSurface the channels mean something different there
// (a glove's is packed surface properties; a weapon's is an object-space normal). So a texture
// qualifies only when EVERY material that binds it, anywhere in the build, is a weapon-family material
// binding it to a target property -- see WeaponShaders and ResolveTextureTiers. Keychains ride on
// csgo_weapon.vfx like a weapon body does and are excluded by path (see ExcludedPathSegments); they
// are the obvious next candidate, but nothing about them has been looked at in the viewer yet.
//
// Measured against the property set the out-of-band tool walks (every weapon/knife item's material
// tree, 2800 textures), this rule agrees on all but 15 textures totalling 0.3 MB: it drops 7 that only
// a csgo_simple.vfx / csgo_unlitgeneric.vfx material binds (shotgun shell casings, taser numerals) plus
// two shared 1x1 defaults, and adds 8 (C4 digits, an equipment holster, sticker backing defaults).

// The three encode modes, as the wire format spells them. A plain const rather than an enum because
// this record IS the descriptor the encoder receives -- there is no DTO to map through, which on a
// shape with five nested types and a recursive GuardFallback is a mapping that could only introduce
// bugs. (StickerTextureTier, whose shape is six flat fields, keeps its enum and its ToSpec.)
public static class WeaponEncodeMode
{
    public const string Lossless = "lossless";
    public const string Lossy = "lossy";
    public const string NearLossless = "nearLossless";
}

// Below `MaxLag1` mean lag-1 autocorrelation the RGB is a grain field, not a picture, and takes
// `Fallback` instead of the tier's own encoding.
public sealed record WeaponNoiseGuard(double MaxLag1, WeaponTextureTier Fallback);

// Below `MinPsnr` dB (lossy reconstruction vs the pristine PNG, measured at NATIVE resolution) the
// texture's values feed a lookup rather than an eye, and it takes GuardFallback.
public sealed record WeaponLossyGuard(double MinPsnr);

// Compress the ALPHA plane at `AlphaQuality`, but only when at least `MinSoft` of it is soft (neither
// 0 nor 255). A hard binary cut mask is left lossless.
public sealed record WeaponAlphaGuard(double MinSoft, int AlphaQuality);

// Step quality down by 6 until the encode fits `MaxBytes`, stopping at `MinQuality`. `MinAlphaQuality`
// opts the alpha plane into the same walk, for a property where the mask IS the bytes.
public sealed record WeaponSizeBudget(int MaxBytes, int MinQuality, int? MinAlphaQuality = null);

// The mask-tier counterpart: a REPLICATED mask (R==G==B) walks `Qualities` lossy, an independent-plane
// one walks `Steps` as posterize bucket widths under a lossless encode. Only fires when over `MaxBytes`.
public sealed record WeaponMaskBudget(int MaxBytes, int[] Qualities, int[] Steps);

// One encode tier, and the exact descriptor item-generator-webp.ts receives (camelCase, nulls omitted).
// Field semantics are documented once, on the EncodeSpec interface there, so the mechanism and its
// documentation cannot drift apart.
public sealed record WeaponTextureTier
{
    public string Kind { get; init; } = "weapon";
    public required string Mode { get; init; }
    public int? Quality { get; init; }
    public bool? StripAlpha { get; init; }
    public int? MinWidth { get; init; }
    public int? MaxWidth { get; init; }
    public bool? SmartSubsample { get; init; }
    public int? AlphaQuality { get; init; }
    public int? Effort { get; init; }
    public bool? Decimate { get; init; }
    public double? GrainBoost { get; init; }
    public bool? MaskKernel { get; init; }
    public int? Posterize { get; init; }
    public bool? FlattenAlpha { get; init; }
    public bool? Greyscale { get; init; }
    public bool? GreyGuard { get; init; }
    public WeaponNoiseGuard? NoiseGuard { get; init; }
    public bool? SfxGuard { get; init; }
    public WeaponLossyGuard? LossyGuard { get; init; }
    public WeaponTextureTier? GuardFallback { get; init; }
    public WeaponAlphaGuard? AlphaGuard { get; init; }
    public bool? MaskGuard { get; init; }
    public bool? FlattenGuard { get; init; }
    public WeaponSizeBudget? SizeBudget { get; init; }
    public WeaponMaskBudget? MaskBudget { get; init; }
}

public static class WeaponTextureOptimization
{
    // ---------------------------------------------------------------------------------------------
    // SCOPE
    // ---------------------------------------------------------------------------------------------

    // The shader families whose channel semantics the tiers below were written against. A `.vcompmat`
    // has no shader of its own and is always a weapon paint composite (verified: every texture any
    // composite in the build binds lives under a weapon paint-kit or workshop paint-kit tree), so
    // composites are in scope unconditionally.
    public static readonly IReadOnlySet<string> WeaponShaders = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        "csgo_customweapon.vfx",
        "csgo_composite_inputs.vfx",
        "csgo_weapon.vfx"
    };

    // Keychains are csgo_weapon.vfx models hanging off a weapon, so the shader rule alone would sweep
    // them in (299 textures, 127 MB). Their channels really are the weapon ones and the tiers would
    // very likely hold, but no keychain has been looked at in the viewer, and this file's rule is that
    // nothing ships on an assumption. Drop the segment below to take them.
    public static readonly IReadOnlyList<string> ExcludedPathSegments = ["/keychains/"];

    // ---------------------------------------------------------------------------------------------
    // TIERS. Each one records what the property's channels mean, the measurements that chose its
    // settings, and the skins it was verified on. >>> TUNE HERE <<<
    // ---------------------------------------------------------------------------------------------

    // The resolution cap every tier shares. A weapon covers little screen even zoomed, and 4K maps are
    // the bulk of the footprint. Several tiers note that resolution is NOT a lever for them, meaning
    // their population is already at or below this and the cap is a deliberate no-op.
    private const int Cap = 2048;

    private const int KB = 1024;
    private const int MB = 1024 * 1024;

    // Downscale-only, for the base-body maps: re-encode from the pristine PNG at LOSSLESS quality but
    // cap the long side. Only 4K+ sources are touched (MinWidth), so 2K/1K maps are left exactly as
    // they are -- the win is purely resolution, no quality change. A weapon's own maps sit under its
    // pattern, so halving them keeps the surface coherent with the (already-2K) pattern.
    private static readonly WeaponTextureTier DownscaleOnly = new()
    {
        Mode = WeaponEncodeMode.Lossless,
        Quality = 100,
        MaxWidth = Cap,
        MinWidth = Cap + 1
    };

    // Same downscale-only deal, for properties whose pixels are a MASK rather than a picture: coverage
    // and selection planes (g_tPearlescenceMask, g_tOverlayMask, g_tMasks) and a scalar material plane
    // (g_tPaintMetalness). The one difference is MaskKernel: every plane area-averages instead of RGB
    // going through Lanczos, because a mask's hard edges are exactly where Lanczos' negative lobes
    // overshoot, inventing coverage values outside the range the neighbouring texels had. A box filter
    // cannot leave that range. These were the last 4K holdouts in the whole weapon set: 64 textures,
    // 19.5 MB, never targeted before.
    private static readonly WeaponTextureTier MaskDownscaleOnly = new()
    {
        Mode = WeaponEncodeMode.Lossless,
        Quality = 100,
        MaxWidth = Cap,
        MinWidth = Cap + 1,
        MaskKernel = true
    };

    // Normal maps (BC5 hemi-oct RG, or BC7 RG + isoRough in B). Lossy q80 holds up: eyeballed on
    // high-frequency ridge/relief normals (XM1014 | Run Run Run's machined body, SCAR-20 | Trail
    // Blazer's topo contours, M249 | Aztec's carved glyphs) with no visible regression, cutting each
    // ~7 MB near-lossless map to well under 1 MB. Every weapon normal's alpha is flat and unused, but
    // it is KEPT (never stripped) so the shader's .a sample stays 0.0 rather than 1.0 -- the opposite
    // of the wear/roughness case below, where alpha is a constant 255 and dropping it is free.
    private static readonly WeaponTextureTier NormalTier = new()
    {
        Mode = WeaponEncodeMode.Lossy,
        Quality = 80,
        MaxWidth = Cap
    };

    // GRAIN patterns: the spray/stipple camo class, carved out of what the fidelity gate calls
    // "complex". Their RGB is not artwork -- it is a high-frequency dither whose exact realization the
    // shader cannot show, and whose channels are mutually independent selector fields. The
    // polygon/shape structure of such a skin rides entirely on ALPHA, so the encode inverts the usual
    // priorities: decimate + GrainBoost keep the grain's amplitude through the downscale (averaging
    // destroys it, which is what made every earlier 2K attempt look blotchy), quality 50 because the
    // noise realization is invisible, 4:4:4 because 4:2:0 averages chroma across channels that must
    // stay independent, and alpha at 60 which measured free (identical structure error and grain
    // retention vs lossless). GrainBoost 1.5 restores native amplitude (69/51/99% retention across
    // three zoom levels vs 67/47/93% for the encode that was eyeballed); because the boost is measured
    // against each texel's own block mean it only touches the high-frequency residual, so it cannot
    // shift overall contrast or clip a wide-range texture. 1.75+ overshoots (107%) and starts clipping.
    // Verified on AK-47 | Olive Polycam (style2 spraypaint + halftone), 40.0 MB -> 1.4 MB.
    private static readonly WeaponTextureTier PatternNoiseTier = new()
    {
        Mode = WeaponEncodeMode.Lossy,
        Quality = 50,
        MaxWidth = Cap,
        SmartSubsample = true,
        AlphaQuality = 60,
        Decimate = true,
        GrainBoost = 1.5
    };

    // NOISE-FLOOR patterns: where a g_tPattern fidelity-gate FAILURE goes, instead of lossless.
    //
    // The gate's premise is that a texture whose lossy reconstruction sits far from the source must be
    // a region/palette mask whose values matter. Measuring the whole rejected population says otherwise
    // (scripts/probe-pattern-floor.ts, 189 surviving-lossless patterns): for EVERY genuine gate
    // failure, going from q60 to q95 -- a ~6x bitrate change -- buys under 3 dB. The residual is not
    // structure the encoder is failing to represent; it is an incompressible fine-grain field the
    // encoder discards at any quality, and the file was paying lossless prices to store grain. What the
    // gate actually measures is "how noisy is this texture", not "do these values feed a lookup".
    //
    // The four textures in that survey where quality DOES buy back real fidelity (AK-47 | Redline
    // +7.3 dB, AWP | Redline +8.5, MAG-7 | Heaven Guard +7.1, SSG 08 | Slashed +3.4) all score
    // 34.7-44.4 dB at q95 -- they clear the gate comfortably and are only lossless because lossless won
    // on SIZE, so they never reach this branch. The real protection for a true palette/region mask is
    // the never-regress rule, and it is not incidental: a mask with few distinct values compresses far
    // better losslessly than lossily, so the clean paint-by-number set is kept lossless by size alone
    // (AWP | Pink DDPAT 5K lossless vs 52K here, CZ75-Auto | Green Plaid 2K vs 99K).
    //
    // Eyeballed on M4A1-S | Wash me plz (4096 source, 24971K lossless, 7684K after the old
    // lossless-downscale, 986K here). 4:4:4 is what this class needs: the artwork is thin saturated
    // strokes over saturated ground, and at equal bytes q75-4:4:4 beat q80-4:2:0 on both PSNR and
    // eyeball. Below ~q72 the smooth areas collapse into blocky patches. Alpha stays lossless.
    private static readonly WeaponTextureTier PatternFloorTier = new()
    {
        Mode = WeaponEncodeMode.Lossy,
        Quality = 75,
        MaxWidth = Cap,
        SmartSubsample = true
    };

    // Where a g_tOverlay fidelity-gate FAILURE goes. Exactly one texture in the set reaches it
    // (P250 | Sedimentary, simple_topo_pattern_2), and the sweep on it says plainly that the gate is
    // measuring NOISE rather than structure the encoder failed to represent:
    //     q60  372K  28.0 dB      q90  532K  30.2 dB
    //     q75  398K  28.7 dB      q95  614K  30.6 dB
    //     q80  430K  29.2 dB      q100 695K  30.7 dB   (lossless: 1269K)
    // A 1.9x bitrate change buys 2.7 dB and the last 0.1 dB of it costs 80K. Same finding as
    // PatternFloorTier, on a population of one, so the remedy is deliberately the GENTLE one rather
    // than that tier's q75: +10 quality and 4:4:4, i.e. spend more bits exactly where the gate said the
    // encode fell short. It lands at 30.2 dB -- above the gate's own bar and in the same band as the
    // densest artwork the tier already accepts (CZ75-Auto | Honey Paisley, 31.7) -- for 58% fewer bytes
    // than lossless. Eyeballed on P250 | Sedimentary itself (1270K -> 532K): no visible regression,
    // which is what a residual that is pure grain predicts.
    private static readonly WeaponTextureTier OverlayFloorTier = new()
    {
        Mode = WeaponEncodeMode.Lossy,
        Quality = 90,
        AlphaQuality = 60,
        SmartSubsample = true,
        MaxWidth = Cap
    };

    // INDEPENDENT-CHANNEL grunge: where a g_tGrunge fidelity-gate FAILURE goes. Exactly one texture
    // reaches here (Glock-18 | Ghost Protocol), and lossless was costing 9356K for it -- the largest
    // single weapon texture in the build, for one skin. Its R/G/B are three separate planes:
    //     lossless                       9356K   exact
    //     lossy q90 (what the gate saw)  4180K   R 28.9/+-64   G 39.1/+-18   B 29.1/+-105
    //     posterize 24/24/12/8           3773K   R 31.7/+-12   G 31.3/+-12   B 38.7/+-6
    //     lossy q28 a15                  1467K   R 24.1/+-84   G 28.1/+-54   B 25.7/+-123
    // Posterize + lossless wins at the TOP of the curve (10% smaller than the lossy encode the gate
    // rejected, 8-10 dB better on the two chroma-carried planes) but CANNOT reach 1.5 MB: it needs step
    // 128 on R/G to get there, i.e. three grey levels on the grime field (17 dB, visible blotching).
    // Scalar quantization is simply a worse coder than a DCT once the budget is tight, and the curves
    // cross around 2 MB. So this tier is lossy and re-accepts the chroma damage the gate was right
    // about -- a deliberate trade for one skin, eyeballed twice, at 3773K and again at 1467K, with no
    // visible regression. Alpha gets a disproportionate share of the budget (a15, +-12) because it
    // spans only 190-255, so error there reads as a broad opacity shift across the whole gun whereas
    // colour error hides in the noise; q40 a5 costs the same bytes and makes alpha nearly twice as
    // wrong.
    private static readonly WeaponTextureTier GrungeFloorTier = new()
    {
        Mode = WeaponEncodeMode.Lossy,
        Quality = 28,
        AlphaQuality = 15,
        SmartSubsample = true,
        MaxWidth = Cap
    };

    // Reached only by a g_tMetalness file the guards sent to the lossless floor. See MetalnessTier.
    private static readonly WeaponTextureTier MetalnessFloorTier = new()
    {
        Mode = WeaponEncodeMode.Lossless,
        Quality = 100,
        MaxWidth = Cap,
        MaskKernel = true
    };

    // PAINT-BY-NUMBER masks: R/G/B/A are four INDEPENDENT region-weight planes, each selecting one
    // palette slot. Alpha here is DATA, not transparency. 230 textures, 189 MB, 209 of them 4096-wide;
    // the single biggest texture anywhere in the set was one of these at 11177K.
    //
    // LOSSY IS THE WRONG TOOL and the numbers say so plainly. Lossy WebP is ALWAYS 4:2:0 YUV -- the
    // format has no 4:4:4 mode, so SmartSubsample only buys a better chroma downsample, not the absence
    // of one. Three independent data planes pushed through a colour transform come apart. Measured on
    // MAC-10 | Arabesque Mosaic at 2048 (scripts/probe-pbn.ts), against the ideal area-downscale:
    //     lossy q95      1015K   R 28.0  G 32.6  B 23.5 dB   max err 255/141/234
    //     posterize/16   1170K   R 42.3  G 37.2  B 36.4 dB   max err   8/8/8
    // At the same size posterize is 13-14 dB better on every channel. Note the signature in the lossy
    // row: G (luma-dominant) survives while B (chroma-carried) collapses -- that is the subsampling,
    // not the bitrate. And a max error of 234 on a palette selector is a WRONG colour texel, not a
    // slightly wrong one, which is exactly the failure an averaged PSNR hides.
    //
    // So the lever is quantization + lossless: bucket each plane, keep VP8L. The error is hard-bounded
    // at step/2 with no outliers, no YUV, no chroma subsampling. It is applied ONLY as a budget
    // backstop -- a mask that already fits after the downscale stays bit-exact -- so the loss is
    // confined to the tail that is actually expensive. Arabesque Mosaic lands on step 16 (11177K ->
    // 3384K by resize alone -> 1170K), the eyeball-validated point; 8 and 12 are the gentler rungs.
    //
    // MaskKernel is not optional here: Lanczos on the near-binary alpha (6 distinct values) scored
    // 52.8 dB vs area's 60.8 AND produced a 300K bigger file.
    //
    // MaskGuard measures two things, because the property holds two populations needing OPPOSITE
    // encoders:
    //   1. CROSS-CHANNEL REPLICATION. If R == G == B the mask is ONE weight field copied across three
    //      channels, not three independent selector planes -- and a greyscale field has CONSTANT
    //      chroma, so there is nothing for the subsampler to destroy. At lossy q95:
    //        MAC-10 | Arabesque Mosaic  independent  R 28.0  G 32.6  B 23.5 dB  (B collapses)
    //        P90 | Straight Dimes       replicated   R 46.2  G 46.2  B 46.2 dB  (no penalty)
    //      So a replicated mask spends its budget on QUALITY and a chromatic one on POSTERIZE. Straight
    //      Dimes at lossy q75 beat the posterize/20 it replaced on both axes: 1280K vs 1462K and
    //      34.7 dB vs 33.4 dB.
    //   2. ALPHA SPAN. Straight Dimes' alpha runs 254..255 -- a span of ONE. As a palette weight that
    //      is 0.996 vs 1.0, a difference no blend can show, yet it cost 266K (21% of the file) because
    //      the SHAPE of its 254 region is detailed and lossless VP8L pays full price for shape.
    //      Flattening drops the ALPH chunk and decoders return a = 1.0, which is what the plane already
    //      meant. AlphaQuality is useless here and was measured to be: libwebp cannot quantize a
    //      2-level plane below 2 levels, so ALPH stayed at exactly 266K from alphaQuality 100 down to 0.
    private static readonly WeaponTextureTier PaintByNumberTier = new()
    {
        Mode = WeaponEncodeMode.Lossless,
        Quality = 100,
        MaxWidth = Cap,
        MaskKernel = true,
        MaskGuard = true,
        MaskBudget = new((int)Math.Round(1.3 * MB), [75, 70, 65], [8, 12, 16, 20])
    };

    // OVERLAY colour composited over the paint (BC7 RGBA sRGB): RGB is a picture and A is the overlay's
    // own opacity. Same shape as g_tColor and mostly the same tier. What made this property the worst
    // regression against production was not quality, it was REACH: it used to be DownscaleOnly, whose
    // MinWidth meant only the 22 4K sources were touched at all, and then only by resizing -- the 47
    // textures already at 2048 or below were left LOSSLESS, which is where MAG-7 | Wildwood's 6231K and
    // Nova | Marsh Grass's 5952K came from. Dropping MinWidth is most of the win.
    //
    // TWO THINGS THIS PROPERTY NEEDS THAT g_tColor DOES NOT (scripts/probe-overlay.ts,
    // scripts/probe-overlay-ladder.ts):
    //   1. THE MASK IS OFTEN THE WHOLE FILE. Splitting the RIFF chunks shows ALPH dominating far more
    //      here than on an albedo: AWP | The End is 1606K of ALPH in a 1658K file (97%), PP-Bizon |
    //      Cold Cell 1108K of 1117K (99%), Five-SeveN | Fraise Crane 1247K of 1930K (65%). That is what
    //      makes a sizeBudget's usual RGB-only walk useless here -- on The End the entire RGB plane is
    //      52K, so grinding quality from 80 to 56 moves the file by ~1%. MinAlphaQuality puts alpha on
    //      the same ladder. The rungs land at a49/a38/a26/a15, measured on four alpha-dominated files
    //      as 33-36 dB (max err 8-15) at a60, falling to 23-27 dB (max err 28-39) at a15 -- so only the
    //      files that need the bottom rung pay for it.
    //   2. HALF THE POPULATION HAS A FAKE ALPHA PLANE. 24 of the 69 have an alpha spanning exactly ONE
    //      count (254..255), stored at lossless grade because the SHAPE of the 254 region is detailed.
    //      FlattenGuard drops the plane instead: CZ75-Auto | Honey Paisley 1311K -> 1003K, Nova | Marsh
    //      Grass 1366K -> 1101K, MP7 | Coral Paisley likewise, all with RGB bit-identical.
    //
    // The fidelity gate is not close to binding here and that is worth recording: the flat few-value
    // stencil overlays, exactly what a 30 dB gate exists to catch, score 44-67 dB at q80 (Cold Cell
    // 51.6, XM1014 | XoooM 61.1, FAMAS | Grey Ghost 67.5, USP-S | Sleeping Potion 65.6) -- their RGB is
    // a handful of flat colours over which a DCT has nothing to lose, and all their bytes were in the
    // mask. The densest artwork sits at 31.7-34.8 dB, so the gate is held rather than removed.
    // SmartSubsample was measured and rejected: 0.0-0.6 dB for 3-5% more bytes across eleven files.
    //
    // VERIFIED IN THE VIEWER, no visible regression, across the four risk surfaces this tier opens,
    // each represented by the skin that pays most for it:
    //   deepest budget rung   Five-SeveN | Fraise Crane (q56 a15, 7076K -> 1067K) and AWP | The End
    //                         (q62 a26, 5438K -> 1155K) -- the only two files that reach the ladder, and
    //                         the ~28-count mask error at a15 is the largest this tier can produce.
    //   alpha plane dropped   AK-47 | Aphrodite (1796K -> 35K), CZ75-Auto | Honey Paisley, MP7 | Coral
    //                         Paisley, Nova | Marsh Grass, FAMAS | Palm, Glock-18 | Coral Bloom,
    //                         M4A1-S | Glitched Paint. Confirms the shader BLENDS with the overlay's
    //                         alpha rather than branching on it.
    //   lossless -> lossy     the files the old MinWidth skipped: MAG-7 | Wildwood (6231K -> 844K),
    //                         PP-Bizon | Cold Cell, Galil AR | Sky Mandala, USP-S | Tropical Breeze,
    //                         MP9 | Dizzy, Glock-18 | Ghost Protocol, USP-S | Royal Guard (lag1 0.51,
    //                         the grainiest), FAMAS | Grey Ghost.
    //   furthest under prd    MP5-SD | Savannah Halftone (0.08x what production ships), M4A1-S | Wash me
    //                         plz (0.09x), AK-47 | VariCamo Grey (0.11x), Dual Berettas | Silver Pour
    //                         (0.13x), XM1014 | XoooM (0.14x).
    // Result: 113.3 MB -> 18.2 MB with the largest file at 1155K, against production's 94.3 MB/12233K.
    private static readonly WeaponTextureTier OverlayTier = new()
    {
        Mode = WeaponEncodeMode.Lossy,
        Quality = 80,
        MaxWidth = Cap,
        AlphaQuality = 60,
        LossyGuard = new(30),
        GuardFallback = OverlayFloorTier,
        FlattenGuard = true,
        SizeBudget = new((int)Math.Round(1.2 * MB), MinQuality: 56, MinAlphaQuality: 15)
    };

    // Object-space surface normal (BC7 RGB), the triplanar composite input that decides how a paint
    // pattern projects onto the body. 91 files, every one native 1024x1024, all shipping lossless. What
    // the encoder has to respect is the SHAPE of the data (scripts/probe-surface.ts,
    // scripts/probe-surface-ladder.ts):
    //
    //   IT IS A SPARSE SCATTER, NOT A PICTURE. Even the densest 320x320 window of the SG 553's map is
    //   9% covered: isolated few-texel fragments of normal data on a pure-black background, with the
    //   ALPHA plane holding a 4-value LABEL (0 on 92% of texels, then 1/3/4) rather than a coverage
    //   ramp. Every fragment is an impulse, the worst thing a DCT can be handed -- it smears each one
    //   across its block and rings into the background, inventing normals where the map says there is
    //   no surface at all. Angular error over the unit-normal texels, at roughly equal bytes:
    //       posterize/24 + lossless  328K   mean 4.3 deg  p99 7.5 deg  MAX 9.7 deg
    //       lossy q90 4:4:4          302K   mean 3.6 deg  p99 20.9 deg MAX 172.3 deg
    //   The mean is a wash; the tail is not, and the tail is where a projection artifact comes from. So
    //   this property goes the PaintByNumberTier way, not the MetalnessTier way -- and the two agree on
    //   the underlying rule, which is that a DCT wins on smooth gradients and loses on hard structure.
    //   Banding, the usual cost of posterize, has nowhere to appear: a 2-3 texel fragment has no
    //   gradient to band, and the quantizer holds 0 exact so the background stays exactly black.
    //
    //   THE ALPHA LABEL MUST SURVIVE INTACT, which rules out two things other tiers do. It is never
    //   flattened (MaskGuard is deliberately absent: alpha 0 means "no surface here", so flattening it
    //   to 255 would relabel the whole background), and it is never posterized (the quantizer skips any
    //   plane under 32 distinct values, and this one holds 4). Both verified on the shipped output.
    //
    //   RESOLUTION IS NOT A LEVER AT ALL, more so than anywhere else in this file: area-downscaling to
    //   512 averages fragments together with the black background and scores 84.6 deg MEAN angular
    //   error while corrupting the label plane too. The cap is a no-op here and must stay one.
    //
    // The budget is production's own ceiling for this property (354K), so the ladder only fires on files
    // above it and the 14 that already fit stay BIT-EXACT. Checked in the viewer on the pattern-
    // placement axis this tier could disturb, no visible regression: SG 553 | Bulldozer and
    // M4A4 | Hellish (the only two files the ladder took to +-12), Gut Knife | Doppler and AWP | Fade
    // (largest files, and projected gradients, where a shifted projection would show first), and
    // Negev | Mjolnir / R8 Revolver | Fade at +-8.
    private static readonly WeaponTextureTier SurfaceTier = new()
    {
        Mode = WeaponEncodeMode.Lossless,
        Quality = 100,
        MaxWidth = Cap,
        MaskKernel = true,
        // No MaskGuard on purpose (see above), which also means MaskBudget takes its posterize ladder
        // rather than the replicated-lossy one -- the right default for three independent data planes.
        MaskBudget = new(350 * KB, [80, 70, 60], [4, 8, 12, 16, 24, 32])
    };

    // Packed roughness/metalness (BC5 R = roughness INVERTED, G = metalness; the BC7 variant adds
    // B = SFX mask). Two independent scalar material planes in one file, which decides everything below.
    // Measured across all 98 (scripts/probe-metalness.ts, scripts/probe-metalness-ladder.ts):
    //
    //   TWO PLANES CARRY EVERYTHING. B is CONSTANT in 98 of 98 files and alpha is degenerate-and-opaque
    //   in 98 of 98 -- no weapon in the set carries SFX data. R and G are genuinely independent:
    //   corr(R,G) < 0.9 on 89 of 98 and frequently NEGATIVE (-0.86 on the Karambit's, -0.84 on the
    //   Survival Knife's), because a rough region is usually the non-metal one. Independent planes are
    //   exactly what 4:2:0 destroys, so this tier is 4:4:4, always.
    //
    //   THE CODER CHOICE WENT THE OPPOSITE WAY FROM PaintByNumberTier, and it was measured, not
    //   assumed. A region mask is a few flat values with hard edges, where a DCT rings and posterize is
    //   free. A roughness/metalness map is the reverse: 70-86% of its pixels sit in a neighbourhood
    //   spanning less than the quantizer step, i.e. it is mostly SMOOTH GRADIENT, which is what scalar
    //   quantization is worst at. Rendered side by side at an equal 831K on smg_mp5sd (the heaviest):
    //       posterize/24 + lossless   flat field visibly dithered, and every soft falloff around the
    //                                 muzzle/sight geometry collapses into hard contour rings
    //       lossy q90 4:4:4           falloffs stay smooth, edges hold, only finest scratch detail softens
    //   Banding was already visible at step 8 (+-4), so there is no fine-posterize window to retreat
    //   into either. The DCT wins here for the same reason it loses on a mask, and it wins on bytes too.
    //
    //   WHAT LOSSY COSTS, stated plainly: per-plane max error runs 88-240 counts at hard material
    //   boundaries (ringing), against posterize's bounded +-step/2, and the constant B plane DRIFTS --
    //   up to 96 counts across the shipped set -- because YUV quantization spreads error into it. That
    //   drift is why SfxGuard exists: B is constant in every file today, so a drifting B can only ever
    //   invent an SFX mask that was not there, and any file that ever ships a REAL one is routed to the
    //   bounded (posterize) path instead.
    //
    // Checked in the viewer along the risk axes this tier creates, no visible regression on any:
    // FAMAS | Afterimage (the one gate rejection, on the bounded posterize floor), Five-SeveN | Angry
    // Mob (lowest-PSNR lossy encode), Desert Eagle | Blaze (biggest 4K -> 2K, so downscale + new kernel
    // + lossy at once), M4A1-S | Atomic Alloy (largest shipped file, and mostly polished metal) and
    // Stiletto Knife (worst B drift).
    //
    // MaskKernel because 35 of the 98 are native 4K and must come down to the cap: area-averaging two
    // independent data planes cannot overshoot the way Lanczos does at their material edges. RESOLUTION
    // IS NOT A LEVER BEYOND THAT: 1024 lossless is 940-955K, in budget, but it is an unbounded resample
    // (max error 145-232) of the fine machined detail, the trade this property is least able to take.
    private static readonly WeaponTextureTier MetalnessTier = new()
    {
        Mode = WeaponEncodeMode.Lossy,
        Quality = 90,
        MaxWidth = Cap,
        SmartSubsample = true, // independent planes: never let the chroma subsampler near them
        MaskKernel = true,
        MaskGuard = true,
        SfxGuard = true,
        LossyGuard = new(30),
        GuardFallback = MetalnessFloorTier,
        SizeBudget = new(MB, MinQuality: 70),
        // Reached only by a file the guards sent to the lossless floor that is STILL over budget, which
        // is where the bounded quantizer is the right answer: no DCT is involved on that path at all.
        MaskBudget = new(MB, [80, 70, 60], [4, 8, 12, 16, 24, 32])
    };

    // Paint-wear pattern (BC4 R): the scalar field the shader thresholds against the item's wear float
    // to decide where paint has rubbed through to base metal. 15 files, but only FIVE distinct images
    // behind them, every one 2048x2048. Three measurements decide the tier (scripts/probe-wear.ts):
    //
    //   ONE PLANE, NOT FOUR. Every wear map measures max|R-G| = max|R-B| = 0 with alpha a constant 255
    //   -- the shader reads .r and nothing else, so three quarters of what the lossless encode was
    //   paying for is a copy of the R plane or a no-op. Collapsing to a single greyscale plane costs
    //   NOTHING: grey lossless reproduces R bit-exactly. Dropping the constant-255 alpha leaves the
    //   shader's .a sample at 1.0, which is what an alpha of 255 decoded to anyway -- the opposite of
    //   the normal-map case, where alpha is flat at 0 and must be kept. GreyGuard re-checks both facts
    //   per file, so a wear map ever authored with real chroma or a real mask keeps all four planes.
    //
    //   RESOLUTION IS NOT A LEVER. This is a dense scratch/grain field, not artwork. Halving to 1024
    //   and back scores 9.7-17.1 dB with max error 223, so the cap stays the no-op it already is.
    //
    //   QUALITY IS. The five images sit on the same curve: q90 holds 41.5-42.1 dB at max error 14-15,
    //   taking 2.4-2.9 MB down to 0.9-1.6 MB. Eyeballed at 3x zoom on paint_wear_3 (busiest, std 59.6)
    //   and paint_wear_brushed_patina (biggest): q90 is indistinguishable from native, q85 softens the
    //   fine grain, q80 visibly washes it out of the flat dark areas. Because the field is THRESHOLDED
    //   rather than displayed, smoothing it moves wear boundaries -- hence q90 and a high budget floor.
    //   Checked in the viewer at high float, one skin per distinct image, the two the budget pushed to
    //   q84 first: FAMAS | Vendetta and XM1014 | Solitude, then AK-47 | Redline (the 1948-skin
    //   default), AWP | The End and Dual Berettas | Rose Nacre. No visible regression on any of them.
    //
    // Blast radius is the whole set: paint_wear_psd alone feeds 1948 skins. Two of the five images clear
    // 1.5 MB at q90 (paint_wear_3 1571K, brushed_patina 1602K) and one step down the ladder puts both
    // at ~1.3 MB, so MinQuality is never reached in practice; it is there so a future wear map cannot be
    // pushed into the range where the grain visibly washes out.
    private static readonly WeaponTextureTier WearTier = new()
    {
        Mode = WeaponEncodeMode.Lossy,
        Quality = 90,
        GreyGuard = true,
        MaxWidth = Cap,
        LossyGuard = new(30),
        SizeBudget = new((int)Math.Round(1.5 * MB), MinQuality: 78)
    };

    // Per-paint roughness (BC4 R): the scalar gloss field the shader hands to the specular lobe. 203
    // files, and the last property still on DownscaleOnly -- 254 MB against production's 380 MB, but
    // with a MAX of 2497K, because that tier had the same REACH failure g_tOverlay had. Its MinWidth
    // touched the 149 4K sources by resize alone and left the 39 native-2048 maps fully lossless, which
    // is why the three heaviest files in the property (damascus_sg553 2490K, etched_mac10 2470K,
    // aged_rough 2402K) were all BIGGER than the ones production ships. Blast radius is unusually low
    // for a weapon property: the two textures with real reach are 1x1 defaults (310 and 96 skins, 0K),
    // and the heaviest real map is referenced by ONE skin.
    //
    //   ONE PLANE, NOT FOUR, IN 203 OF 203. Every file measures max|R-G| = max|R-B| = 0 with a constant
    //   255 alpha, so GreyGuard collapses all of them -- the g_tWear fact, holding across a population
    //   13x larger. What is worth recording is that here the collapse is nearly worthless on BYTES:
    //   254.4 MB -> 243.6 MB (4%), because VP8L's predictors already encode two duplicate planes and a
    //   constant alpha for almost nothing. Its value is entirely on the LOSSY path, where it removes the
    //   chroma planes outright and with them any question of what 4:2:0 does to a data field. That is
    //   why SmartSubsample -- which MetalnessTier and GrungeFloorTier both need -- is deliberately
    //   absent: after the collapse there is no chroma left to subsample.
    //
    //   QUALITY IS THE LEVER AND q90 IS EXACTLY ENOUGH. Encoding the single plane across the whole
    //   population at the cap (scripts/probe-roughness-sweep.ts):
    //       lossless grey  243.6 MB   max 2471K   107 files over 1.25 MB
    //       grey q95       121.6 MB   max 1634K     9 files over
    //       grey q90        83.9 MB   max 1275K     0 files over
    //       grey q85        61.6 MB   max 1018K     0 files over
    //   q90 clears a 1.25 MB ceiling on its own, with the heaviest file 5K under it -- so the budget
    //   below is a backstop that fires on nothing in the shipped set. What q90 costs, scored against the
    //   plane that ships today: 41.8-42.5 dB, mean error 1.4-1.6 counts, max 12-15. That is the same
    //   operating point WearTier eyeballed on the same data class, and the reason to stop there rather
    //   than take the further 22 MB at q85 is the same one: the BANDING proxy -- texels sitting in a
    //   flat 3x3 in the source that acquire an 8-count step in the decode, i.e. the contour rings a DCT
    //   invents on a gradient -- goes 0.2-0.3% at q95, 2-3.5% at q90, 6-8% at q85, 9-10% at q80. A
    //   roughness contour is a visible ring that sweeps as the highlight moves, the one artifact this
    //   property can show that a pattern cannot.
    //
    //   THE FIDELITY GATE IS INERT HERE, which is worth stating rather than leaving to be rediscovered.
    //   A roughness value is a continuous scalar, not a palette index, so even the flattest stencil-like
    //   maps score 42.5-45.5 dB at q90 (forced_rough 34 distinct values, watermarked_s 42,
    //   bizon_traitor 76, basilisk 91) -- nothing in the population comes within 12 dB of the bar. It is
    //   kept as cheap insurance against a future map that really is a region mask, and the never-regress
    //   rule backstops the small files, where a lossy encode can lose to lossless outright.
    //
    //   RESOLUTION IS NOT A LEVER, measured on the magnification axis (encode at the candidate size,
    //   upscale the DECODED result back to 2048, score against the 2048 plane that ships) rather than on
    //   a round trip, on the two heaviest maps -- cu_graphic_overlay_ak47 / damascus_sg553:
    //       2048 q90       1115K / 1275K   42.1 / 41.8 dB   max err  13 /  14
    //       1024 lossless   624K /  687K   27.3 / 24.7 dB   max err 127 / 109
    //       1024 q90        288K /  330K   27.2 / 24.6 dB   max err 126 / 108
    //   At 1024 the RESIZE is the entire error -- lossless and q90 land within 0.1 dB of each other, so
    //   there is nothing quality can buy back -- and a max error of 108-127 counts is half the roughness
    //   range at a material boundary, i.e. gloss where the map says matte. The cap stays.
    //
    // VERIFIED IN THE VIEWER, no visible regression anywhere. Because the two textures with real reach
    // are 1x1 defaults, the checks bound each failure mode rather than sample the population:
    //   hard boundaries  where a DCT rings, and the biggest cuts in the property: AK-47 | Crossfade
    //                    (9739K -> 1114K, a graphic-decal roughness map taking the 4K -> 2K downscale
    //                    and the DCT at once), MAC-10 | Graven (etched engraving, 2470K -> 1099K) and
    //                    SG 553 | Damascus Steel (2490K -> 1275K, the file that defines the property max).
    //   gloss finishes   the knife finishes, where the roughness map IS the look and no paint pattern
    //                    hides it: Blue Steel (21 skins, 337K -> 59K, an 82% cut on a 42-value map),
    //                    Stained (21 skins, 34 values -- the flattest map in the property), Rust Coat
    //                    (22 skins) and Damascus Steel (18 skins), each on a Karambit and a Bayonet.
    //   banding          the gradient-heavy maps the q85 rung was rejected over, 53-77% of their texels
    //                    in a flat 3x3: R8 Revolver | Dark Chamber (77%, the smoothest in the set) and
    //                    Mauve Aside, AK-47 | Gold Arabesque (69%), Galil AR | Metallic Squeezer and
    //                    MP5-SD | Neon Squeezer (61%), CZ75-Auto | Slalom (57%), Desert Eagle | Starcade
    //                    (53%, gloss and gradient at once), AWP | CMYK (53%).
    //   worst encode     SSG 08 | Memorial, 39.1 dB at native q90 -- the single lowest of all 203, and
    //                    the only file below 40 (the next is 41.4).
    //   gate rejections  there are none, so the maps the gate exists for were checked directly:
    //                    M4A1-S | Basilisk (91 distinct values) and PP-Bizon | Traitor (76).
    // Result: 254.4 MB -> 83.9 MB with the largest file at 1275K, against production's 379.8 MB/6243K.
    private static readonly WeaponTextureTier PaintRoughnessTier = new()
    {
        Mode = WeaponEncodeMode.Lossy,
        Quality = 90,
        GreyGuard = true,
        MaxWidth = Cap,
        LossyGuard = new(30),
        // Nothing in the shipped set reaches this: q90's heaviest file is 1275K. It exists so a future
        // roughness map cannot land above the ceiling, and MinQuality stops one rung short of q80,
        // where the banding proxy quadruples against q90.
        SizeBudget = new((int)Math.Round(1.25 * MB), MinQuality: 84)
    };

    // Paint pattern (RGB = pattern colour OR region weights, A = cut/coverage mask). THREE populations
    // under one property, and the two guards are what separate them:
    //   grain/stipple camo   NoiseGuard catches it first and routes it to PatternNoiseTier. Left to the
    //                        fidelity gate it would be filed under "complex" and kept lossless -- full
    //                        price for a noise realization nothing can see.
    //   region-weight masks  the fidelity gate rejects them (values feed a palette lookup, so facets and
    //   and dense camo       shifts matter) and sends them to PatternFloorTier.
    //   painted artwork      everything else, at q90.
    // Lowering quality self-corrects rather than sliding: a borderline file that clears the gate at q95
    // falls below it at q90 and is routed away from the DCT instead of encoded harder.
    //
    // Both populations downscale to the cap. RGB uses Lanczos; the ALPHA cut mask uses a BOX filter --
    // Lanczos' negative lobes overshoot at the mask's hard 0/255 edges, and the viewer magnifies that
    // ring into a visible wear-boundary artifact when it upsamples for its 4096 bake (FAMAS | Snake Song
    // proved this). Alpha is never stripped: the shader reads RGB under transparent texels.
    //
    // ALPHA WAS HALF THE PROPERTY'S FOOTPRINT. g_tPattern held 810 MB of which the ALPH chunks were
    // 400 MB (49%) -- the tiers had been driving RGB quality down while the mask beside it stayed
    // lossless. Splitting every pattern output by RIFF chunk and classifying its mask by soft fraction
    // (scripts/probe-pattern-budget.ts) puts the win and the risk in different files entirely:
    //     fully soft (>=95% soft)   472 files   269 MB alpha of 463 MB total
    //     mostly soft (50-95%)      162 files    93 MB alpha of 161 MB total
    //     mixed (10-50%)            264 files    36 MB alpha of 143 MB total
    //     hard mask (<10% soft)     109 files     3 MB alpha of  35 MB total
    // The hard binary cut masks are the ones that must stay lossless, and they hold 3 MB, so there is
    // nothing to win there anyway. MinSoft 0.5 takes the two soft classes (362 MB of alpha) and leaves
    // both the hard masks and the ambiguous "mixed" class alone. Eyeballed on Negev | Man-o'-war, the
    // hard case for this: not a smooth wear ramp but a full-range ornamental filigree relief, 100% soft.
    // AlphaQuality 60 took its alpha 1080K -> 498K with the filigree intact and RGB untouched; 40 also
    // read clean. 60 is the default because it is where the size curve has already delivered (a80 1058K,
    // a70 498K, a60 498K, a40 399K) and it keeps margin over the 634 masks nobody looked at individually.
    //
    // THE SIZE BUDGET. A short tail of dense artwork clears the gate at q90 and still lands far above
    // what the rest of the property costs (the property averages ~520K; these sit at 2 MB). They are not
    // a different KIND of texture -- the gate is right that they are artwork -- they are just detailed
    // enough that q90 cannot get them down. Rather than lower the tier for all 876 artwork patterns,
    // which would regress the smooth ones (M4A1-S | Wash me plz visibly blocks below ~q72), spend the
    // quality only where the bytes are. Eyeballed on XM1014 | Heaven Guard, the largest pattern in the
    // set -- 2048 native so the cap never touched it, and only 7% alpha so the alpha gate had nothing to
    // take either: q90 2070K -> q78 1393K -> q64 1121K, with no visible regression at q64. Below that
    // the curve is flat (q60 buys 33K for another 0.2 dB), which is where MinQuality sits.
    private static readonly WeaponTextureTier PatternTier = new()
    {
        Mode = WeaponEncodeMode.Lossy,
        Quality = 90,
        MaxWidth = Cap,
        LossyGuard = new(30),
        // 0.5 sits in a wide empty gap, not on a knife edge: across the whole weapon set the pattern
        // textures measuring below 0.6 are {0.00, 0.02, 0.31, 0.32, 0.55, 0.55}. The first four are pure
        // per-channel confetti; the two at 0.55 are detailed crackle/corrosion ARTWORK that merely
        // happens to be high-frequency (both with cross-channel correlation >= 0.95, i.e. a picture, not
        // three independent selector fields), and 0.5 returns them to the normal gate path.
        NoiseGuard = new(0.5, PatternNoiseTier),
        GuardFallback = PatternFloorTier,
        AlphaGuard = new(0.5, 60),
        SizeBudget = new((int)Math.Round(1.3 * MB), MinQuality: 64)
    };

    // Grunge/dirt detail (RGB = grime colour multiplied over the paint, A = wear modifier). The highest
    // blast radius in the whole build: only SEVEN files and, by md5 of the sources, only THREE distinct
    // images -- gun_grunge (five copies under different hashes, ~2200 skins), gun_grunge_smooth (18
    // skins) and the Glock Ghost Protocol grunge (1 skin). High-frequency noise: halving to 1024 aliases,
    // so the cap is a no-op (every grunge is already 2048).
    //
    // The two populations split on channel correlation, and the fidelity gate separates them unaided:
    //     gun_grunge      corr(R,G) 0.987  corr(R,B) 0.963   near-greyscale, chroma is low-amplitude
    //     ghost protocol  corr(R,G) 0.981  corr(R,B) 0.748   three independent planes
    // Lossy WebP is ALWAYS 4:2:0, so what matters is how much signal lives in chroma. On gun_grunge
    // almost none does and q70 holds 32.9/33.3/31.5 dB (it scores 32.4 and passes); on Ghost Protocol
    // the blue plane collapses to 29.1 dB with max error 105 while green sits at 39.1 -- the textbook
    // subsampling signature -- and it scores 28.5 and routes to GrungeFloorTier. q70 rather than the
    // floor's aggression because of that blast radius: every channel is kept above the 30 dB the guard
    // itself enforces.
    //
    // ALPHA IS WHERE THE WASTE WAS. Splitting the RIFF chunks showed ALPH at 2206K of a 3960K file (56%)
    // encoded at lossless grade for a soft full-range coverage mask. AlphaQuality 40 holds 35.1 dB /
    // max error 17 and is the same value the g_tPattern alpha gate ships on soft masks.
    //
    // THE SIZE BUDGET walks alpha alongside quality because the two planes mean DIFFERENT things:
    //   RGB is a MULTIPLY FACTOR, not a picture. Mean 217/217/205 with stdev 24 -- a near-white field
    //     that darkens the paint under it by a few percent, so error reads as a percentage of whatever
    //     it multiplies: the bottom rung's mean |dRGB| of 6.5 counts is a 2.5% brightness shift, on a
    //     layer that is itself noise. This is the cheap plane to spend.
    //   A is a WEAR MODIFIER, not an opacity -- the shader reads it to decide WHERE wear appears, so it
    //     is effectively thresholded and what matters is the error BOUND, not the mean. It is also 51.2%
    //     soft (8.7% at 0, 40.1% at 255, 251 distinct levels), a real full-range ramp with nothing
    //     degenerate to drop. This is the expensive plane to protect.
    // And the bytes sit on the plane we want to protect: ALPH is 1128K of gun_grunge's 2054K (55%), so
    // an RGB-only walk cannot reach 1.5 MB at all -- quality 70 -> 40 moves only 309K.
    //
    // TWO LEVERS WERE MEASURED AND REJECTED (scripts/probe-grunge-alpha.ts, probe-grunge-res.ts):
    //   POSTERIZING THE ALPHA, which every other data-plane tier here reaches for, because a
    //   hard-bounded error is exactly what a thresholded modifier wants:
    //       post/8  + lossless alpha   ALPH 1568K  max err 4      alphaQuality 20   ALPH 949K  max 30
    //       post/12 + lossless alpha   ALPH 1496K  max err 6      alphaQuality 15   ALPH 871K  max 35
    //   Posterize pays for SHAPE and this plane's shape is noise (lag1 0.63), so VP8L gets nothing back
    //   for the levels removed -- 12 quantization levels still cost 72% more than libwebp's a15. That is
    //   the opposite of the g_tPaintByNumberMasks finding, and the difference is exactly the lag1.
    //   RESOLUTION, re-measured the way the screen sees it (encode at the candidate size, magnify the
    //   DECODED result back to native, score against the pristine PNG):
    //       2048 q40 a15   1489K   RGB 30.0 dB   grain stdev 24.0 -> 24.7
    //       1448 q85 a60   1564K   RGB 25.1 dB   grain stdev 24.0 -> 21.6
    //       1024 q90 a80   1188K   RGB 24.7 dB   grain stdev 24.0 -> 19.6
    //   Every 1024 rung from lossless down to q80 sits at 24.5-24.9 dB, i.e. the resize is the entire
    //   error and the encoder is free -- and it flattens the grain amplitude by 20%, which on a dirt
    //   layer is the visible failure (the gun reads cleaner, not softer).
    //
    // The ladder lands every gun_grunge copy on its bottom rung: q64 a35 1943K, q58 a30 1820K, q52 a25
    // 1730K, q46 a20 1629K, q40 a15 1489K. MinQuality 40 is where the ladder first clears 1.5 MB rather
    // than a floor chosen for its own sake; the RGB there holds 29.6 dB (max err 73) and the wear
    // modifier 27.3 dB (max err 35). AlphaQuality quantizes in coarse buckets on this plane -- 15, 16
    // and 18 produce byte-identical output -- so there is nothing finer to aim at between a15 and a20.
    //
    // VERIFIED IN THE VIEWER, no visible regression anywhere. One image under 2165 skins, so the checks
    // bound each plane's own failure mode rather than sample the population:
    //   grime multiply   flat, light paints, where the multiply has nothing to hide behind and its error
    //                    is proportionally largest: Desert Eagle | Urban DDPAT, AWP | Asiimov and
    //                    M4A1-S | Icarus Fell (near-white), Glock-18 | Sand Dune, AK-47 | Safari Mesh,
    //                    MAC-10 | Candy Apple and Five-SeveN | Orange Peel (solid saturated colour,
    //                    where the max-error specks and any ringing around them read cleanest).
    //   wear modifier    inspected at HIGH FLOAT, because at Factory New this plane barely contributes
    //                    and a15 would look free: AK-47 | Case Hardened, MAC-10 | Candy Apple and
    //                    AK-47 | Safari Mesh Battle-Scarred, plus Bayonet | Case Hardened for a blade at
    //                    close inspect distance. The wear boundaries land where they did.
    //   smooth variant   its own encode (2018K -> 1418K), and its 18 skins are ceramic/flat by design:
    //                    Tec-9 | Raw Ceramic, Negev | Raw Ceramic, SSG 08 | Green Ceramic,
    //                    CZ75-Auto | Pink Pearl, P2000 | Grip Tape.
    // Glock-18 | Ghost Protocol was not re-checked: it routes to GrungeFloorTier, already fit at 1466K,
    // and the budget never touched it. Result: 13.4 MB -> 10.1 MB with the largest file at 1489K,
    // against production's 31.1 MB and 4736K.
    private static readonly WeaponTextureTier GrungeTier = new()
    {
        Mode = WeaponEncodeMode.Lossy,
        Quality = 70,
        MaxWidth = Cap,
        AlphaQuality = 40,
        SmartSubsample = true,
        LossyGuard = new(30),
        GuardFallback = GrungeFloorTier,
        SizeBudget = new((int)Math.Round(1.5 * MB), MinQuality: 40, MinAlphaQuality: 15)
    };

    // Albedo (RGB = base colour, A = paint/wear coverage mask). The heaviest colour maps are already 2K,
    // so a downscale-only tier skipped them entirely and left them lossless at 4-5 MB. Resolution is
    // preserved (only above the cap is resized); the win is re-encoding. RGB goes lossy q80 (a detailed
    // albedo holds ~38 dB) and the ALPHA -- which for a soft coverage mask is ~87% of the file at
    // lossless -- is compressed at 60. USP-S | Dark Water (soft mask) 4921K -> 668K and Galil AR |
    // Winter Forest (near-binary hard mask, 5.5% soft) 2758K -> 255K both showed no visible regression.
    // The fidelity gate keeps any data-packed colour map (values feeding a lookup rather than pure
    // albedo) lossless, same as g_tPattern.
    private static readonly WeaponTextureTier ColorTier = new()
    {
        Mode = WeaponEncodeMode.Lossy,
        Quality = 80,
        MaxWidth = Cap,
        AlphaQuality = 60,
        LossyGuard = new(30)
    };

    // >>> TUNE HERE <<< property name -> encode tier. A property absent from this table is never
    // touched: its textures take the default lossless path, byte-identical to an untiered texture.
    public static readonly IReadOnlyDictionary<string, WeaponTextureTier> Targets =
        new Dictionary<string, WeaponTextureTier>(StringComparer.Ordinal)
        {
            ["g_tPattern"] = PatternTier,
            ["g_tGrunge"] = GrungeTier,
            ["g_tNormal"] = NormalTier,
            ["g_tColor"] = ColorTier,
            ["g_tWear"] = WearTier,
            ["g_tPaintByNumberMasks"] = PaintByNumberTier,
            ["g_tPearlescenceMask"] = MaskDownscaleOnly,
            ["g_tPaintMetalness"] = MaskDownscaleOnly,
            ["g_tOverlayMask"] = MaskDownscaleOnly,
            ["g_tMasks"] = MaskDownscaleOnly,
            ["g_tMetalness"] = MetalnessTier,
            ["g_tPaintRoughness"] = PaintRoughnessTier,
            ["g_tAmbientOcclusion"] = DownscaleOnly,
            ["g_tFinalAmbientOcclusion"] = DownscaleOnly,
            ["g_tSurface"] = SurfaceTier,
            ["g_tOverlay"] = OverlayTier
        };

    // ---------------------------------------------------------------------------------------------
    // CLASSIFIER
    // ---------------------------------------------------------------------------------------------

    // Walks every material's parsed data and returns `resolved .vtex path -> tier` for the weapon
    // textures that qualify. A texture qualifies only if EVERY binding of it, across the whole build, is
    // a weapon-family material binding it to a target property -- one foreign binding (a glove's
    // g_tSurface, a sticker's g_tColor, a character's g_tNormal, or any non-target parameter such as a
    // glove's g_tObjectProperties) disqualifies it, because the tiers here are written against the
    // weapon meaning of those channels and a shared texture has no single meaning.
    //
    // `resolveTexturePath` maps a raw `.vtex` reference to the same resolved key the encode loop uses
    // (null when it cannot be resolved). Material data nodes are the plain object graph the metadata
    // extractor produces: nested Dictionary<string, object?> / List<object?> / string.
    public static Dictionary<string, WeaponTextureTier> ResolveTextureTiers(
        IEnumerable<object?> materialData,
        IEnumerable<object?> compositeMaterialData,
        Func<string, string?> resolveTexturePath)
    {
        var targetProperty = new Dictionary<string, string>(StringComparer.Ordinal);
        var foreign = new HashSet<string>(StringComparer.Ordinal);

        foreach (var data in materialData)
            Walk(data, contextName: null, IsWeaponShader(data), targetProperty, foreign, resolveTexturePath);
        // A `.vcompmat` carries no shader name and is always a weapon paint composite.
        foreach (var data in compositeMaterialData)
            Walk(data, contextName: null, weaponFamily: true, targetProperty, foreign, resolveTexturePath);

        foreach (var path in foreign)
            targetProperty.Remove(path);

        var tiers = new Dictionary<string, WeaponTextureTier>(StringComparer.Ordinal);
        foreach (var (path, property) in targetProperty)
            tiers[path] = Targets[property];
        return tiers;
    }

    private static bool IsWeaponShader(object? data) =>
        data is Dictionary<string, object?> dict &&
        dict.TryGetValue("m_shaderName", out var shader) &&
        shader is string name &&
        WeaponShaders.Contains(name);

    private static bool IsExcludedPath(string resolved)
    {
        var path = $"/{resolved.Replace('\\', '/').TrimStart('/')}";
        foreach (var segment in ExcludedPathSegments)
            if (path.Contains(segment, StringComparison.OrdinalIgnoreCase)) return true;
        return false;
    }

    private static void Walk(
        object? value,
        string? contextName,
        bool weaponFamily,
        Dictionary<string, string> targetProperty,
        HashSet<string> foreign,
        Func<string, string?> resolveTexturePath)
    {
        switch (value)
        {
            case string reference:
                if (!IsTextureReference(reference)) return;
                var resolved = resolveTexturePath(reference);
                if (resolved == null) return;
                if (weaponFamily && contextName != null && Targets.ContainsKey(contextName) &&
                    !IsExcludedPath(resolved))
                {
                    // First target property wins, mirroring the out-of-band tool. No texture in the
                    // build is bound to two different target properties, so there is nothing to resolve.
                    if (!targetProperty.ContainsKey(resolved))
                        targetProperty[resolved] = contextName;
                }
                else
                {
                    foreign.Add(resolved);
                }
                return;

            case List<object?> list:
                foreach (var entry in list)
                    Walk(entry, contextName, weaponFamily, targetProperty, foreign, resolveTexturePath);
                return;

            case Dictionary<string, object?> dict:
                // A texture-bearing node names its parameter with `m_name` (vmat) or `m_strName`
                // (vcompmat); the texture path sits under a sibling key. Propagate that name down so a
                // texture string inherits the parameter it belongs to.
                var name =
                    dict.TryGetValue("m_name", out var mName) && mName is string n1 && n1.Length > 0 ? n1 :
                    dict.TryGetValue("m_strName", out var mStrName) && mStrName is string n2 && n2.Length > 0 ? n2 :
                    contextName;
                foreach (var (key, child) in dict)
                    Walk(child, name ?? key, weaponFamily, targetProperty, foreign, resolveTexturePath);
                return;
        }
    }

    private static bool IsTextureReference(string value) =>
        MaterialPaths.NormalizeMaterialResourcePath(value).EndsWith(".vtex", StringComparison.OrdinalIgnoreCase);
}
