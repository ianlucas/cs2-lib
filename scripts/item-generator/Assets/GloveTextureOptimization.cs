/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

namespace ItemGenerator;

// Per-property WebP encode tiers for GLOVE textures, one of the four tuning surfaces beside
// StickerTextureOptimization, WeaponTextureOptimization and KeychainTextureOptimization. Every
// texture in the pipeline is lossless by default (see item-generator-webp.ts); these four files are
// the only places that opt a texture into a smaller encoding. Edit Targets, rebuild, done.
//
// THE SPLIT OF RESPONSIBILITY is the weapon file's: this file owns POLICY (which property gets which
// tier, with which thresholds and budgets), scripts/item-generator-webp.ts owns MEASUREMENT (every
// "guard" named below is a TEXTURE-DRIVEN classifier it evaluates against the pristine decompiled
// PNG). Nothing here keys on a filename, a skin or a resolution.
//
// EVERY TIER IS A WEAPON TIER applied to the glove property whose channels MEAN the same thing, so
// what is specific to this file is the MAPPING -- and that is decided by the per-parameter channel
// annotations in MaterialTextureProperties.cs, not by the property name.
//
// THE CEILING. Every budget aims at the same 1.5 MB per texture. That is a property of the SET (a
// glove is two small objects on screen, and the player's own hands are what they look at most) rather
// than of any one property's content, so the tiers differ in which lever they spend to reach it, not
// in where it sits.
//
// SCOPE. A glove texture qualifies only when EVERY binding of it, anywhere in the build, is a glove
// material binding it to a target property -- the rule WeaponTextureOptimization uses, and the reason
// the two scopes can never overlap. csgo_customglove.vfx, csgo_customglove_preview.vfx and
// csgo_textile_layer.vfx are glove-exclusive and admitted on the shader name alone.
// csgo_character.vfx is SHARED with agents, which bind g_tColor / g_tNormal / g_tAmbientOcclusion
// through it too, so it is admitted only under `characters/models/shared/arms/` (GlovePathSegments),
// the first-person arm set a glove item ships. Composites (`.vcompmat`) bind no texture of their own,
// so there is nothing for this classifier to find in one.

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
    // why that port is the right one.
    // ---------------------------------------------------------------------------------------------

    private const int Cap = 2048;
    private const int Half = 1024;
    private const int MB = 1024 * 1024;

    // No glove texture may ship above this. See THE CEILING above.
    private static readonly int Ceiling = (int)Math.Round(1.5 * MB);

    // TANGENT-SPACE NORMALS -- g_tNormal and the per-layer g_tDetailNormal* / g_tDamageNormal*. Their
    // RGB is a direction field, which is the weapon NormalTier's content exactly, so this is that
    // tier: lossy q80, capped, alpha never stripped.
    //
    // ALPHA IS ROUGHNESS, NOT A MASK, on the csgo_character.vfx variant (BC7 RG=normal + isoRough(B),
    // which VRF's decode moves into ALPHA), and on the two base gloves -- the only files the budget
    // ever reaches -- that plane is most of the file, so an RGB-only ladder cannot reach the ceiling.
    // Alpha therefore joins the walk, but stops at 60 rather than the 40 a coverage mask would take:
    // a60 is the error the weapon PaintRoughnessTier already ships on a roughness plane, and a40
    // doubles it.
    private static readonly GloveTextureTier NormalTier = new()
    {
        Mode = GloveEncodeMode.Lossy,
        Quality = 80,
        MaxWidth = Cap,
        // libwebp's own default, stated so the budget has a rung to start from.
        AlphaQuality = 100,
        SizeBudget = new(Ceiling, MinQuality: 64, MinAlphaQuality: 60)
    };

    // Where an albedo/detail fidelity-gate REJECTION goes, instead of lossless. Ported from the weapon
    // OverlayFloorTier: a rejection is usually measuring NOISE rather than structure the encoder
    // failed to represent, so the remedy is to spend MORE bits exactly where the gate said the encode
    // fell short (+10 quality and 4:4:4) rather than pay lossless prices to store grain.
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
    // fabric colours. Ported from the weapon ColorTier (lossy q80 behind a 30 dB gate): RGB is a
    // picture, which is what that tier was written for. The ALPHA here is a TINT MASK rather than the
    // wear ramp the weapon tier compresses unconditionally -- it SELECTS which tint a texel takes, so
    // a hard-edged one must not be smeared -- and so it goes through the weapon g_tPattern alpha gate
    // instead: a60 when soft, lossless when hard. The budget's alpha rung inherits that protection,
    // since the walk starts from the tier's own AlphaQuality. That rung has to exist because on this
    // property the mask can be the whole file: on a 4096 textile swatch whose RGB is a seventh of the
    // bytes, grinding quality alone stalls above the ceiling. FlattenGuard handles the other end of
    // the population, an alpha spanning 254..255 that no blend can show.
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
    // (512 native) whose job is to break up the surface under it, and it measures as a NOISE field of
    // independent planes rather than a picture -- the weapon GrungeTier's population. So that
    // tier's 4:4:4 comes along (a chroma subsampler averages across planes that must stay independent)
    // and so does alpha at 60.
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
    // than analogous: these measure R = G = B with a constant-255 alpha, which is the fact GreyGuard
    // re-verifies per file. q90 is WearTier's number, chosen there because a thresholded field moves
    // its boundaries when it is smoothed.
    private static readonly GloveTextureTier HeightTier = new()
    {
        Mode = GloveEncodeMode.Lossy,
        Quality = 90,
        GreyGuard = true,
        MaxWidth = Cap,
        LossyGuard = new(30),
        SizeBudget = new(Ceiling, MinQuality: 78)
    };

    // GREY AO -- g_tAmbientOcclusion on the base glove materials, "BC4 R: plain AO". R = G = B with a
    // constant-255 alpha on both real files, the same single-plane shape as the height maps. Ported
    // from the weapon PaintRoughnessTier, the tier written for exactly this: a continuous scalar field
    // in one plane at q90 behind a gate.
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
    // quantization under a lossless encode, with no DCT in the path. Ported from the weapon
    // MetalnessFloorTier / PaintByNumberTier pair, MaskKernel included -- area averaging cannot take a
    // value outside the range its source texels had, so a flat plane stays flat through a resize the
    // way it cannot through Lanczos.
    //
    // THE LADDER ENDS IN A RESIZE, this file's one mechanism the weapon ladders do not have. It exists
    // for the single 4096 textile swatch that spends past posterize/16, where every quantization rung
    // either stays over the ceiling or drifts a 2-count roughness plane into a 49-count one -- a
    // uniform gloss change across a whole fabric layer -- while 1024 lossless fits with every plane
    // exact. A swatch TILES across the glove and its siblings are authored at 512-1024, so 4096 is the
    // outlier rather than detail the look needs. The rung is tried only after quantization has failed,
    // so nothing that fits is resized.
    private static readonly GloveTextureTier PackedFloorTier = new()
    {
        Mode = GloveEncodeMode.Lossless,
        Quality = 100,
        MaxWidth = Cap,
        MaskKernel = true,
        MaskBudget = new(Ceiling, [80, 70, 60], [4, 8, 12, 16], [Half])
    };

    // PACKED DATA PLANES -- every glove texture whose channels are several INDEPENDENT scalars rather
    // than a picture, read off MaterialTextureProperties.cs: g_tSurface (packed surface properties on
    // a glove, NOT the weapon's object-space normal), g_tObjectProperties, g_t*Properties1-4,
    // g_tPatternProperties, and the compat layer maps g_tSubstrateNormal1-4 / g_tSurfaceNormal1-4 (BC7
    // HemiOctAniso: normal in (G,A), aniso roughness in (R,B), exported RAW precisely because those
    // four channels are independent). The layer maps must NOT take NormalTier: their ALPHA is half the
    // normal vector, so no budget may ever trade it. All of them take the weapon MetalnessTier --
    // lossy q90, 4:4:4, area kernel, a 30 dB gate and a bounded floor underneath.
    //
    // FlatPlaneGuard splits the two populations. Files with several live planes of smooth gradient are
    // what MetalnessTier was measured on. The rest carry a CONSTANT plane beside a live one, and a
    // lossy encode cannot hold a constant plane still -- on a glove that drift is a uniform gloss
    // shift across a fabric layer, or anisotropy invented on a surface that had none -- so they take
    // the bounded path, whose posterize ladder skips flat planes outright and leaves them bit-exact.
    //
    // The size budget ends in a resize like PackedFloorTier's, and the ordering matters: quality
    // first, resolution only once quality has run out. The unique-UV body maps reach the ceiling on
    // the quality ladder alone and are never resized; a layer map whose alpha is half its normal has
    // nothing else left to spend.
    private static readonly GloveTextureTier PackedTier = new()
    {
        Mode = GloveEncodeMode.Lossy,
        Quality = 90,
        MaxWidth = Cap,
        // Independent planes: never let the chroma subsampler near them.
        SmartSubsample = true,
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
    // masks to PatternFloorTier, and the alpha gate compressing only masks that are actually soft.
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
    // deciding which of the four material layers shows where. Four independent weight fields, i.e. the
    // weapon PaintByNumberTier's content, so it takes that tier: lossless with an area kernel, and a
    // posterize ladder that only fires if a mask is ever over the ceiling. None is today, so this is a
    // capped, bit-exact re-encode.
    private static readonly GloveTextureTier LayerMaskTier = new()
    {
        Mode = GloveEncodeMode.Lossless,
        Quality = 100,
        MaxWidth = Cap,
        MaskKernel = true,
        FlattenGuard = true,
        MaskBudget = new(Ceiling, [75, 70, 65], [8, 12, 16, 20])
    };

    // A property absent from this table is never touched: its textures take the default lossless path,
    // byte-identical to an untiered texture.
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
