/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

namespace ItemGenerator;

// Per-property WebP encode tiers for WEAPON and KNIFE textures, one of the four tuning surfaces
// beside StickerTextureOptimization, GloveTextureOptimization and KeychainTextureOptimization. Every
// texture in the pipeline is lossless by default (see item-generator-webp.ts); these four files are
// the only places that opt a texture into a smaller encoding. Edit Targets, rebuild, done.
//
// THE SPLIT OF RESPONSIBILITY. This file owns POLICY: which property gets which tier, with which
// thresholds and budgets. scripts/item-generator-webp.ts owns MEASUREMENT: every "guard" named below
// is a TEXTURE-DRIVEN classifier it evaluates against the pristine decompiled PNG. Nothing here keys
// on a filename, a skin or a resolution.
//
// SCOPE. Most of these parameter names are not weapon-exclusive -- glove, character, sticker and
// simple-prop materials bind them too, and g_tSurface means something else entirely on a glove -- so
// a texture qualifies only when EVERY material that binds it, anywhere in the build, is a
// weapon-family material binding it to a target property (see WeaponShaders and ResolveTextureTiers).
// Keychains ride on csgo_weapon.vfx too and are excluded by path; KeychainTextureOptimization owns
// them.

// The three encode modes, as the wire format spells them. A plain const rather than an enum because
// the tier record below IS the descriptor the encoder receives -- there is no DTO to map through.
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
    // has no shader of its own and is always a weapon paint composite, so composites are in scope
    // unconditionally.
    public static readonly IReadOnlySet<string> WeaponShaders = new HashSet<string>(
        StringComparer.OrdinalIgnoreCase
    )
    {
        "csgo_customweapon.vfx",
        "csgo_composite_inputs.vfx",
        "csgo_weapon.vfx",
    };

    // Keychains are csgo_weapon.vfx models hanging off a weapon, so the shader rule alone would sweep
    // them in. Their channels are the weapon ones, but their population inverts facts these tiers are
    // tuned to, so KeychainTextureOptimization owns them instead.
    public static readonly IReadOnlyList<string> ExcludedPathSegments = ["/keychains/"];

    // ---------------------------------------------------------------------------------------------
    // TIERS. Each records what the property's channels mean and the constraint its settings solve.
    // ---------------------------------------------------------------------------------------------

    // The resolution cap every tier shares: a weapon covers little screen even zoomed, and 4K maps are
    // the bulk of the footprint. On properties whose textures are already at or below it, the cap is a
    // deliberate no-op.
    private const int Cap = 2048;

    private const int KB = 1024;
    private const int MB = 1024 * 1024;

    // Downscale-only, for the base-body maps: re-encode from the pristine PNG at LOSSLESS quality but
    // cap the long side. MinWidth leaves 2K/1K maps exactly as they are, so the win is purely
    // resolution.
    private static readonly WeaponTextureTier DownscaleOnly = new()
    {
        Mode = WeaponEncodeMode.Lossless,
        Quality = 100,
        MaxWidth = Cap,
        MinWidth = Cap + 1,
    };

    // Same downscale-only deal, for properties whose pixels are a MASK rather than a picture: coverage
    // and selection planes (g_tPearlescenceMask, g_tOverlayMask, g_tMasks) and a scalar material plane
    // (g_tPaintMetalness). MaskKernel area-averages every plane instead of running RGB through Lanczos,
    // whose negative lobes overshoot at a mask's hard edges and invent coverage values no neighbouring
    // texel had.
    private static readonly WeaponTextureTier MaskDownscaleOnly = new()
    {
        Mode = WeaponEncodeMode.Lossless,
        Quality = 100,
        MaxWidth = Cap,
        MinWidth = Cap + 1,
        MaskKernel = true,
    };

    // Normal maps (BC5 hemi-oct RG, or BC7 RG + isoRough in B). Lossy q80 holds high-frequency
    // ridge/relief normals with no visible regression and keeps each map well under 1 MB. Alpha is
    // flat and unused but is KEPT (never stripped) so the shader's .a sample stays 0.0 rather than
    // 1.0 -- the opposite of the wear/roughness case below, where alpha is a constant 255 and dropping
    // it is free.
    private static readonly WeaponTextureTier NormalTier = new()
    {
        Mode = WeaponEncodeMode.Lossy,
        Quality = 80,
        MaxWidth = Cap,
    };

    // GRAIN patterns: the spray/stipple camo class, whose RGB is a high-frequency dither over
    // independent selector fields while the skin's structure rides on ALPHA. So quality goes to 50
    // (the noise realization is invisible), 4:4:4 keeps the chroma subsampler off channels that must
    // stay independent, and decimate + GrainBoost 1.5 restores the amplitude an averaging kernel would
    // flatten into visible blotching. The boost works on each texel's residual against its block mean,
    // so it cannot shift overall contrast or clip.
    private static readonly WeaponTextureTier PatternNoiseTier = new()
    {
        Mode = WeaponEncodeMode.Lossy,
        Quality = 50,
        MaxWidth = Cap,
        SmartSubsample = true,
        AlphaQuality = 60,
        Decimate = true,
        GrainBoost = 1.5,
    };

    // NOISE-FLOOR patterns: where a g_tPattern fidelity-gate FAILURE goes, instead of lossless. A
    // rejection here is an incompressible grain field the encoder discards at any quality, not
    // structure it failed to represent, so lossless would only be paying full price to store grain. A
    // real palette/region mask is protected by the never-regress rule instead, since few distinct
    // values compress better losslessly than lossily. 4:4:4 for the saturated strokes this class is
    // made of; below ~q72 its smooth areas go blocky. Alpha stays lossless.
    private static readonly WeaponTextureTier PatternFloorTier = new()
    {
        Mode = WeaponEncodeMode.Lossy,
        Quality = 75,
        MaxWidth = Cap,
        SmartSubsample = true,
    };

    // Where a g_tOverlay fidelity-gate FAILURE goes. Deliberately the GENTLE remedy rather than
    // PatternFloorTier's q75: spend more bits exactly where the gate said the encode fell short (+10
    // quality and 4:4:4). That clears the gate's own bar for well under half the lossless bytes.
    private static readonly WeaponTextureTier OverlayFloorTier = new()
    {
        Mode = WeaponEncodeMode.Lossy,
        Quality = 90,
        AlphaQuality = 60,
        SmartSubsample = true,
        MaxWidth = Cap,
    };

    // INDEPENDENT-CHANNEL grunge: where a g_tGrunge fidelity-gate FAILURE goes. R/G/B are three
    // separate planes, so the DCT damages the chroma-carried ones -- but posterize + lossless cannot
    // reach 1.5 MB without quantizing the grime field down to a few grey levels, so this tier stays
    // lossy and re-accepts that damage. Alpha takes a disproportionate share of the budget (a15)
    // because it spans only 190-255, where error reads as a broad opacity shift across the whole gun
    // while colour error hides in the noise.
    private static readonly WeaponTextureTier GrungeFloorTier = new()
    {
        Mode = WeaponEncodeMode.Lossy,
        Quality = 28,
        AlphaQuality = 15,
        SmartSubsample = true,
        MaxWidth = Cap,
    };

    // Reached only by a g_tMetalness file the guards sent to the lossless floor. See MetalnessTier.
    private static readonly WeaponTextureTier MetalnessFloorTier = new()
    {
        Mode = WeaponEncodeMode.Lossless,
        Quality = 100,
        MaxWidth = Cap,
        MaskKernel = true,
    };

    // PAINT-BY-NUMBER masks: R/G/B/A are four INDEPENDENT region-weight planes, each selecting one
    // palette slot, so alpha here is DATA rather than transparency. Lossy WebP is always 4:2:0 YUV and
    // pulls those planes apart -- a chroma-carried plane takes errors of ~230 counts, i.e. a WRONG
    // palette slot rather than a slightly wrong one -- so the lever is posterize + lossless, whose
    // error is hard-bounded at step/2. It fires only as a budget backstop, so a mask that already fits
    // stays bit-exact, and MaskKernel keeps the resize from overshooting the way Lanczos does on a
    // near-binary plane.
    //
    // MaskGuard splits the two populations the property holds, which need opposite encoders:
    //   1. A REPLICATED mask (R == G == B) is one weight field copied three times, so its chroma is
    //      constant and there is nothing for the subsampler to destroy -- it spends its budget on
    //      QUALITY where a chromatic mask spends POSTERIZE.
    //   2. An ALPHA spanning 254..255 is 0.996 vs 1.0 as a palette weight, which no blend can show,
    //      yet lossless VP8L pays full price for the shape of its 254 region. Flattening drops the
    //      ALPH chunk and decoders return the 1.0 the plane already meant.
    private static readonly WeaponTextureTier PaintByNumberTier = new()
    {
        Mode = WeaponEncodeMode.Lossless,
        Quality = 100,
        MaxWidth = Cap,
        MaskKernel = true,
        MaskGuard = true,
        MaskBudget = new((int)Math.Round(1.3 * MB), [75, 70, 65], [8, 12, 16, 20]),
    };

    // OVERLAY colour composited over the paint (BC7 RGBA sRGB): RGB is a picture, A is the overlay's
    // own opacity -- g_tColor's shape and mostly its tier. No MinWidth, because the heaviest files are
    // natively 2048 or below and a resize-only tier could not touch them. Two things g_tColor does not
    // need: ALPH runs 65-99% of an overlay, so MinAlphaQuality puts alpha on a ladder an RGB-only walk
    // would move by ~1%; and a third of the population has a fake alpha spanning one count (254..255)
    // that FlattenGuard drops outright, leaving RGB bit-identical. The fidelity gate never binds here
    // -- a flat stencil overlay is a handful of colours a DCT loses nothing on -- but is kept as
    // insurance. SmartSubsample was measured and rejected: no fidelity gain for 3-5% more bytes.
    private static readonly WeaponTextureTier OverlayTier = new()
    {
        Mode = WeaponEncodeMode.Lossy,
        Quality = 80,
        MaxWidth = Cap,
        AlphaQuality = 60,
        LossyGuard = new(30),
        GuardFallback = OverlayFloorTier,
        FlattenGuard = true,
        SizeBudget = new((int)Math.Round(1.2 * MB), MinQuality: 56, MinAlphaQuality: 15),
    };

    // Object-space surface normal (BC7 RGB), the triplanar composite input deciding how a paint pattern
    // projects onto the body. It is a SPARSE SCATTER, not a picture: few-texel fragments of normal data
    // on pure black, with ALPHA holding a 4-value LABEL. Each fragment is an impulse a DCT smears across
    // its block and rings into the background, inventing normals where the map says there is no surface,
    // so this property takes posterize + lossless instead: the same mean angular error with a far
    // smaller tail, and no gradient for the quantizer to band. Alpha is never flattened (0 means "no
    // surface here", so flattening would relabel the background) and never posterized (the quantizer
    // skips planes under 32 distinct values, and this one holds 4). Resolution is no lever either --
    // downscaling averages the fragments into the background and corrupts the label plane -- so the cap
    // must stay the no-op it is. The budget sits at production's ceiling for the property, so files
    // already under it stay BIT-EXACT.
    private static readonly WeaponTextureTier SurfaceTier = new()
    {
        Mode = WeaponEncodeMode.Lossless,
        Quality = 100,
        MaxWidth = Cap,
        MaskKernel = true,
        // No MaskGuard on purpose (see above), which also means MaskBudget takes its posterize ladder
        // rather than the replicated-lossy one -- the right default for three independent data planes.
        MaskBudget = new(350 * KB, [80, 70, 60], [4, 8, 12, 16, 24, 32]),
    };

    // Packed roughness/metalness (BC5 R = roughness INVERTED, G = metalness; the BC7 variant adds
    // B = SFX mask). R and G are independent scalar planes, often negatively correlated, which is what
    // 4:2:0 destroys -- hence 4:4:4. The coder choice goes the opposite way from PaintByNumberTier for
    // the same underlying reason: this content is mostly SMOOTH GRADIENT, where posterize bands (it is
    // visible at step 8 already) and the DCT is both cleaner and smaller, while a region mask is the
    // reverse. What lossy costs is ringing at material boundaries and a constant B plane that DRIFTS,
    // which is why SfxGuard exists: B is constant in every file today, so drift can only invent an SFX
    // mask that was not there, and any file carrying a REAL one is routed to the bounded posterize
    // path. MaskKernel because the 4K files must come down to the cap and area averaging cannot
    // overshoot at a material edge. Resolution is no lever beyond that: 1024 fits the budget, but it
    // resamples the fine machined detail unbounded.
    private static readonly WeaponTextureTier MetalnessTier = new()
    {
        Mode = WeaponEncodeMode.Lossy,
        Quality = 90,
        MaxWidth = Cap,
        // Independent planes: never let the chroma subsampler near them.
        SmartSubsample = true,
        MaskKernel = true,
        MaskGuard = true,
        SfxGuard = true,
        LossyGuard = new(30),
        GuardFallback = MetalnessFloorTier,
        SizeBudget = new(MB, MinQuality: 70),
        // Reached only by a file the guards sent to the lossless floor that is STILL over budget, which
        // is where the bounded quantizer is the right answer: no DCT is involved on that path at all.
        MaskBudget = new(MB, [80, 70, 60], [4, 8, 12, 16, 24, 32]),
    };

    // Paint-wear pattern (BC4 R): the scalar field the shader thresholds against the item's wear float
    // to decide where paint has rubbed through to base metal. R = G = B with a constant-255 alpha, so
    // GreyGuard collapses it to one plane (grey lossless reproduces R bit-exactly) and drops an alpha
    // the shader would sample as 1.0 anyway -- the opposite of the normal-map case, where alpha is flat
    // at 0 and must be kept. Resolution is no lever on a dense scratch field, so quality is the one
    // that matters: q90 is indistinguishable from native at 3x zoom where q85 softens the grain and q80
    // washes it out, and because the field is THRESHOLDED rather than displayed, smoothing it moves
    // wear boundaries. MinQuality is never reached in practice; it stops a future wear map short of the
    // range where the grain visibly washes out. Blast radius is the whole set -- paint_wear_psd alone
    // feeds 1948 skins.
    private static readonly WeaponTextureTier WearTier = new()
    {
        Mode = WeaponEncodeMode.Lossy,
        Quality = 90,
        GreyGuard = true,
        MaxWidth = Cap,
        LossyGuard = new(30),
        SizeBudget = new((int)Math.Round(1.5 * MB), MinQuality: 78),
    };

    // Per-paint roughness (BC4 R): the scalar gloss field the shader hands to the specular lobe. No
    // MinWidth, as on g_tOverlay, or the native-2048 maps -- which include the three heaviest files in
    // the property -- would stay fully lossless. R = G = B in 203 of 203, so GreyGuard collapses every
    // file; that buys almost nothing on bytes, since VP8L already encodes duplicate planes and a
    // constant alpha cheaply, but on the lossy path it removes the chroma planes and with them any
    // question of what 4:2:0 does to a data field, which is why SmartSubsample is absent here. q90
    // clears the ceiling across the population on its own, and the reason to stop there is BANDING:
    // texels flat in the source that acquire an 8-count step in the decode roughly triple at q85 and
    // again at q80, and a roughness contour is a visible ring that sweeps as the highlight moves.
    // Resolution is no lever, measured on the magnification axis: every 1024 rung loses ~15 dB with
    // lossless and q90 within 0.1 dB of each other, so the resize is the entire error. The fidelity
    // gate is inert on a continuous scalar and kept only as insurance against a future region mask.
    private static readonly WeaponTextureTier PaintRoughnessTier = new()
    {
        Mode = WeaponEncodeMode.Lossy,
        Quality = 90,
        GreyGuard = true,
        MaxWidth = Cap,
        LossyGuard = new(30),
        // Nothing in the shipped set reaches this; it exists so a future roughness map cannot land
        // above the ceiling. MinQuality stops one rung short of q80, where the banding proxy
        // quadruples against q90.
        SizeBudget = new((int)Math.Round(1.25 * MB), MinQuality: 84),
    };

    // Paint pattern (RGB = pattern colour OR region weights, A = cut/coverage mask). THREE populations
    // under one property, and the guards are what separate them:
    //   grain/stipple camo   NoiseGuard routes it to PatternNoiseTier; the fidelity gate alone would
    //                        file it under "complex" and pay lossless prices for invisible noise.
    //   region-weight masks  the fidelity gate rejects them (their values feed a palette lookup, so
    //   and dense camo       facets and shifts matter) and sends them to PatternFloorTier.
    //   painted artwork      everything else, at q90.
    // Lowering quality self-corrects rather than sliding: a file that clears the gate at q95 and fails
    // it at q90 is routed away from the DCT instead of encoded harder.
    //
    // RGB downscales through Lanczos, but the ALPHA cut mask uses a BOX filter -- Lanczos overshoots at
    // its hard 0/255 edges, and a renderer magnifies that ring into a visible wear-boundary artifact
    // when it upsamples for its 4096 bake. Alpha is never stripped: the shader reads RGB under
    // transparent texels. It is also half the property's footprint, and AlphaGuard's MinSoft 0.5 is
    // where the bytes and the risk separate: the soft masks hold essentially all of the alpha bytes,
    // while the hard binary ones that must stay lossless hold almost none.
    //
    // The size budget catches a short tail of dense artwork that clears the gate at q90 and still lands
    // far above what the property costs on average. Lowering the tier for all 876 artwork patterns
    // would regress the smooth ones, so the quality is spent only where the bytes are, down to q64
    // where the curve goes flat.
    private static readonly WeaponTextureTier PatternTier = new()
    {
        Mode = WeaponEncodeMode.Lossy,
        Quality = 90,
        MaxWidth = Cap,
        LossyGuard = new(30),
        // 0.5 sits in a wide empty gap, not on a knife edge: the only patterns near it are pure
        // per-channel confetti well below, and two crackle/corrosion ARTWORKS at 0.55 that are merely
        // high-frequency (cross-channel correlation >= 0.95, i.e. a picture rather than three
        // independent selector fields), which 0.5 returns to the normal gate path.
        NoiseGuard = new(0.5, PatternNoiseTier),
        GuardFallback = PatternFloorTier,
        AlphaGuard = new(0.5, 60),
        SizeBudget = new((int)Math.Round(1.3 * MB), MinQuality: 64),
    };

    // Grunge/dirt detail (RGB = grime colour multiplied over the paint, A = wear modifier). The highest
    // blast radius in the build -- seven files, three distinct images, one of them feeding ~2200 skins
    // -- so q70 rather than the floor tier's aggression, keeping every channel above the 30 dB the
    // guard enforces. It is high-frequency noise, so halving aliases and the cap is a no-op. The
    // fidelity gate splits the two populations unaided: the near-greyscale image holds up under 4:2:0,
    // while the one with three independent planes collapses on blue and routes to GrungeFloorTier.
    //
    // The budget walks ALPHA alongside quality because ALPH is more than half the file and an RGB-only
    // walk cannot reach 1.5 MB at all. The planes also mean different things: RGB is a narrow-range
    // MULTIPLY FACTOR over what is already noise, where the bottom rung costs a ~2.5% brightness shift,
    // while alpha is a WEAR MODIFIER the shader thresholds, where the error BOUND matters rather than
    // the mean. Posterizing that alpha was measured and rejected -- it costs 72% more than a15, because
    // posterize pays for SHAPE and this plane's shape is noise -- and so was resolution, which is the
    // entire error at 1024 and flattens grain amplitude by 20%, reading as a cleaner gun rather than a
    // softer one.
    private static readonly WeaponTextureTier GrungeTier = new()
    {
        Mode = WeaponEncodeMode.Lossy,
        Quality = 70,
        MaxWidth = Cap,
        AlphaQuality = 40,
        SmartSubsample = true,
        LossyGuard = new(30),
        GuardFallback = GrungeFloorTier,
        SizeBudget = new((int)Math.Round(1.5 * MB), MinQuality: 40, MinAlphaQuality: 15),
    };

    // Albedo (RGB = base colour, A = paint/wear coverage mask). The heaviest colour maps are already 2K,
    // so resolution is not the lever: only sources above the cap resize, and the win is the re-encode.
    // RGB goes lossy q80 and the ALPHA -- which for a soft coverage mask is ~87% of the file at
    // lossless -- is compressed at 60. The fidelity gate keeps any data-packed colour map (values
    // feeding a lookup rather than pure albedo) lossless, same as g_tPattern.
    private static readonly WeaponTextureTier ColorTier = new()
    {
        Mode = WeaponEncodeMode.Lossy,
        Quality = 80,
        MaxWidth = Cap,
        AlphaQuality = 60,
        LossyGuard = new(30),
    };

    // A property absent from this table is never touched: its textures take the default lossless path,
    // byte-identical to an untiered texture.
    public static readonly IReadOnlyDictionary<string, WeaponTextureTier> Targets = new Dictionary<
        string,
        WeaponTextureTier
    >(StringComparer.Ordinal)
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
        ["g_tOverlay"] = OverlayTier,
    };

    // ---------------------------------------------------------------------------------------------
    // CLASSIFIER
    // ---------------------------------------------------------------------------------------------

    // Walks every material's parsed data and returns `resolved .vtex path -> tier` for the weapon
    // textures that qualify. A texture qualifies only if EVERY binding of it, across the whole build, is
    // a weapon-family material binding it to a target property -- one foreign binding (a glove's
    // g_tSurface, a sticker's g_tColor, a character's g_tNormal, or any non-target parameter)
    // disqualifies it, because the tiers here are written against the weapon meaning of those channels
    // and a shared texture has no single meaning.
    //
    // `resolveTexturePath` maps a raw `.vtex` reference to the same resolved key the encode loop uses
    // (null when it cannot be resolved). Material data nodes are the plain object graph the metadata
    // extractor produces: nested Dictionary<string, object?> / List<object?> / string.
    public static Dictionary<string, WeaponTextureTier> ResolveTextureTiers(
        IEnumerable<object?> materialData,
        IEnumerable<object?> compositeMaterialData,
        Func<string, string?> resolveTexturePath
    )
    {
        var targetProperty = new Dictionary<string, string>(StringComparer.Ordinal);
        var foreign = new HashSet<string>(StringComparer.Ordinal);

        foreach (var data in materialData)
            Walk(
                data,
                contextName: null,
                IsWeaponShader(data),
                targetProperty,
                foreign,
                resolveTexturePath
            );
        // A `.vcompmat` carries no shader name and is always a weapon paint composite.
        foreach (var data in compositeMaterialData)
            Walk(
                data,
                contextName: null,
                weaponFamily: true,
                targetProperty,
                foreign,
                resolveTexturePath
            );

        foreach (var path in foreign)
            targetProperty.Remove(path);

        var tiers = new Dictionary<string, WeaponTextureTier>(StringComparer.Ordinal);
        foreach (var (path, property) in targetProperty)
            tiers[path] = Targets[property];
        return tiers;
    }

    private static bool IsWeaponShader(object? data) =>
        data is Dictionary<string, object?> dict
        && dict.TryGetValue("m_shaderName", out var shader)
        && shader is string name
        && WeaponShaders.Contains(name);

    private static bool IsExcludedPath(string resolved)
    {
        var path = $"/{resolved.Replace('\\', '/').TrimStart('/')}";
        foreach (var segment in ExcludedPathSegments)
            if (path.Contains(segment, StringComparison.OrdinalIgnoreCase))
                return true;
        return false;
    }

    private static void Walk(
        object? value,
        string? contextName,
        bool weaponFamily,
        Dictionary<string, string> targetProperty,
        HashSet<string> foreign,
        Func<string, string?> resolveTexturePath
    )
    {
        switch (value)
        {
            case string reference:
                if (!IsTextureReference(reference))
                    return;
                var resolved = resolveTexturePath(reference);
                if (resolved == null)
                    return;
                if (
                    weaponFamily
                    && contextName != null
                    && Targets.ContainsKey(contextName)
                    && !IsExcludedPath(resolved)
                )
                {
                    // First target property wins. No texture in the build is bound to two different
                    // target properties, so there is nothing to resolve.
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
                    Walk(
                        entry,
                        contextName,
                        weaponFamily,
                        targetProperty,
                        foreign,
                        resolveTexturePath
                    );
                return;

            case Dictionary<string, object?> dict:
                // A texture-bearing node names its parameter with `m_name` (vmat) or `m_strName`
                // (vcompmat); the texture path sits under a sibling key. Propagate that name down so a
                // texture string inherits the parameter it belongs to.
                var name =
                    dict.TryGetValue("m_name", out var mName) && mName is string n1 && n1.Length > 0
                        ? n1
                    : dict.TryGetValue("m_strName", out var mStrName)
                    && mStrName is string n2
                    && n2.Length > 0
                        ? n2
                    : contextName;
                foreach (var (key, child) in dict)
                    Walk(
                        child,
                        name ?? key,
                        weaponFamily,
                        targetProperty,
                        foreign,
                        resolveTexturePath
                    );
                return;
        }
    }

    private static bool IsTextureReference(string value) =>
        MaterialPaths
            .NormalizeMaterialResourcePath(value)
            .EndsWith(".vtex", StringComparison.OrdinalIgnoreCase);
}
