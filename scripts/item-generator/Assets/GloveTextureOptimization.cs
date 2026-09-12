/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

namespace ItemGenerator;

// Per-property WebP encode tiers for GLOVE textures, the third of the three tuning surfaces beside
// StickerTextureOptimization and WeaponTextureOptimization. Every texture in the pipeline is lossless
// by default (see item-generator-webp.ts); these three files are the only places that opt a texture
// into a smaller encoding. Edit Targets, rebuild, done.
//
// THE SPLIT OF RESPONSIBILITY is the weapon file's: this file owns POLICY (which property gets which
// tier, with which thresholds and budgets), scripts/item-generator-webp.ts owns MEASUREMENT (every
// "guard" named below is a TEXTURE-DRIVEN classifier it evaluates against the pristine decompiled
// PNG). Nothing here keys on a filename, a skin, or a resolution an artist happened to choose.
//
// HOW THE TIERS WERE DERIVED. Unlike the weapon set, almost nothing here is a new operating point:
// each tier is a weapon tier that was already measured and eyeballed, applied to the glove property
// whose channels MEAN the same thing. What is new is the MAPPING, and it is grounded in two things
// rather than assumption -- the per-parameter channel annotations in MaterialTextureProperties.cs,
// which is what decides which tier a property belongs to, and a channel survey of the glove set
// (scripts/probe-glove-channels.ts) that says which population each texture lands in. The candidate
// policy was iterated out of band with scripts/tool-reencode-gloves.ts, which re-encodes the same
// textures in place under scripts/workdir/output so a tier can be eyeballed in ../cs2-3d-viewer
// without a full generator run; the numbers quoted below come from it and from the probes it cites.
// Against the production build the glove set falls from 370 MB to 81 MB with no file over 1.5 MB.
//
// THE CEILING. Every budget here aims at the same 1.5 MB per-texture ceiling. That is a property of
// the SET (a glove is two small objects on screen, and the player's own hands are the thing they see
// most often) rather than of any one property's content, so the tiers differ in which lever they
// spend to reach it, not in where it sits.
//
// SCOPE. A glove texture qualifies only when EVERY binding of it, anywhere in the build, is a glove
// material binding it to a target property -- the same rule WeaponTextureOptimization uses, and the
// reason the two scopes can never overlap (a texture bound by both a weapon and a glove material is
// dropped by both classifiers). Two shader families make up the glove set and they are admitted
// differently:
//   csgo_customglove.vfx / csgo_customglove_preview.vfx / csgo_textile_layer.vfx
//       glove-exclusive shaders -- the paint-kit compositor, its preview material and the textile
//       layer materials. Admitted on the shader name alone, exactly like the weapon families.
//   csgo_character.vfx
//       the SHARED character shader: an agent binds g_tColor / g_tNormal / g_tAmbientOcclusion
//       through it too, and this file's tiers are written against the glove meaning of those
//       channels. So it is admitted only under `characters/models/shared/arms/`
//       (GlovePathSegments), which is the first-person arm set a glove item ships: the ten
//       `glove_*` models that carry the base/vanilla gloves' materials, and the `bare_arms` model
//       every one of them binds for the forearm. If an agent ever binds one of those textures too,
//       the foreign rule below drops it without this scope having to know.
// Composites (`.vcompmat`) are deliberately absent: a glove composite is a CCompositeMaterialEditorDoc
// of loose variables and material references that binds no texture of its own, so there is nothing
// for this classifier to find in one.

// The encode modes, as the wire format spells them -- a plain const rather than an enum for the
// reason WeaponEncodeMode documents: the tier record below IS the descriptor the encoder receives.
public static class GloveEncodeMode
{
    public const string Lossless = "lossless";
    public const string Lossy = "lossy";
}

// Below `MaxLag1` mean lag-1 autocorrelation the RGB is a grain field, not a picture, and takes
// `Fallback` instead of the tier's own encoding.
public sealed record GloveNoiseGuard(double MaxLag1, GloveTextureTier Fallback);

// Below `MinPsnr` dB (lossy reconstruction vs the pristine PNG, measured at NATIVE resolution) the
// texture's values feed a lookup rather than an eye, and it takes GuardFallback.
public sealed record GloveLossyGuard(double MinPsnr);

// Compress the ALPHA plane at `AlphaQuality`, but only when at least `MinSoft` of it is soft (neither
// 0 nor 255). A hard binary mask is left lossless.
public sealed record GloveAlphaGuard(double MinSoft, int AlphaQuality);

// Step quality down by 6 until the encode fits `MaxBytes`, stopping at `MinQuality`. `MinAlphaQuality`
// opts the alpha plane into the same walk. `Widths` is the LAST rung: a tier whose remaining bytes sit
// in planes it is not allowed to quantize restarts at its own quality on a smaller image instead (see
// PackedTier).
public sealed record GloveSizeBudget(int MaxBytes, int MinQuality, int? MinAlphaQuality = null, int[]? Widths = null);

// The mask-tier counterpart: a REPLICATED mask (R==G==B) walks `Qualities` lossy, an independent-plane
// one walks `Steps` as posterize bucket widths under a lossless encode, and `Widths` is again the last
// rung when quantization has run out. Only fires when over `MaxBytes`.
public sealed record GloveMaskBudget(int MaxBytes, int[] Qualities, int[] Steps, int[]? Widths = null);

// One encode tier, and the exact descriptor item-generator-webp.ts receives (camelCase, nulls
// omitted). Field semantics are documented once, on the EncodeSpec interface there, so the mechanism
// and its documentation cannot drift apart. The weapon-only knobs (StripAlpha, NearLossless,
// MinWidth, SfxGuard, MaskGuard) are deliberately absent: no glove tier uses them, and FlatPlaneGuard
// is the glove counterpart of SfxGuard.
public sealed record GloveTextureTier
{
    public string Kind { get; init; } = "glove";
    public required string Mode { get; init; }
    public int? Quality { get; init; }
    public int? MaxWidth { get; init; }
    public bool? SmartSubsample { get; init; }
    public int? AlphaQuality { get; init; }
    public bool? Decimate { get; init; }
    public double? GrainBoost { get; init; }
    public bool? MaskKernel { get; init; }
    public bool? Greyscale { get; init; }
    public bool? GreyGuard { get; init; }
    public GloveNoiseGuard? NoiseGuard { get; init; }
    public bool? FlatPlaneGuard { get; init; }
    public GloveLossyGuard? LossyGuard { get; init; }
    public GloveTextureTier? GuardFallback { get; init; }
    public GloveAlphaGuard? AlphaGuard { get; init; }
    public bool? FlattenGuard { get; init; }
    public GloveSizeBudget? SizeBudget { get; init; }
    public GloveMaskBudget? MaskBudget { get; init; }
}

public static class GloveTextureOptimization
{
    // ---------------------------------------------------------------------------------------------
    // SCOPE
    // ---------------------------------------------------------------------------------------------

    // Shaders whose every material is a glove material (see the SCOPE note above).
    public static readonly IReadOnlySet<string> GloveShaders = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        "csgo_customglove.vfx",
        "csgo_customglove_preview.vfx",
        "csgo_textile_layer.vfx"
    };

    // The shared character shader, admitted only under a glove arm model. Agents bind the same
    // parameters through it, and a tier written for a glove's channels has no claim on those.
    public const string CharacterShader = "csgo_character.vfx";

    public static readonly IReadOnlyList<string> GlovePathSegments = ["/models/shared/arms/"];

    // ---------------------------------------------------------------------------------------------
    // TIERS. Each records what the property's channels hold, which weapon tier it is ported from and
    // why that port is the right one. >>> TUNE HERE <<<
    // ---------------------------------------------------------------------------------------------

    private const int Cap = 2048;
    private const int Half = 1024;
    private const int MB = 1024 * 1024;

    // No glove texture may ship above this. See THE CEILING above.
    private static readonly int Ceiling = (int)Math.Round(1.5 * MB);

    // TANGENT-SPACE NORMALS -- g_tNormal and the per-layer g_tDetailNormal* / g_tDamageNormal*. What
    // separates these from the layer normals further down is the PACKING, which
    // MaterialTextureProperties.cs records per parameter:
    //     g_tNormal                    BC5 HemiOct(RG) on the glove shaders; BC7 RG=normal +
    //                                  isoRough(B) on csgo_character.vfx, where VRF's decode moves
    //                                  that B into ALPHA
    //     g_tDetailNormal* / g_tDamageNormal*   BC5 HemiOct(RG), 2-channel, alpha unused (0..0)
    // So RGB is a direction field, which is the weapon NormalTier's content exactly, and this is that
    // tier: lossy q80, capped, alpha never stripped.
    //
    // ALPHA IS ROUGHNESS, NOT A MASK, on the character-shader variant, and that is what sets the
    // budget's floor. The two base gloves are the only files whose alpha is big enough to matter and
    // the only ones the budget ever reaches (scripts/probe-glove-normal-alpha.ts, at q80):
    //     glove_hardknuckle_normal (Default CT Gloves)  a100 2959K  a80 2533K  a60 1420K  a40 1267K
    //     glove_fingerless_normal (Default T Gloves)    a100 1702K  a60  701K  a40  600K
    // An RGB-only ladder cannot reach the ceiling on either -- alpha is most of the file -- so alpha
    // joins the walk, but it stops at 60 rather than the 40 a coverage mask would take: a60 is the
    // operating point the weapon OverlayTier measured at 33-36 dB / max err 8-15, the same error the
    // weapon PaintRoughnessTier already ships on a roughness plane, and a40 doubles it.
    private static readonly GloveTextureTier NormalTier = new()
    {
        Mode = GloveEncodeMode.Lossy,
        Quality = 80,
        MaxWidth = Cap,
        AlphaQuality = 100, // libwebp's own default, stated so the budget has a rung to start from
        SizeBudget = new(Ceiling, MinQuality: 64, MinAlphaQuality: 60)
    };

    // Where an albedo/detail fidelity-gate REJECTION goes, instead of lossless. Ported from the weapon
    // OverlayFloorTier: that tier's sweep showed a rejection is usually measuring NOISE rather than
    // structure the encoder failed to represent, so the remedy is to spend MORE bits exactly where the
    // gate said the encode fell short (+10 quality and 4:4:4) rather than pay lossless prices to store
    // grain.
    private static readonly GloveTextureTier GrainFloorTier = new()
    {
        Mode = GloveEncodeMode.Lossy,
        Quality = 90,
        AlphaQuality = 60,
        SmartSubsample = true,
        MaxWidth = Cap,
        SizeBudget = new(Ceiling, MinQuality: 64, MinAlphaQuality: 20)
    };

    // ALBEDO -- g_tColor (the base glove's baked colour) and the layered g_tSubstrate* / g_tSurface*
    // fabric colours. Ported from the weapon ColorTier (lossy q80 behind a 30 dB fidelity gate): RGB
    // is a picture, which is what that tier was written for.
    //
    // THE ALPHA PLANE IS A TINT MASK ("RGB=substrate albedo (sRGB), A=tint mask"), not the wear
    // coverage ramp the weapon tier compresses unconditionally. A tint mask SELECTS which tint a texel
    // takes, so a hard-edged one must not be smeared -- which is the split the weapon g_tPattern
    // alphaGuard already measures. So alpha goes through that gate instead: a soft ramp takes a60, a
    // hard/binary mask stays lossless. The budget's alpha rung inherits that protection for free,
    // because the walk starts from the tier's own AlphaQuality and a hard mask never has one.
    //
    // ON THIS PROPERTY THE MASK CAN BE THE WHOLE FILE, which is why the alpha rung has to exist at
    // all: silk_damaged_color (Driver Gloves | Wave Chaser, 4096) is 2530K at q90 of which the RGB is
    // 376K, so grinding quality alone stalls at 2319K, while the alpha rungs land it at 1532K.
    // FlattenGuard comes from the weapon OverlayTier for the other end of the same population:
    // leather_embroidered_color's alpha spans 254..255, a weight no blend can show.
    private static readonly GloveTextureTier AlbedoTier = new()
    {
        Mode = GloveEncodeMode.Lossy,
        Quality = 80,
        MaxWidth = Cap,
        LossyGuard = new(30),
        GuardFallback = GrainFloorTier,
        AlphaGuard = new(0.5, 60),
        FlattenGuard = true,
        SizeBudget = new(Ceiling, MinQuality: 64, MinAlphaQuality: 40)
    };

    // LAYERED DETAIL / DIRT -- g_tDetail*, g_tGrunge*, g_tGrime*. Every one is a small tiling swatch
    // (512 native, 34 of 34 in g_tDetail1) whose job is to break up the surface under it, and the
    // survey says it is a NOISE field rather than a picture: leather01_detail measures lag1 0.17 with
    // cross-channel correlation 0.00, fur01_detail 0.09/0.00 -- independent planes of grain. That is
    // the weapon GrungeTier's population, so its 4:4:4 comes along (a chroma subsampler averages
    // across planes that must stay independent) and so does alpha at 60, the value the weapon
    // g_tPattern alpha gate ships on soft masks.
    //
    // The quality stays at the albedo q80 rather than dropping to the weapon grunge's q70 because
    // these are 512 sources the cap never touches: resolution, which pays for most of the win
    // elsewhere in this file, is not available here at all.
    private static readonly GloveTextureTier DetailTier = new()
    {
        Mode = GloveEncodeMode.Lossy,
        Quality = 80,
        MaxWidth = Cap,
        AlphaQuality = 60,
        SmartSubsample = true,
        LossyGuard = new(30),
        GuardFallback = GrainFloorTier,
        SizeBudget = new(Ceiling, MinQuality: 64, MinAlphaQuality: 20)
    };

    // SCALAR HEIGHT -- g_tDamage1-4, "BC4 R. Per-material damage height (stored inverted)", the field
    // the shader bevels and thresholds. Ported from the weapon WearTier, and the port is exact rather
    // than analogous: abrasion_damage_height measures max|R-G| = max|B-G| = 0 with a constant-255
    // alpha, which is the fact GreyGuard re-verifies per file. q90 is WearTier's number, chosen there
    // because a thresholded field moves its boundaries when it is smoothed.
    private static readonly GloveTextureTier HeightTier = new()
    {
        Mode = GloveEncodeMode.Lossy,
        Quality = 90,
        GreyGuard = true,
        MaxWidth = Cap,
        LossyGuard = new(30),
        SizeBudget = new(Ceiling, MinQuality: 78)
    };

    // GREY AO -- g_tAmbientOcclusion on the base glove materials, "BC4 R: plain AO". R=G=B with a
    // constant-255 alpha on both real files (glove_hardknuckle_ao 221 distinct, glove_fingerless_ao
    // 256), the same single-plane shape as the height maps. Ported from the weapon PaintRoughnessTier,
    // the tier written for exactly this -- a continuous scalar field in one plane at q90 behind a gate
    // -- on a population 13x larger than this one.
    private static readonly GloveTextureTier AoTier = new()
    {
        Mode = GloveEncodeMode.Lossy,
        Quality = 90,
        GreyGuard = true,
        MaxWidth = Cap,
        LossyGuard = new(30),
        SizeBudget = new(Ceiling, MinQuality: 84)
    };

    // Where a packed texture with a FLAT plane goes, and where a packed gate rejection goes: bounded
    // quantization under a lossless encode, with no DCT involved at all. Ported from the weapon
    // MetalnessFloorTier / PaintByNumberTier pair, MaskKernel included -- area averaging is what keeps
    // a resize from overshooting at a material edge the way Lanczos does, and (unlike any lossy path)
    // it cannot take a value outside the range its source texels had, so a flat plane stays flat.
    //
    // THE LADDER ENDS IN A RESIZE, which is this file's one mechanism the weapon ladders do not have.
    // Exactly one glove texture spends past posterize/16 -- silk_damaged_ao (Driver Gloves | Wave
    // Chaser), a 4096 textile swatch whose planes are R 148..255, G 116..118, B 0..1, A 54..72 -- and
    // on it the candidates say plainly that resolution is the cheap error (scripts/probe-glove-silk.ts,
    // all at the 2048 cap):
    //     lossless          4881K   exact
    //     posterize/32      2643K   +-16 on the AO plane, and STILL over the ceiling
    //     lossy q90 4:4:4   1914K   over the ceiling too, and G drifts 116..118 -> 89..138 (max err 27)
    //     1024 lossless     1171K   exact values, every plane still inside its source range
    // The lossy row is why the texture is on this path at all: a 2-count roughness plane becoming a
    // 49-count one is a uniform gloss change across a whole fabric layer. And a textile swatch is the
    // content where halving costs least -- it TILES across the glove, and every other swatch in the
    // same material is authored at 512-1024, so 4096 is the outlier rather than the detail the look
    // needs. The rung is tried only after quantization has failed, so nothing that fits is resized.
    private static readonly GloveTextureTier PackedFloorTier = new()
    {
        Mode = GloveEncodeMode.Lossless,
        Quality = 100,
        MaxWidth = Cap,
        MaskKernel = true,
        MaskBudget = new(Ceiling, [80, 70, 60], [4, 8, 12, 16], [Half])
    };

    // PACKED DATA PLANES -- every glove texture whose channels are several INDEPENDENT scalars rather
    // than a picture. Two groups, both read off MaterialTextureProperties.cs:
    //   g_tSurface (on a glove this is packed surface properties, NOT the weapon's object-space
    //   normal), g_tObjectProperties (R=AO, G=curvature, B=high-touch wear mask), g_t*Properties1-4
    //   (R=AO, G=metalness, B=cloth mask, A=height) and g_tPatternProperties (R=metalness,
    //   G=roughness).
    //   g_tSubstrateNormal1-4 / g_tSurfaceNormal1-4 -- the compat glove layer maps, which are BC7
    //   HemiOctAniso(RGBA): "normal in (G,A), aniso roughness in (R,B)", exported RAW precisely
    //   because those four channels are independent (GameFiles/TextureCodecPolicy.cs). They are NOT
    //   tangent-space normal maps in the weapon sense and must not take that tier: their ALPHA is half
    //   the normal vector, so no budget may ever trade it, and their (R,B) roughness pair is
    //   chroma-carried, so the subsampler has to be kept away from it.
    // Both groups therefore take the weapon MetalnessTier, which is the tier for exactly this: lossy
    // q90, 4:4:4, area kernel, a 30 dB gate and a bounded floor underneath it, with alpha left at
    // libwebp's lossless default throughout.
    //
    // THE SET HOLDS TWO POPULATIONS AND FlatPlaneGuard SPLITS THEM (scripts/probe-glove-channels.ts):
    //     glove_specialist_01_ao (g_tSurface, 4096)       R/G/B/A all live, 222-256 distinct, lag1 0.99
    //     glove_specialist_quilted_ao (g_tObjectProps)    R 230  G 256  B 233 distinct
    //     silk_damaged_ao (g_tSubstrateProperties1)       R 108 distinct, G 3, B 2
    //     leather_embroidered_ao (g_tSurfaceProperties1)  R 209 distinct, G 3, B 3
    //     silk_damaged_normal (g_tSubstrateNormal3)       R 6, G 83, B 6, A 88 -- the aniso pair is
    //                                                     flat and the normal is live
    // The first two are what MetalnessTier was measured on: several live planes of smooth gradient,
    // where a DCT beats scalar quantization on both bytes and banding. The rest carry a CONSTANT plane
    // beside a live one, and the weapon measurements recorded that a lossy encode cannot hold a
    // constant plane still (up to 96 counts of drift on the weapon g_tMetalness B plane). On a glove
    // that drift is a uniform gloss shift across a fabric layer, or anisotropy invented on a surface
    // that had none. So any file with a flat plane takes the bounded path instead -- exactly as
    // SfxGuard routes its weapon counterpart -- and the posterize ladder there skips the flat planes
    // outright, leaving them bit-exact.
    //
    // THE SIZE BUDGET ENDS IN A RESIZE for the same reason PackedFloorTier's does, and the ordering
    // matters: quality first, resolution only once quality has run out. The body maps (g_tSurface) are
    // unique-UV and reach the ceiling on the quality ladder alone, so they are never resized, while a
    // layer map whose alpha is half its normal has nothing else left to spend. leather_embroidered_
    // normal (Driver Gloves | Garden) is the one file that reaches the rung: 2553K at q90 of which
    // 1300K is the alpha plane, 1735K at the q70 floor, 503K at 1024 q90 (scripts/probe-glove-ceiling.ts).
    private static readonly GloveTextureTier PackedTier = new()
    {
        Mode = GloveEncodeMode.Lossy,
        Quality = 90,
        MaxWidth = Cap,
        SmartSubsample = true, // independent planes: never let the chroma subsampler near them
        MaskKernel = true,
        FlatPlaneGuard = true,
        FlattenGuard = true,
        LossyGuard = new(30),
        GuardFallback = PackedFloorTier,
        SizeBudget = new(Ceiling, MinQuality: 70, MinAlphaQuality: null, Widths: [Half]),
        // Reached only by a file the guards sent to the bounded floor that is still over the ceiling,
        // which is where the quantizer is the right answer: no DCT is involved on that path at all.
        MaskBudget = new(Ceiling, [80, 70, 60], [4, 8, 12, 16], [Half])
    };

    // GRAIN patterns, ported verbatim from the weapon PatternNoiseTier (decimate + grain boost + q50
    // 4:4:4 a60). Reached only through PatternTier's NoiseGuard.
    private static readonly GloveTextureTier PatternNoiseTier = new()
    {
        Mode = GloveEncodeMode.Lossy,
        Quality = 50,
        MaxWidth = Cap,
        SmartSubsample = true,
        AlphaQuality = 60,
        Decimate = true,
        GrainBoost = 1.5
    };

    // Where a g_tPattern gate rejection goes. Ported verbatim from the weapon PatternFloorTier.
    private static readonly GloveTextureTier PatternFloorTier = new()
    {
        Mode = GloveEncodeMode.Lossy,
        Quality = 75,
        MaxWidth = Cap,
        SmartSubsample = true,
        SizeBudget = new(Ceiling, MinQuality: 64)
    };

    // PAINT PATTERN -- g_tPattern, the glove's paint-kit artwork over the composite: "BC7 RGBA, or
    // RGB=color(sRGB)+A=translucency". Same property name, same channel meaning and the same three
    // populations as the weapon one, so the weapon PatternTier is ported whole -- artwork at q90, the
    // noise guard splitting grain off to PatternNoiseTier, the fidelity gate routing region-weight
    // masks to PatternFloorTier, and the alpha gate compressing only masks that are actually soft. The
    // glove set's heaviest pattern (oiled_psd, 2048, alpha 254..255) is artwork by both measures
    // (lag1 0.98).
    private static readonly GloveTextureTier PatternTier = new()
    {
        Mode = GloveEncodeMode.Lossy,
        Quality = 90,
        MaxWidth = Cap,
        LossyGuard = new(30),
        NoiseGuard = new(0.5, PatternNoiseTier),
        GuardFallback = PatternFloorTier,
        AlphaGuard = new(0.5, 60),
        SizeBudget = new(Ceiling, MinQuality: 64)
    };

    // LAYER WEIGHTS -- g_tLayerMask, "BC7 RGBA. Per-layer blend masks", the plane-per-layer mask
    // deciding which of the four material layers shows where. Four independent weight fields
    // (glove_brokenfang_2_mask measures 234/14/21/199 distinct across R/G/B/A), i.e. the weapon
    // PaintByNumberTier's content, so it takes that tier: lossless with an area kernel, and a
    // posterize ladder that only fires if a mask is ever over the ceiling. None is today -- the whole
    // property is 0.7 MB -- so this is a capped, bit-exact re-encode.
    private static readonly GloveTextureTier LayerMaskTier = new()
    {
        Mode = GloveEncodeMode.Lossless,
        Quality = 100,
        MaxWidth = Cap,
        MaskKernel = true,
        FlattenGuard = true,
        MaskBudget = new(Ceiling, [75, 70, 65], [8, 12, 16, 20])
    };

    // >>> TUNE HERE <<< property name -> encode tier. A property absent from this table is never
    // touched: its textures take the default lossless path, byte-identical to an untiered texture.
    // Four groups are absent on purpose:
    //   g_tLayerId, g_tTintId   INDEX maps ("object material-id map", "object tint-region id"): each
    //                           texel NAMES a layer or a tint slot, so both the resample and the
    //                           encode would have to be exact-or-nothing -- and there is nothing to
    //                           win, at 49K and 23K for the largest of each.
    //   g_tMetalness            16x16 constants on the base glove materials, 0K each.
    //   g_tNoise, g_tSssMask,   one small file each (131K / 66K / 22K / 0K), none above the ceiling.
    //   g_tDiffuseFalloff,      g_tDiffuseFalloff is also a LUT (a skin-lighting ramp), which is the
    //   g_tBloodMask            one content class where a DCT has no business at any size.
    public static readonly IReadOnlyDictionary<string, GloveTextureTier> Targets = BuildTargets();

    private static Dictionary<string, GloveTextureTier> BuildTargets()
    {
        var targets = new Dictionary<string, GloveTextureTier>(StringComparer.Ordinal)
        {
            ["g_tSurface"] = PackedTier,
            ["g_tObjectProperties"] = PackedTier,
            ["g_tPatternProperties"] = PackedTier,
            ["g_tNormal"] = NormalTier,
            ["g_tColor"] = AlbedoTier,
            ["g_tAmbientOcclusion"] = AoTier,
            ["g_tPattern"] = PatternTier,
            ["g_tLayerMask"] = LayerMaskTier
        };
        // The four material LAYERS a glove composites share one meaning per family, so a texture bound
        // as g_tSubstrate1 on one glove and g_tSubstrate3 on another takes the same tier either way.
        void Layered(string family, GloveTextureTier tier)
        {
            for (var layer = 1; layer <= 4; layer++) targets[$"{family}{layer}"] = tier;
        }
        Layered("g_tSurfaceProperties", PackedTier);
        Layered("g_tSubstrateProperties", PackedTier);
        Layered("g_tSurfaceNormal", PackedTier);
        Layered("g_tSubstrateNormal", PackedTier);
        Layered("g_tDetailNormal", NormalTier);
        Layered("g_tDamageNormal", NormalTier);
        Layered("g_tSurface", AlbedoTier);
        Layered("g_tSubstrate", AlbedoTier);
        Layered("g_tDetail", DetailTier);
        Layered("g_tGrunge", DetailTier);
        Layered("g_tGrime", DetailTier);
        Layered("g_tDamage", HeightTier);
        return targets;
    }

    // ---------------------------------------------------------------------------------------------
    // CLASSIFIER
    // ---------------------------------------------------------------------------------------------

    // Walks every material's parsed data and returns `resolved .vtex path -> tier` for the glove
    // textures that qualify. A texture qualifies only if EVERY binding of it, across the whole build,
    // is a glove material binding it to a target property -- one foreign binding (a weapon's
    // g_tPattern, an agent's g_tNormal) or one binding to a non-target parameter (a glove's own
    // g_tLayerId) disqualifies it, because the tiers here are written against the glove meaning of
    // those channels and a shared texture has no single meaning. A texture bound to two target
    // properties that want DIFFERENT tiers is dropped for the same reason.
    //
    // `materialData` is keyed by resource path because the scope rule needs it: the character shader
    // is admitted only under a glove arm model. `resolveTexturePath` maps a raw `.vtex` reference to
    // the same resolved key the encode loop uses (null when it cannot be resolved). Material data
    // nodes are the plain object graph the metadata extractor produces: nested
    // Dictionary<string, object?> / List<object?> / string.
    public static Dictionary<string, GloveTextureTier> ResolveTextureTiers(
        IEnumerable<KeyValuePair<string, object?>> materialData,
        Func<string, string?> resolveTexturePath)
    {
        var targetProperty = new Dictionary<string, string>(StringComparer.Ordinal);
        var foreign = new HashSet<string>(StringComparer.Ordinal);

        foreach (var (path, data) in materialData)
            Walk(data, contextName: null, IsGloveMaterial(path, data), targetProperty, foreign, resolveTexturePath);

        foreach (var path in foreign)
            targetProperty.Remove(path);

        var tiers = new Dictionary<string, GloveTextureTier>(StringComparer.Ordinal);
        foreach (var (path, property) in targetProperty)
            tiers[path] = Targets[property];
        return tiers;
    }

    private static bool IsGloveMaterial(string materialPath, object? data)
    {
        if (data is not Dictionary<string, object?> dict) return false;
        if (!dict.TryGetValue("m_shaderName", out var shader) || shader is not string name) return false;
        if (GloveShaders.Contains(name)) return true;
        if (!string.Equals(name, CharacterShader, StringComparison.OrdinalIgnoreCase)) return false;
        var path = $"/{MaterialPaths.NormalizeMaterialResourcePath(materialPath).TrimStart('/')}";
        foreach (var segment in GlovePathSegments)
            if (path.Contains(segment, StringComparison.OrdinalIgnoreCase)) return true;
        return false;
    }

    private static void Walk(
        object? value,
        string? contextName,
        bool gloveFamily,
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
                if (gloveFamily && contextName != null && Targets.TryGetValue(contextName, out var tier))
                {
                    // Two bindings that want DIFFERENT tiers have no single answer, so the texture is
                    // dropped exactly like a foreign one.
                    if (targetProperty.TryGetValue(resolved, out var seen))
                    {
                        if (!ReferenceEquals(Targets[seen], tier)) foreign.Add(resolved);
                    }
                    else
                    {
                        targetProperty[resolved] = contextName;
                    }
                }
                else
                {
                    foreign.Add(resolved);
                }
                return;

            case List<object?> list:
                foreach (var entry in list)
                    Walk(entry, contextName, gloveFamily, targetProperty, foreign, resolveTexturePath);
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
                    Walk(child, name ?? key, gloveFamily, targetProperty, foreign, resolveTexturePath);
                return;
        }
    }

    private static bool IsTextureReference(string value) =>
        MaterialPaths.NormalizeMaterialResourcePath(value).EndsWith(".vtex", StringComparison.OrdinalIgnoreCase);
}
