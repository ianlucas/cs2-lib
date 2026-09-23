/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

namespace ItemGenerator;

// Per-property WebP encode tiers for KEYCHAIN (charm) textures, one of the four tuning surfaces
// beside StickerTextureOptimization, WeaponTextureOptimization and GloveTextureOptimization. Every
// texture in the pipeline is lossless by default (see item-generator-webp.ts); these four files are
// the only places that opt a texture into a smaller encoding. Edit Targets, rebuild, done.
//
// THE SPLIT OF RESPONSIBILITY is the weapon file's: this file owns POLICY (which property gets which
// tier, with which thresholds and budgets), scripts/item-generator-webp.ts owns MEASUREMENT (every
// "guard" named below is a TEXTURE-DRIVEN classifier it evaluates against the pristine decompiled
// PNG). Nothing here keys on a filename, a charm or a resolution.
//
// WHY THIS FILE EXISTS RATHER THAN A LINE IN WeaponTextureOptimization. A charm rides on
// csgo_weapon.vfx and its channels really are the weapon ones, so every tier below is a weapon tier
// (two are sticker tiers) applied to the keychain property that means the same thing. What is NOT
// shared is the POPULATION: the weapon g_tMetalness tier guards the B plane alone because B is the
// only constant plane there, while here most maps carry a constant plane and it is R, G or B
// depending on the file; and the weapon g_tAmbientOcclusion tier touches 4K sources only, where every
// keychain AO map is 1024 or 512. Riding on the weapon file would mean editing tiers 2801 shipped
// weapon textures depend on, to serve 361.
//
// THE CEILING. Every budget aims at the same 1.5 MB per texture the glove file uses, and QUALITY is
// what spends it: nothing in this set is above the 2048 cap, so resolution is not a lever at all.
//
// SCOPE. A keychain texture qualifies only when EVERY binding of it, anywhere in the build, is a
// keychain material binding it to a target property -- the rule the weapon and glove files use.
// Identifying a keychain material is the one thing this file does differently: both shaders a charm
// can be on (csgo_weapon.vfx, csgo_simple_liquid.vfx) are shared, so a material counts as a keychain
// material when it is on one of them AND at least one texture it binds resolves under "/keychains/"
// (KeychainPathSegments). That is the segment WeaponTextureOptimization excludes on, so the two
// scopes partition rather than overlap, and it is the form of the rule that can be VERIFIED: the
// decompiled workspace mirrors texture resource paths, but keeps no .vmat path to key the tidier
// material-path rule on. The rule also pulls in a few borrowed glitter normals and shared engine
// constants from outside the tree, as intended; where one is claimed by both files, AssetProcessor
// resolves weapon tiers first.

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
// and its documentation cannot drift apart. The weapon and glove knobs no keychain tier uses are
// deliberately absent: StripAlpha, NearLossless, MinWidth, Posterize, FlattenAlpha, Greyscale,
// SfxGuard, MaskGuard, NoiseGuard (with Decimate/GrainBoost) and the budgets' Widths rung. The grain
// path is the notable one -- it exists for stipple/spray camo, and nothing in this set comes near the
// lag-1 threshold its guard trips at, so it could only ever have been dead code here.
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
    public static readonly IReadOnlySet<string> KeychainShaders = new HashSet<string>(
        StringComparer.OrdinalIgnoreCase
    )
    {
        "csgo_weapon.vfx",
        "csgo_simple_liquid.vfx",
    };

    // The keychain asset tree, as it appears in a resolved TEXTURE resource path (weapons/keychains/*
    // and workshop/keychains/*). Same segment WeaponTextureOptimization.ExcludedPathSegments drops on.
    public static readonly IReadOnlyList<string> KeychainPathSegments = ["/keychains/"];

    // ---------------------------------------------------------------------------------------------
    // TIERS. Each records what the property's channels hold (from the per-parameter annotations in
    // MaterialTextureProperties.cs, verified per file), which weapon or sticker tier it is ported
    // from, and why that port is the right one.
    // ---------------------------------------------------------------------------------------------

    private const int Cap = 2048;

    private const int KB = 1024;
    private const int MB = 1024 * 1024;

    // No keychain texture may ship above this. See THE CEILING above.
    private static readonly int Ceiling = (int)Math.Round(1.5 * MB);

    // The BOUNDED path's own ceiling, lower than Ceiling on purpose and set the way the weapon
    // SurfaceTier sets its own: at PRODUCTION'S CURRENT CEILING FOR THE PROPERTY. A file already under
    // it stays BIT-EXACT and only the tail pays -- 10 of the 78 real-size maps, none of which spends
    // past post/12 (+-6).
    private const int PackedCeiling = 466 * KB;

    // Where an albedo/detail fidelity-gate REJECTION goes, instead of lossless. Ported from the weapon
    // OverlayFloorTier: a rejection is usually measuring NOISE rather than structure the encoder
    // failed to represent, so the remedy is to spend MORE bits in exactly the place the gate said the
    // encode fell short (+10 quality and 4:4:4) rather than pay lossless prices to store grain.
    private static readonly KeychainTextureTier GrainFloorTier = new()
    {
        Mode = KeychainEncodeMode.Lossy,
        Quality = 90,
        AlphaQuality = 60,
        SmartSubsample = true,
        MaxWidth = Cap,
        SizeBudget = new(Ceiling, MinQuality: 64, MinAlphaQuality: 20),
    };

    // NORMALS -- g_tNormal, the glitter normals (g_tGlitterNormal, g_tGlitterNormalSticker*) and the
    // liquid charms' g_tNormalA. Ported from the weapon NormalTier (lossy q80, capped, alpha never
    // stripped) with the glove file's budget on top. The port is exact for g_tNormal: all 69 files
    // decode to a unit vector in RGB with a CONSTANT alpha, which is what a BC5 HemiOct(RG) normal
    // gives, so nothing flattens or strips it and no alpha gate can fire on it either.
    //
    // g_tNormalA is the same content with a ROUGHNESS plane in alpha (BC7 RG=hemi-oct normal +
    // isoRough(B), which the _RG_B decode moves there; see GameFiles/TextureCodecPolicy.cs), and that
    // plane is 93% of the file -- an RGB-only ladder cannot reach the ceiling on it at any quality
    // while alpha reaches it in one step. The walk stops at a60, not the a40 a coverage mask would
    // take, because a60 is the error the weapon PaintRoughnessTier already ships on a roughness
    // plane.
    private static readonly KeychainTextureTier NormalTier = new()
    {
        Mode = KeychainEncodeMode.Lossy,
        Quality = 80,
        MaxWidth = Cap,
        // libwebp's own default, stated so the budget has a rung to start from.
        AlphaQuality = 100,
        SizeBudget = new(Ceiling, MinQuality: 64, MinAlphaQuality: 60),
    };

    // ALBEDO -- g_tColor (the charm's base colour), g_tDetail ("BC7 RGB sRGB, detail albedo overlay")
    // and g_tColorA (the liquid layer: "RGB=color (sRGB), A=metalness"). Ported from the weapon
    // ColorTier: lossy q80 behind a 30 dB fidelity gate, RGB being a picture. Every g_tColor file here
    // measures as artwork rather than a packed data field, so the gate is a backstop; it fires on two.
    //
    // The ALPHA plane is not the weapon tier's, which is why two things differ. It is FAKE on 78 of 82
    // -- one count wide (254..255), stored at lossless grade only because the SHAPE of the 254 region
    // is detailed -- so FlattenGuard drops it, where a weapon albedo's alpha is a real paint/wear
    // coverage mask and ColorTier has no such guard. And it is compressed only when SOFT, because
    // g_tColorA's alpha is a METALNESS plane: a hard-edged material selector must not be smeared,
    // while a soft one is a ramp with nothing to ring at. The size budget walks alpha only after the
    // gate has fired, for the same reason -- the mask is never degraded to pay for the colour.
    private static readonly KeychainTextureTier AlbedoTier = new()
    {
        Mode = KeychainEncodeMode.Lossy,
        Quality = 80,
        MaxWidth = Cap,
        LossyGuard = new(30),
        GuardFallback = GrainFloorTier,
        AlphaGuard = new(0.5, 60),
        FlattenGuard = true,
        SizeBudget = new(Ceiling, MinQuality: 64, MinAlphaQuality: 40),
    };

    // SCALAR FIELDS IN ONE PLANE -- g_tAmbientOcclusion ("[weapon] BC4 R: plain AO"), g_tTintMask
    // ("BC4 R, tint-application mask") and g_tLiquidMask ("BC4 R (inverted), liquid coverage mask").
    // Ported from the weapon PaintRoughnessTier, the tier written for exactly this: a continuous
    // scalar field in one plane at q90 behind a 30 dB gate. All 109 files measure R = G = B with a
    // constant-255 alpha, and GreyGuard re-checks it per file, so one ever authored with real chroma
    // or a real mask keeps all four planes and the tier degrades to plain lossy.
    //
    // A tint mask is a SELECTOR, the one thing to watch on this tier, and these measure as ramps
    // rather than palettes; the gate is what would catch a future one that really is a hard region
    // mask. The grey collapse buys no bytes here (VP8L already encodes the duplicate planes and the
    // constant alpha for free), so only the busiest maps ship lossy and the rest stay bit-exact under
    // the never-regress rule.
    private static readonly KeychainTextureTier ScalarTier = new()
    {
        Mode = KeychainEncodeMode.Lossy,
        Quality = 90,
        GreyGuard = true,
        MaxWidth = Cap,
        LossyGuard = new(30),
        SizeBudget = new(Ceiling, MinQuality: 84),
    };

    // Where a packed texture with a FLAT plane goes, and where a packed gate rejection goes: bounded
    // quantization under a lossless encode, with no DCT involved at all. Ported from the weapon
    // MetalnessFloorTier / SurfaceTier pair, MaskKernel included -- area averaging cannot take a value
    // outside the range its source texels had, so a flat plane stays flat through a resize the way it
    // cannot through Lanczos. The posterize ladder skips any plane under POSTERIZE_SKIP_DISTINCT
    // levels, which is what keeps the flat planes BIT-EXACT while the live ones pay.
    private static readonly KeychainTextureTier PackedFloorTier = new()
    {
        Mode = KeychainEncodeMode.Lossless,
        Quality = 100,
        MaxWidth = Cap,
        MaskKernel = true,
        MaskBudget = new(PackedCeiling, [80, 70, 60], [4, 8, 12, 16, 24, 32]),
    };

    // PACKED DATA PLANES -- g_tMetalness ("BC5 R=roughness(inverted), G=metalness; the BC7 variant adds
    // B=SFX mask"), g_tOpaqueRefractMask ("BC7 R") and g_tStickerWepInputs ("R=sticker mask,
    // G=sticker cavity"). Several INDEPENDENT scalars in one file rather than a picture, which is the
    // weapon MetalnessTier's content and therefore its tier: lossy q90, 4:4:4 (independent planes must
    // never meet a chroma subsampler), the area kernel, a 30 dB gate and a bounded floor underneath.
    //
    // WHAT IS NOT PORTED IS SfxGuard, and that is the whole reason this file exists. It guards the B
    // plane specifically, because B is constant in every weapon file. Keychains break that in both
    // directions: 64 of 78 real-size maps carry a constant plane and it is R, G or B depending on the
    // file, and some carry a REAL SFX mask in a live B. So the guard is the glove file's
    // FlatPlaneGuard, which asks whether ANY plane is constant rather than naming one. A DCT drifts
    // such a plane by up to 128 counts -- on a charm, a uniform gloss shift across the whole object,
    // or an SFX mask at half strength on an object that has none -- which is what production already
    // does on 63 of them. So this tier deliberately SPENDS bytes against production (~13.6 MB against
    // 7.3 MB) to stop inventing material data; the 14 maps with no constant plane take the DCT as the
    // weapon set does.
    private static readonly KeychainTextureTier PackedTier = new()
    {
        Mode = KeychainEncodeMode.Lossy,
        Quality = 90,
        MaxWidth = Cap,
        // Independent planes: never let the chroma subsampler near them.
        SmartSubsample = true,
        MaskKernel = true,
        FlatPlaneGuard = true,
        FlattenGuard = true,
        LossyGuard = new(30),
        GuardFallback = PackedFloorTier,
        SizeBudget = new(Ceiling, MinQuality: 70),
        // Reached only by a file the guards sent to the bounded floor that is still over PackedCeiling,
        // which is where the quantizer is the right answer: no DCT is involved on that path at all.
        MaskBudget = new(PackedCeiling, [80, 70, 60], [4, 8, 12, 16, 24, 32]),
    };

    // STICKER-SLOT ARTWORK -- g_tSticker0-4 on the display-case charm ("RGB=sticker color, A=wear
    // mask"). Ported verbatim from StickerTextureOptimization's g_tSticker0 tier (lossy q90), the same
    // property under the same shader family: the display case renders a sticker exactly as a weapon
    // does. Every instance in the build today is shared with the weapon sticker path and so is dropped
    // by the scope rule; the tier is here because the next display-case charm may carry its own.
    private static readonly KeychainTextureTier StickerArtTier = new()
    {
        Mode = KeychainEncodeMode.Lossy,
        Quality = 90,
        MaxWidth = Cap,
    };

    // STICKER-SLOT DATA -- g_tNormalRoughnessSticker0-4 ("RG=hemi-oct normal, +isoRough(B), A=self-illum
    // mask") and g_tSfxMaskSticker0-4 ("RGB=holo mask, A=glitter mask"). Ported verbatim from
    // StickerTextureOptimization, including its finding that these are the two sticker properties lossy
    // cannot have: it facets the normal on glossy/metallic stickers and shifts the holo composite, even
    // at q95. The only lever is a lossless downscale to 512, which keeps every value exact.
    //
    // THIS IS THE ONE PLACE THE 2048 CAP IS NOT THE CAP, and it is deliberate: 512 is the validated
    // operating point for these two properties, and a charm's sticker is rendered at a fraction of the
    // size a weapon's is. MaskKernel is this file's one addition to the sticker tier -- the sticker path
    // resizes through Lanczos, whose negative lobes overshoot at a mask's hard edges where a box filter
    // cannot.
    private static readonly KeychainTextureTier StickerDataTier = new()
    {
        Mode = KeychainEncodeMode.Lossless,
        Quality = 100,
        MaxWidth = 512,
        MaskKernel = true,
    };

    // A property absent from this table is never touched: its textures take the default lossless path,
    // byte-identical to an untiered texture.
    // Two are absent on purpose:
    //   g_tHoloSpectrumSticker*  the sticker tier for it strips alpha and skips anything under 1024
    //                            wide; StripAlpha and MinWidth are knobs no other keychain tier needs,
    //                            and the one instance in the build is shared with the weapon sticker
    //                            path anyway, so the scope rule would drop it regardless.
    //   g_tStickerScratches      one texture, and it is the shared weapon scratch pattern -- dropped by
    //                            the scope rule before any tier could apply.
    public static readonly IReadOnlyDictionary<string, KeychainTextureTier> Targets =
        BuildTargets();

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
            ["g_tLiquidMask"] = ScalarTier,
        };
        // The display case carries five sticker slots and the shader names each one, so a property is
        // registered per slot. They share one meaning per family, exactly as the glove layers do.
        void Slotted(string family, KeychainTextureTier tier)
        {
            for (var slot = 0; slot <= 4; slot++)
                targets[$"{family}{slot}"] = tier;
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
        Func<string, string?> resolveTexturePath
    )
    {
        var targetProperty = new Dictionary<string, string>(StringComparer.Ordinal);
        var foreign = new HashSet<string>(StringComparer.Ordinal);

        foreach (var data in materialData)
        {
            // Collected once per material, because the scope rule needs the bindings BEFORE it can say
            // whether the material is a keychain material at all: it is one when it sits on a keychain
            // shader and draws at least one texture from the keychain asset tree (see SCOPE).
            var bindings = Collect(data, resolveTexturePath);
            var keychainFamily =
                IsKeychainShader(data) && bindings.Any(binding => IsKeychainPath(binding.Path));
            Admit(bindings, keychainFamily, targetProperty, foreign);
        }
        foreach (var data in compositeMaterialData)
            Admit(
                Collect(data, resolveTexturePath),
                keychainFamily: false,
                targetProperty,
                foreign
            );

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
        HashSet<string> foreign
    )
    {
        foreach (var (property, path) in bindings)
        {
            if (keychainFamily && Targets.TryGetValue(property, out var tier))
            {
                // Two bindings that want DIFFERENT tiers have no single answer, so the texture is
                // dropped exactly like a foreign one.
                if (targetProperty.TryGetValue(path, out var seen))
                {
                    if (!ReferenceEquals(Targets[seen], tier))
                        foreign.Add(path);
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
        data is Dictionary<string, object?> dict
        && dict.TryGetValue("m_shaderName", out var shader)
        && shader is string name
        && KeychainShaders.Contains(name);

    private static bool IsKeychainPath(string resolved)
    {
        var path = $"/{resolved.Replace('\\', '/').TrimStart('/')}";
        foreach (var segment in KeychainPathSegments)
            if (path.Contains(segment, StringComparison.OrdinalIgnoreCase))
                return true;
        return false;
    }

    private static List<(string Property, string Path)> Collect(
        object? data,
        Func<string, string?> resolveTexturePath
    )
    {
        var bindings = new List<(string, string)>();
        Walk(data, contextName: null, bindings, resolveTexturePath);
        return bindings;
    }

    private static void Walk(
        object? value,
        string? contextName,
        List<(string Property, string Path)> bindings,
        Func<string, string?> resolveTexturePath
    )
    {
        switch (value)
        {
            case string reference:
                if (!IsTextureReference(reference))
                    return;
                var resolved = resolveTexturePath(reference);
                if (resolved != null)
                    bindings.Add((contextName ?? "", resolved));
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
                    dict.TryGetValue("m_name", out var mName) && mName is string n1 && n1.Length > 0
                        ? n1
                    : dict.TryGetValue("m_strName", out var mStrName)
                    && mStrName is string n2
                    && n2.Length > 0
                        ? n2
                    : contextName;
                foreach (var (key, child) in dict)
                    Walk(child, name ?? key, bindings, resolveTexturePath);
                return;
        }
    }

    private static bool IsTextureReference(string value) =>
        MaterialPaths
            .NormalizeMaterialResourcePath(value)
            .EndsWith(".vtex", StringComparison.OrdinalIgnoreCase);
}
