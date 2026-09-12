/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

namespace ItemGenerator;

// Per-property WebP encode tiers for KEYCHAIN (charm) textures, the fourth tuning surface beside
// StickerTextureOptimization, WeaponTextureOptimization and GloveTextureOptimization. Every texture
// in the pipeline is lossless by default (see item-generator-webp.ts); these four files are the only
// places that opt a texture into a smaller encoding. Edit Targets, rebuild, done.
//
// THE SPLIT OF RESPONSIBILITY is the weapon file's: this file owns POLICY (which property gets which
// tier, with which thresholds and budgets), scripts/item-generator-webp.ts owns MEASUREMENT (every
// "guard" named below is a TEXTURE-DRIVEN classifier it evaluates against the pristine decompiled
// PNG). Nothing here keys on a filename, a charm, or a resolution an artist happened to choose.
//
// WHY THIS FILE EXISTS RATHER THAN A LINE IN WeaponTextureOptimization. A charm rides on
// csgo_weapon.vfx and its channels really are the weapon ones, so every tier below is a weapon tier
// (two are sticker tiers) applied to the keychain property whose channels mean the same thing --
// dropping "/keychains/" from WeaponTextureOptimization.ExcludedPathSegments was measured first and
// would have added 291 textures while removing none, because keychains share no texture with a
// weapon. What is NOT shared is the POPULATION, and two weapon tiers are tuned to facts this set
// inverts:
//   g_tMetalness        the weapon tier records "B is CONSTANT in 98 of 98 files ... no weapon in the
//                       set carries SFX data", which is what lets it put the whole property on a DCT
//                       and guard only B. Here 64 of 78 real-size maps carry a constant plane and it
//                       is R, G or B depending on the file, so the guard has to be the glove file's
//                       FlatPlaneGuard, which names no plane.
//   g_tAmbientOcclusion the weapon tier is DownscaleOnly with MinWidth 2049, i.e. "4K sources only".
//                       Every keychain AO map is 1024 or 512, so that tier is a total no-op on this
//                       set and the scalar-field tier is the one that fits the data.
// Riding on the weapon file would therefore have meant editing tiers 2801 shipped weapon textures
// depend on, to serve 361. Hence the split.
//
// HOW THE TIERS WERE DERIVED. Out of band with scripts/tool-reencode-keychains.ts -- which re-encodes
// the same textures in place under scripts/workdir/output so a candidate tier can be eyeballed in
// ../cs2-3d-viewer without a full generator run -- plus the scripts/probe-keychain-*.ts measurement
// harnesses each tier comment cites. Against the production build the set falls from 93.7 MB to
// 29.5 MB (137.2 MB fully lossless) with no file over 1.5 MB, the largest being 977K.
//
// THE CEILING. Every budget here aims at the same 1.5 MB per-texture ceiling the glove file uses. A
// charm is a thumb-sized object clipped to a weapon, so the ceiling is generous rather than tight;
// what makes it the operative lever is that RESOLUTION is not one. The 2048 cap below is a
// deliberate no-op: 338 of the 361 textures are natively 1024 or 512, nine are exactly 2048, and the
// rest are 1x1/16x16 constants. Nothing in the set is above the cap, so every budget spends quality.
//
// SCOPE. A keychain texture qualifies only when EVERY binding of it, anywhere in the build, is a
// keychain material binding it to a target property -- the rule the weapon and glove files use.
// Identifying a keychain material is the one thing this file does differently, and deliberately:
//   csgo_weapon.vfx        the weapon body shader. A charm is a weapon model hanging off a weapon, so
//                          the shader name alone admits 613 textures, 252 of them real weapon body
//                          maps (measured, scripts/probe-keychain-classifier.ts). It cannot be the rule.
//   csgo_simple_liquid.vfx the shader behind the two liquid-filled charms (Charm | Butane Buddy).
//                          Only two materials in the build use it and both are charms, but it is
//                          admitted under the same path rule rather than on that coincidence.
// The discriminator is KeychainPathSegments, applied to the ASSET TREE A MATERIAL DRAWS FROM: a
// material is a keychain material when it is on one of those shaders AND at least one texture it
// binds resolves under "/keychains/". That segment is the same one WeaponTextureOptimization already
// excludes on, so the two scopes partition rather than overlap, and it is the form of the rule that
// could be VERIFIED: the decompiled workspace mirrors texture resource paths, so every keychain
// texture's tree is checkable, and the check says 353 of the 361 live under it while ZERO textures
// under it are bound by a material outside the charm set (scripts/probe-keychain-scope.ts). Keying
// on the material's own path would have been the tidier rule and is what the glove file does, but no
// .vmat path survives into the workspace to verify it against, and this file's rule is that nothing
// ships on an assumption.
//
// WHAT THE RULE COSTS, measured against the out-of-band tool's own scope (which walks every charm
// item's model instead, and is what the viewer was validated on): 361 of its 362 textures, with no
// additions. The one drop is the display case's shared sticker holo mask
// (stickers/chicken_capsule/bonehead_holomask), bound by a csgo_weapon_sticker.vfx material that
// binds no keychain texture of its own -- a sticker asset, which the sticker path is welcome to.
//
// THE EIGHT TEXTURES THAT QUALIFY FROM OUTSIDE "/keychains/" are pulled in by the material rule, as
// intended: three 512 glitter normals under models/inventory_items/pins_series_3 that the glitter
// charms borrow, and five shared engine defaults (1x1 and 16x16 constants). Two of the five --
// default_rough and stickers/default_rough, both bound as g_tMetalness -- are ALSO claimed by
// WeaponTextureOptimization today, since a keychain material is a csgo_weapon.vfx material and
// g_tMetalness is a weapon target too. AssetProcessor resolves weapon tiers first, so those two keep
// the encoding they already ship with; both are constants that encode to 0 K either way.

// The encode modes, as the wire format spells them -- a plain const rather than an enum for the
// reason WeaponEncodeMode documents: the tier record below IS the descriptor the encoder receives.
public static class KeychainEncodeMode
{
    public const string Lossless = "lossless";
    public const string Lossy = "lossy";
}

// Below `MinPsnr` dB (lossy reconstruction vs the pristine PNG, measured at NATIVE resolution) the
// texture's values feed a lookup rather than an eye, and it takes GuardFallback.
public sealed record KeychainLossyGuard(double MinPsnr);

// Compress the ALPHA plane at `AlphaQuality`, but only when at least `MinSoft` of it is soft (neither
// 0 nor 255). A hard binary mask is left lossless.
public sealed record KeychainAlphaGuard(double MinSoft, int AlphaQuality);

// Step quality down by 6 until the encode fits `MaxBytes`, stopping at `MinQuality`. `MinAlphaQuality`
// opts the alpha plane into the same walk, for a property where the mask IS the bytes.
public sealed record KeychainSizeBudget(int MaxBytes, int MinQuality, int? MinAlphaQuality = null);

// The mask-tier counterpart: a REPLICATED mask (R==G==B) walks `Qualities` lossy, an independent-plane
// one walks `Steps` as posterize bucket widths under a lossless encode. Only fires when over `MaxBytes`.
public sealed record KeychainMaskBudget(int MaxBytes, int[] Qualities, int[] Steps);

// One encode tier, and the exact descriptor item-generator-webp.ts receives (camelCase, nulls
// omitted). Field semantics are documented once, on the EncodeSpec interface there, so the mechanism
// and its documentation cannot drift apart. The knobs the weapon and glove files carry that no
// keychain tier uses are deliberately absent: StripAlpha, NearLossless, MinWidth, Posterize,
// FlattenAlpha, Greyscale, SfxGuard, MaskGuard, NoiseGuard (with Decimate/GrainBoost) and the
// budgets' Widths rung. The grain path is the notable one -- it exists for stipple/spray camo, and
// the lowest lag-1 autocorrelation in this whole set is 0.61 against the 0.5 its guard trips at, so
// it could only ever have been dead code here.
public sealed record KeychainTextureTier
{
    public string Kind { get; init; } = "keychain";
    public required string Mode { get; init; }
    public int? Quality { get; init; }
    public int? MaxWidth { get; init; }
    public bool? SmartSubsample { get; init; }
    public int? AlphaQuality { get; init; }
    public bool? MaskKernel { get; init; }
    public bool? GreyGuard { get; init; }
    public bool? FlatPlaneGuard { get; init; }
    public KeychainLossyGuard? LossyGuard { get; init; }
    public KeychainTextureTier? GuardFallback { get; init; }
    public KeychainAlphaGuard? AlphaGuard { get; init; }
    public bool? FlattenGuard { get; init; }
    public KeychainSizeBudget? SizeBudget { get; init; }
    public KeychainMaskBudget? MaskBudget { get; init; }
}

public static class KeychainTextureOptimization
{
    // ---------------------------------------------------------------------------------------------
    // SCOPE
    // ---------------------------------------------------------------------------------------------

    // The shaders a charm material can be on. Neither is keychain-exclusive on its own, which is why
    // KeychainPathSegments does the real work -- see the SCOPE note above.
    public static readonly IReadOnlySet<string> KeychainShaders = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        "csgo_weapon.vfx",
        "csgo_simple_liquid.vfx"
    };

    // The keychain asset tree, as it appears in a resolved TEXTURE resource path (weapons/keychains/*
    // and workshop/keychains/*). Same segment WeaponTextureOptimization.ExcludedPathSegments drops on.
    public static readonly IReadOnlyList<string> KeychainPathSegments = ["/keychains/"];

    // ---------------------------------------------------------------------------------------------
    // TIERS. Each records what the property's channels hold (from the per-parameter annotations in
    // MaterialTextureProperties.cs, verified per file by scripts/probe-keychain-props.ts), which
    // weapon or sticker tier it is ported from, and why that port is the right one. >>> TUNE HERE <<<
    // ---------------------------------------------------------------------------------------------

    private const int Cap = 2048;

    private const int KB = 1024;
    private const int MB = 1024 * 1024;

    // No keychain texture may ship above this. See THE CEILING above.
    private static readonly int Ceiling = (int)Math.Round(1.5 * MB);

    // The BOUNDED path's own ceiling, lower than Ceiling on purpose and set the way the weapon
    // SurfaceTier sets its own: at PRODUCTION'S CURRENT CEILING FOR THE PROPERTY (466K for keychain
    // g_tMetalness). A file already under it stays BIT-EXACT and only the tail pays. Priced across the
    // property (scripts/probe-keychain-packed.ts, 78 real-size maps): lossless 18.7 MB, post/4 11.6,
    // post/8 8.6, post/12 6.9, post/16 5.9, post/24 4.7, post/32 3.7 -- so this budget fires on 10 of
    // 78 and none of them spends past post/12 (+-6).
    private const int PackedCeiling = 466 * KB;

    // Where an albedo/detail fidelity-gate REJECTION goes, instead of lossless. Ported from the weapon
    // OverlayFloorTier: that tier's sweep showed a rejection is usually measuring NOISE rather than
    // structure the encoder failed to represent, so the remedy is to spend MORE bits in exactly the
    // place the gate said the encode fell short (+10 quality and 4:4:4) rather than pay lossless
    // prices to store grain.
    private static readonly KeychainTextureTier GrainFloorTier = new()
    {
        Mode = KeychainEncodeMode.Lossy,
        Quality = 90,
        AlphaQuality = 60,
        SmartSubsample = true,
        MaxWidth = Cap,
        SizeBudget = new(Ceiling, MinQuality: 64, MinAlphaQuality: 20)
    };

    // NORMALS -- g_tNormal, the glitter normals (g_tGlitterNormal, g_tGlitterNormalSticker*) and the
    // liquid charms' g_tNormalA. Ported from the weapon NormalTier (lossy q80, capped, alpha never
    // stripped) with the glove file's budget on top.
    //
    // THE PORT IS EXACT RATHER THAN ANALOGOUS FOR g_tNormal, and the measurement says so: across all
    // 69 files the planes run R~253 G~253 B127 with ALPHA CONSTANT -- 0 on 66 of them and 255 on 3 --
    // which is the weapon tier's stated fact ("every weapon normal's alpha is flat and unused, but it
    // is KEPT so the shader's .a sample stays 0.0 rather than 1.0"). That shape is what a BC5
    // HemiOct(RG) normal decodes to: VRF rebuilds the unit vector into RGB (hence B spanning 128..255)
    // and there is no fourth channel to carry. Nothing here flattens or strips alpha, and a constant
    // plane is 0% soft, so no alpha gate could fire on one either.
    //
    // g_tNormalA IS THE SAME CONTENT WITH A ROUGHNESS PLANE ATTACHED, and that is what sets the
    // budget's floor. MaterialTextureProperties.cs annotates it "BC7: RG=hemi-oct normal, +isoRough(B)",
    // and GameFiles/TextureCodecPolicy.cs records what the _RG_B decode then does: it "writes the
    // decoded unit vector into rgb and moves b into alpha". So the decompiled planes are RGB = unit
    // normal, A = ISOTROPIC ROUGHNESS -- measured R254 G254 B129 A247, exactly that -- and this file is
    // not one of the raw four-channel normals that policy exempts (it names the surviving set as the
    // compat glove layer maps, "no weapon, sticker or character shader binds any of them").
    //
    // AND THE ROUGHNESS PLANE IS 93% OF THAT FILE, which is why the budget walks alpha at all. Split by
    // RIFF chunk (scripts/probe-keychain-liquid.ts) at 2048:
    //     lossless            3948K   VP8 3948K   ALPH    0K
    //     q90 4:4:4           2526K   VP8  184K   ALPH 2342K
    //     q70 4:4:4           2421K   VP8   79K   ALPH 2342K   <- 20 points of quality buys 4%
    //     q90 4:4:4 a60       1093K   VP8  184K   ALPH  909K
    // An RGB-only ladder cannot reach the ceiling on it at any quality; alpha can, in one step. The
    // walk stops at a60, not the a40 a coverage mask would take, because this plane is roughness: a60
    // is the operating point the weapon OverlayTier measured at 33-36 dB / max err 8-15, the same error
    // the weapon PaintRoughnessTier already ships on a roughness plane, and a40 doubles it. Charm |
    // Butane Buddy is the one file that reaches the rung, landing at 977K on q64 a60.
    private static readonly KeychainTextureTier NormalTier = new()
    {
        Mode = KeychainEncodeMode.Lossy,
        Quality = 80,
        MaxWidth = Cap,
        AlphaQuality = 100, // libwebp's own default, stated so the budget has a rung to start from
        SizeBudget = new(Ceiling, MinQuality: 64, MinAlphaQuality: 60)
    };

    // ALBEDO -- g_tColor (the charm's base colour), g_tDetail ("BC7 RGB sRGB, detail albedo overlay")
    // and g_tColorA (the liquid layer: "RGB=color (sRGB), A=metalness"). Ported from the weapon
    // ColorTier -- lossy q80 behind a 30 dB fidelity gate, RGB being a picture, which is what that tier
    // was written for. Every one of the 82 g_tColor files measures lag-1 >= 0.61 with a median of 0.98,
    // i.e. artwork rather than a packed data field, so the gate is a backstop. It fires on two:
    // Charm | Titeenium AWP (27.7 dB) and Charm | Lil' Teacup's g_tDetail (27.9 dB).
    //
    // TWO THINGS THE WEAPON TIER DOES NOT DO, both because the ALPHA plane here is not its plane:
    //   1. THE ALPHA IS FAKE ON 78 OF 82. It spans exactly ONE count (254..255) and is stored at
    //      lossless grade only because the SHAPE of the 254 region is detailed -- the population the
    //      weapon OverlayTier's FlattenGuard was written for and measured on (Nova | Marsh Grass
    //      1366K -> 1101K with RGB bit-identical). ColorTier has no such guard because a weapon
    //      albedo's alpha is a real paint/wear coverage mask; a charm has no paint kit, so no mask.
    //      125 files flatten here, for 39.2 MB.
    //   2. ALPHA IS COMPRESSED ONLY WHEN IT IS SOFT (the weapon g_tPattern alphaGuard) rather than
    //      unconditionally at 60. g_tColorA's alpha is not a coverage mask at all but a METALNESS
    //      plane, and a hard-edged material selector must not be smeared; a soft one is a ramp with
    //      nothing to ring at, and takes the a60 the weapon tiers ship on soft masks. Exactly one file
    //      is soft enough to reach it (Charm | Lil' Cackle, 100%).
    // The size budget walks alpha only after the gate has fired, for the same reason: the mask is never
    // degraded to pay for the colour.
    private static readonly KeychainTextureTier AlbedoTier = new()
    {
        Mode = KeychainEncodeMode.Lossy,
        Quality = 80,
        MaxWidth = Cap,
        LossyGuard = new(30),
        GuardFallback = GrainFloorTier,
        AlphaGuard = new(0.5, 60),
        FlattenGuard = true,
        SizeBudget = new(Ceiling, MinQuality: 64, MinAlphaQuality: 40)
    };

    // SCALAR FIELDS IN ONE PLANE -- g_tAmbientOcclusion ("[weapon] BC4 R: plain AO"), g_tTintMask
    // ("BC4 R, tint-application mask") and g_tLiquidMask ("BC4 R (inverted), liquid coverage mask").
    // Ported from the weapon PaintRoughnessTier, the tier written for exactly this -- a continuous
    // scalar field in one plane at q90 behind a 30 dB gate -- on a population 3x larger than this one.
    //
    // ONE PLANE, NOT FOUR, IN 109 OF 109. Every AO map measures R = G = B with a constant-255 alpha (59
    // of 59), and so does every tint mask (49 of 49) and the one liquid mask. That is the weapon
    // g_tWear / g_tPaintRoughness fact holding again, and GreyGuard re-checks it per file, so a map
    // ever authored with real chroma or a real mask keeps all four planes and the tier degrades to
    // plain lossy.
    //
    // A TINT MASK IS A SELECTOR, which is the one thing to watch on this tier, and the measurement says
    // these are ramps rather than palettes: 256 distinct levels on all but a handful (the flattest is
    // 53) with lag-1 0.86-1.00. The 30 dB gate is what would catch a future one that really is a hard
    // region mask. Priced per file (scripts/probe-keychain-tintmask.ts), VP8L already encodes the two
    // duplicate planes and the constant alpha for nothing -- RGBA lossless and grey lossless come out
    // byte-for-byte equal on every mask -- so the grey collapse is worth 0 on its own and q90 only wins
    // on the 12 busiest: 12 of 49 ship lossy, 37 stay bit-exact lossless under the never-regress rule.
    // That is the property working as designed rather than a tier that failed; the whole thing is
    // 1.3 MB.
    private static readonly KeychainTextureTier ScalarTier = new()
    {
        Mode = KeychainEncodeMode.Lossy,
        Quality = 90,
        GreyGuard = true,
        MaxWidth = Cap,
        LossyGuard = new(30),
        SizeBudget = new(Ceiling, MinQuality: 84)
    };

    // Where a packed texture with a FLAT plane goes, and where a packed gate rejection goes: bounded
    // quantization under a lossless encode, with no DCT involved at all. Ported from the weapon
    // MetalnessFloorTier / SurfaceTier pair, MaskKernel included -- area averaging cannot take a value
    // outside the range its source texels had, so a flat plane stays flat through a resize the way it
    // cannot through Lanczos -- and including the posterize ladder's own rule that any plane under
    // POSTERIZE_SKIP_DISTINCT levels is skipped outright, which is what keeps the flat planes BIT-EXACT
    // while the live ones pay.
    private static readonly KeychainTextureTier PackedFloorTier = new()
    {
        Mode = KeychainEncodeMode.Lossless,
        Quality = 100,
        MaxWidth = Cap,
        MaskKernel = true,
        MaskBudget = new(PackedCeiling, [80, 70, 60], [4, 8, 12, 16, 24, 32])
    };

    // PACKED DATA PLANES -- g_tMetalness ("BC5 R=roughness(inverted), G=metalness; the BC7 variant adds
    // B=SFX mask"), g_tOpaqueRefractMask ("BC7 R") and g_tStickerWepInputs ("R=sticker mask,
    // G=sticker cavity"). Several INDEPENDENT scalars in one file rather than a picture, which is the
    // weapon MetalnessTier's content and therefore its tier: lossy q90, 4:4:4 (independent planes must
    // never meet a chroma subsampler), the area kernel, a 30 dB gate and a bounded floor underneath.
    //
    // WHAT IS NOT PORTED IS SfxGuard, AND THAT IS THE WHOLE REASON THIS FILE EXISTS. The weapon tier
    // guards the B plane specifically, on the recorded fact that "B is CONSTANT in 98 of 98 files ...
    // no weapon in the set carries SFX data", so a drifting B can only invent a mask that was not
    // there. Keychains break that fact in both directions (scripts/probe-keychain-props.ts, 78
    // real-size maps):
    //     kc_db_aztec_rough         R184 G255 B0     B constant -- a weapon-shaped file
    //     kc_db_flash_rough         R60  G1   B255   G constant, B LIVE -- a REAL SFX mask
    //     kc_db_clown_rough         R255 G0   B0     G and B both constant
    //     kc_wpn_m4a1s_comic_mask   R5   G255 B255   R constant, the roughness plane
    // 64 of 78 carry a constant plane and it is R, G or B depending on the file. So the guard is the
    // glove file's FlatPlaneGuard, which asks "is ANY plane constant" rather than naming one.
    //
    // WHAT THE DCT COSTS THOSE 64, measured at native resolution against the pristine PNG
    // (scripts/probe-keychain-metalness.ts): the constant plane drifts up to 128 counts under q90 4:4:4
    // -- 128 on kc_wpn_m4a1s_comic_mask's flat roughness plane, 93 on missinglink_metal's, 80 on
    // kc_db_occult_rough's constant SFX plane. On a charm that is a uniform gloss shift across the
    // whole object, or an SFX mask at half strength on an object that has none.
    //
    // AND IT IS NOT HYPOTHETICAL: PRODUCTION ALREADY DOES IT. Scored against the same sources,
    // production's own encode drifts the flat plane on 63 OF THE 64 files, by up to 144 counts with a
    // median of 36 (scripts/probe-keychain-prod-drift.ts). So this tier does not buy bytes back from
    // production on g_tMetalness -- it deliberately SPENDS them, ~13.6 MB against production's 7.3 MB
    // (avg 90K -> 165K per file), to stop inventing material data. That is the same trade the weapon
    // file's SfxGuard already makes, on a population where it actually fires. The 14 maps with no
    // constant plane take the DCT as the weapon set does.
    private static readonly KeychainTextureTier PackedTier = new()
    {
        Mode = KeychainEncodeMode.Lossy,
        Quality = 90,
        MaxWidth = Cap,
        SmartSubsample = true, // independent planes: never let the chroma subsampler near them
        MaskKernel = true,
        FlatPlaneGuard = true,
        FlattenGuard = true,
        LossyGuard = new(30),
        GuardFallback = PackedFloorTier,
        SizeBudget = new(Ceiling, MinQuality: 70),
        // Reached only by a file the guards sent to the bounded floor that is still over PackedCeiling,
        // which is where the quantizer is the right answer: no DCT is involved on that path at all.
        MaskBudget = new(PackedCeiling, [80, 70, 60], [4, 8, 12, 16, 24, 32])
    };

    // STICKER-SLOT ARTWORK -- g_tSticker0-4 on the display-case charm ("RGB=sticker color, A=wear
    // mask"). Ported verbatim from StickerTextureOptimization's g_tSticker0 tier (lossy q90), the same
    // property under the same shader family: the display case renders a sticker exactly as a weapon
    // does. Every instance in the build today is shared with the weapon sticker path and so is dropped
    // by the scope rule; the tier is here because the property is a keychain-reachable one and the next
    // display-case charm may well carry its own.
    private static readonly KeychainTextureTier StickerArtTier = new()
    {
        Mode = KeychainEncodeMode.Lossy,
        Quality = 90,
        MaxWidth = Cap
    };

    // STICKER-SLOT DATA -- g_tNormalRoughnessSticker0-4 ("RG=hemi-oct normal, +isoRough(B), A=self-illum
    // mask") and g_tSfxMaskSticker0-4 ("RGB=holo mask, A=glitter mask"). Ported verbatim from
    // StickerTextureOptimization, including its finding that these two are the sticker properties lossy
    // cannot have: "lossy (even q95) facets the normal on glossy/metallic stickers" and "RGB are three
    // independent masks + live alpha; lossy shifts the composite (bad even at q95)". The only lever is a
    // lossless downscale to 512, which keeps every value exact.
    //
    // THIS IS THE ONE PLACE THE 2048 CAP IS NOT THE CAP, and it is deliberate: 512 is the validated
    // operating point for these two properties, and a charm's sticker is rendered at a fraction of the
    // size a weapon's is. One texture in the build reaches it (Charm | Sticker Slab's
    // g_tNormalRoughnessSticker0, 1024 -> 512, 677K -> 167K). MaskKernel is this file's one addition to
    // the sticker tier: the sticker path resizes through Lanczos, and on planes that are masks a box
    // filter cannot overshoot at their hard edges the way Lanczos' negative lobes do.
    private static readonly KeychainTextureTier StickerDataTier = new()
    {
        Mode = KeychainEncodeMode.Lossless,
        Quality = 100,
        MaxWidth = 512,
        MaskKernel = true
    };

    // >>> TUNE HERE <<< property name -> encode tier. A property absent from this table is never
    // touched: its textures take the default lossless path, byte-identical to an untiered texture.
    // Two are absent on purpose:
    //   g_tHoloSpectrumSticker*  the sticker tier for it strips alpha and skips anything under 1024
    //                            wide; StripAlpha and MinWidth are knobs no other keychain tier needs,
    //                            and the one instance in the build is shared with the weapon sticker
    //                            path anyway, so the scope rule would drop it regardless.
    //   g_tStickerScratches      one texture, and it is the shared weapon scratch pattern -- dropped by
    //                            the scope rule before any tier could apply.
    public static readonly IReadOnlyDictionary<string, KeychainTextureTier> Targets = BuildTargets();

    private static Dictionary<string, KeychainTextureTier> BuildTargets()
    {
        var targets = new Dictionary<string, KeychainTextureTier>(StringComparer.Ordinal)
        {
            ["g_tColor"] = AlbedoTier,
            ["g_tColorA"] = AlbedoTier,
            ["g_tDetail"] = AlbedoTier,
            ["g_tNormal"] = NormalTier,
            ["g_tNormalA"] = NormalTier,
            ["g_tGlitterNormal"] = NormalTier,
            ["g_tMetalness"] = PackedTier,
            ["g_tOpaqueRefractMask"] = PackedTier,
            ["g_tStickerWepInputs"] = PackedTier,
            ["g_tAmbientOcclusion"] = ScalarTier,
            ["g_tTintMask"] = ScalarTier,
            ["g_tLiquidMask"] = ScalarTier
        };
        // The display case carries five sticker slots and the shader names each one, so a property is
        // registered per slot. They share one meaning per family, exactly as the glove layers do.
        void Slotted(string family, KeychainTextureTier tier)
        {
            for (var slot = 0; slot <= 4; slot++) targets[$"{family}{slot}"] = tier;
        }
        Slotted("g_tSticker", StickerArtTier);
        Slotted("g_tGlitterNormalSticker", NormalTier);
        Slotted("g_tNormalRoughnessSticker", StickerDataTier);
        Slotted("g_tSfxMaskSticker", StickerDataTier);
        return targets;
    }

    // ---------------------------------------------------------------------------------------------
    // CLASSIFIER
    // ---------------------------------------------------------------------------------------------

    // Walks every material's parsed data and returns `resolved .vtex path -> tier` for the keychain
    // textures that qualify. A texture qualifies only if EVERY binding of it, across the whole build,
    // is a keychain material binding it to a target property -- one foreign binding (a weapon's
    // g_tMetalness, a sticker material's g_tSfxMaskSticker0) or one binding to a non-target parameter
    // disqualifies it, because the tiers here are written against the keychain meaning of those
    // channels and a shared texture has no single meaning. A texture bound to two target properties
    // that want DIFFERENT tiers is dropped for the same reason.
    //
    // `compositeMaterialData` is walked as NEVER-keychain: a `.vcompmat` is a weapon paint composite
    // (the display case's is the only one a charm reaches), so it can only ever contribute a foreign
    // binding, which is exactly the role it needs to play here.
    //
    // `resolveTexturePath` maps a raw `.vtex` reference to the same resolved key the encode loop uses
    // (null when it cannot be resolved). Material data nodes are the plain object graph the metadata
    // extractor produces: nested Dictionary<string, object?> / List<object?> / string.
    public static Dictionary<string, KeychainTextureTier> ResolveTextureTiers(
        IEnumerable<object?> materialData,
        IEnumerable<object?> compositeMaterialData,
        Func<string, string?> resolveTexturePath)
    {
        var targetProperty = new Dictionary<string, string>(StringComparer.Ordinal);
        var foreign = new HashSet<string>(StringComparer.Ordinal);

        foreach (var data in materialData)
        {
            // Collected once per material, because the scope rule needs the bindings BEFORE it can say
            // whether the material is a keychain material at all: it is one when it sits on a keychain
            // shader and draws at least one texture from the keychain asset tree (see SCOPE).
            var bindings = Collect(data, resolveTexturePath);
            var keychainFamily = IsKeychainShader(data) && bindings.Any(binding => IsKeychainPath(binding.Path));
            Admit(bindings, keychainFamily, targetProperty, foreign);
        }
        foreach (var data in compositeMaterialData)
            Admit(Collect(data, resolveTexturePath), keychainFamily: false, targetProperty, foreign);

        foreach (var path in foreign)
            targetProperty.Remove(path);

        var tiers = new Dictionary<string, KeychainTextureTier>(StringComparer.Ordinal);
        foreach (var (path, property) in targetProperty)
            tiers[path] = Targets[property];
        return tiers;
    }

    private static void Admit(
        List<(string Property, string Path)> bindings,
        bool keychainFamily,
        Dictionary<string, string> targetProperty,
        HashSet<string> foreign)
    {
        foreach (var (property, path) in bindings)
        {
            if (keychainFamily && Targets.TryGetValue(property, out var tier))
            {
                // Two bindings that want DIFFERENT tiers have no single answer, so the texture is
                // dropped exactly like a foreign one.
                if (targetProperty.TryGetValue(path, out var seen))
                {
                    if (!ReferenceEquals(Targets[seen], tier)) foreign.Add(path);
                }
                else
                {
                    targetProperty[path] = property;
                }
            }
            else
            {
                foreign.Add(path);
            }
        }
    }

    private static bool IsKeychainShader(object? data) =>
        data is Dictionary<string, object?> dict &&
        dict.TryGetValue("m_shaderName", out var shader) &&
        shader is string name &&
        KeychainShaders.Contains(name);

    private static bool IsKeychainPath(string resolved)
    {
        var path = $"/{resolved.Replace('\\', '/').TrimStart('/')}";
        foreach (var segment in KeychainPathSegments)
            if (path.Contains(segment, StringComparison.OrdinalIgnoreCase)) return true;
        return false;
    }

    private static List<(string Property, string Path)> Collect(object? data, Func<string, string?> resolveTexturePath)
    {
        var bindings = new List<(string, string)>();
        Walk(data, contextName: null, bindings, resolveTexturePath);
        return bindings;
    }

    private static void Walk(
        object? value,
        string? contextName,
        List<(string Property, string Path)> bindings,
        Func<string, string?> resolveTexturePath)
    {
        switch (value)
        {
            case string reference:
                if (!IsTextureReference(reference)) return;
                var resolved = resolveTexturePath(reference);
                if (resolved != null) bindings.Add((contextName ?? "", resolved));
                return;

            case List<object?> list:
                foreach (var entry in list)
                    Walk(entry, contextName, bindings, resolveTexturePath);
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
                    Walk(child, name ?? key, bindings, resolveTexturePath);
                return;
        }
    }

    private static bool IsTextureReference(string value) =>
        MaterialPaths.NormalizeMaterialResourcePath(value).EndsWith(".vtex", StringComparison.OrdinalIgnoreCase);
}
