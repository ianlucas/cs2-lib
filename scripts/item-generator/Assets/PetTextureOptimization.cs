/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

namespace ItemGenerator;

// Per-property WebP encode tiers for PET textures, the seventh tuning surface beside
// StickerTextureOptimization, WeaponTextureOptimization, GloveTextureOptimization,
// KeychainTextureOptimization, CharacterTextureOptimization and PatchTextureOptimization. Same
// contract: this file owns POLICY, scripts/item-generator-webp.ts owns MEASUREMENT, and a property
// absent from Targets is never touched -- its textures take the default lossless path.
//
// EVERY TIER IS AN EXISTING TIER applied to the pet property whose channels MEAN the same thing. A
// pet is a csgo_character.vfx model, the shader an agent is on, so g_tColor and g_tNormal take the
// agent tiers verbatim; what is specific to this file is the properties an agent never ships as a
// file of its own (see Targets), and each of those is ported from the glove or weapon tier written
// for that channel layout.
//
// WHY NOT CharacterTextureOptimization ITSELF. That classifier reads an agent's .glb, because an
// agent's textures are embedded in it. A pet's are not: a breed has up to fourteen looks that share
// one normal map, one AO map and one gloss map, so they are published through the ordinary material
// pipeline, where a consumer fetches only the look it shows. This file is therefore shaped like
// PatchTextureOptimization -- the same shader, admitted by material path.
//
// SCOPE. A pet texture qualifies only when EVERY binding of it, anywhere in the build, is a pet
// material binding it to a target property -- the rule the glove and patch files use. Both shaders a
// pet model can be on are shared (csgo_character.vfx with agents, glove arms and patches;
// csgo_environment.vfx is the map-prop shader the feed bag is on), so a material is admitted only
// under one of PetPathSegments, the mirror of GloveTextureOptimization's `/models/shared/arms/`.
//
// THE TIER RECORD IS GloveTextureTier, as it is for CharacterTextureOptimization, with `Kind`
// overridden so a manifest line names the family that chose it.
public static class PetTextureOptimization
{
    // ---------------------------------------------------------------------------------------------
    // SCOPE
    // ---------------------------------------------------------------------------------------------

    public const string CharacterShader = "csgo_character.vfx";

    // The blend-layered prop shader. Only the feed bag is on it; its layer-1 maps hold what the
    // character shader's unnumbered ones do (see MaterialTextureProperties.cs).
    public const string EnvironmentShader = "csgo_environment.vfx";

    // The material trees of the pet models: the chick and the breeds, the egg, and the feed bag.
    public static readonly IReadOnlyList<string> PetPathSegments =
    [
        "/models/chicken/",
        "/models/egg/",
        "/models/chicken_feed/",
    ];

    // ---------------------------------------------------------------------------------------------
    // TIERS. Each records what the property's channels hold, which tier it is ported from and what
    // was measured on the pet population to confirm the port.
    // ---------------------------------------------------------------------------------------------

    private const int Cap = 2048;
    private const int Half = 1024;
    private const int MB = 1024 * 1024;

    // The ceiling the glove and agent families share. Nothing a pet binds is above the 2048 cap, so
    // as on a keychain, resolution is not a lever here and quality is what reaches it.
    private static readonly int Ceiling = (int)Math.Round(1.5 * MB);

    private const string Pet = "pet";

    // TANGENT-SPACE NORMALS -- g_tNormal, and g_tNormal1 on the feed bag: BC7 RG = normal +
    // isoRough(B), which VRF's decode moves into ALPHA. CharacterTextureOptimization's NormalTier
    // verbatim. On a breed that alpha is a constant 0 (its roughness lives in g_tAnisoGloss instead),
    // and it is kept for the reason the weapon NormalTier gives: the shader's .a sample must stay 0.
    //
    // Feather relief is the densest normal content in the build, and q80 costs more here than on an
    // agent: 2.8-4.5 degrees of mean angular error on the three breeds against roughly 1 degree on
    // an agent body. Quality is not the lever that buys it back -- q94 with 4:4:4 is 1.9-3.4 degrees
    // for 2.3x the bytes, because what is left is the encoder's chroma resolution, which no lossy
    // setting restores -- so the tier stays where the agents' is. The budget is reached by the feed
    // bag alone (5.4 MB lossless, a burlap weave under a live roughness plane).
    private static readonly GloveTextureTier NormalTier = new()
    {
        Kind = Pet,
        Mode = GloveEncodeMode.Lossy,
        Quality = 80,
        MaxWidth = Cap,
        AlphaQuality = 100,
        SizeBudget = new(Ceiling, MinQuality: 64, MinAlphaQuality: 60),
    };

    // ALBEDO -- g_tColor, g_tColor1 on the feed bag, and g_tDetail, which on a pet is a picture too:
    // the face and comb artwork a look draws over its base colour, not the tiling grain swatch
    // GloveTextureOptimization's DetailTier is written for (lag-1 autocorrelation 0.96-0.99 on all
    // nine). CharacterTextureOptimization's AlbedoTier verbatim, and its guards sort the alpha planes
    // unaided: a breed's colour alpha is a constant 255 and FlattenGuard drops it; a detail map's
    // spans 0..4, transparent to within rounding, which FlattenGuard must and does leave alone; the
    // chick's down and the feed bag carry real ones, under the 0.5 soft fraction AlphaGuard asks for,
    // so they stay lossless. Every file clears the 30 dB gate.
    private static readonly GloveTextureTier AlbedoTier = new()
    {
        Kind = Pet,
        Mode = GloveEncodeMode.Lossy,
        Quality = 80,
        MaxWidth = Cap,
        LossyGuard = new(30),
        AlphaGuard = new(0.5, 60),
        FlattenGuard = true,
        SizeBudget = new(Ceiling, MinQuality: 64, MinAlphaQuality: 40),
    };

    // GREY SCALAR FIELDS -- g_tAmbientOcclusion and g_tTintMask, both "BC4 R": R = G = B with a
    // constant-255 alpha on every file, the fact GreyGuard re-verifies. GloveTextureOptimization's
    // AoTier verbatim (itself the weapon PaintRoughnessTier), the tier written for a continuous
    // scalar in one plane. A tint mask is a blend weight the look's tint is applied through, not a
    // field the shader thresholds, which is why it shares AO's tier rather than taking the height
    // one. The two hard-edged masks in the set (the egg's, and the solid Polish one) encode smaller
    // lossless than lossy, so never-regress keeps them bit-exact.
    private static readonly GloveTextureTier ScalarTier = new()
    {
        Kind = Pet,
        Mode = GloveEncodeMode.Lossy,
        Quality = 90,
        GreyGuard = true,
        MaxWidth = Cap,
        LossyGuard = new(30),
        SizeBudget = new(Ceiling, MinQuality: 84),
    };

    // Where a gloss gate rejection goes: GloveTextureOptimization's PackedFloorTier verbatim, bounded
    // quantization under a lossless encode with no DCT in the path. Nothing reaches it today.
    private static readonly GloveTextureTier GlossFloorTier = new()
    {
        Kind = Pet,
        Mode = GloveEncodeMode.Lossless,
        Quality = 100,
        MaxWidth = Cap,
        MaskKernel = true,
        MaskBudget = new(Ceiling, [80, 70, 60], [4, 8, 12, 16], [Half]),
    };

    // ANISOTROPIC GLOSS -- g_tAnisoGloss, "BC5 RG": roughness along the two anisotropy axes, two
    // INDEPENDENT scalar planes of smooth gradient. That is the weapon g_tMetalness layout (BC5
    // R = roughness, G = metalness), so this is the weapon MetalnessTier as
    // GloveTextureOptimization's PackedTier carries it: lossy q90, 4:4:4, area kernel, a 30 dB gate
    // and the bounded floor underneath.
    //
    // FlatPlaneGuard is deliberately NOT ported with it. The guard exists because a DCT cannot hold a
    // constant plane still, and every one of these has one -- but it is B, which a two-channel BC5
    // texture does not have: the export pads it with 0 and the shader can only sample .rg. Drift
    // there reaches nothing, while the guard would send all three files to the lossless floor to
    // protect it (2.8 MB -> 2.7 MB instead of 0.8 MB). The planes that are read land where the
    // weapon tier already ships roughness: R at 32.0-34.6 dB against 32.0-32.6 dB on the two weapon maps
    // measured for comparison.
    private static readonly GloveTextureTier GlossTier = new()
    {
        Kind = Pet,
        Mode = GloveEncodeMode.Lossy,
        Quality = 90,
        MaxWidth = Cap,
        // Independent planes: never let the chroma subsampler near them.
        SmartSubsample = true,
        MaskKernel = true,
        FlattenGuard = true,
        LossyGuard = new(30),
        GuardFallback = GlossFloorTier,
        SizeBudget = new(Ceiling, MinQuality: 70, MinAlphaQuality: null, Widths: [Half]),
        MaskBudget = new(Ceiling, [80, 70, 60], [4, 8, 12, 16], [Half]),
    };

    // A property absent from these tables is never touched. The absences are deliberate:
    //   g_tIridescentThickness_Mask   the largest thing left lossless (4.8 MB over six files, one of
    //                                 them above the ceiling). Its channel layout is not confirmed,
    //                                 and a tier is written against what the channels mean. What can
    //                                 be measured rules the DCT out regardless: G is the only live
    //                                 plane and R is a constant 127-130, which a q90 encode moves by
    //                                 up to 129 counts -- on what is, by the parameter's name, the
    //                                 film thickness the interference colour is computed from. The
    //                                 bounded floor would hold R still, but its only saving is to
    //                                 posterize G on the one file over the ceiling.
    //   g_tMetalness                  "BC7 G=metal, B=cloth, A=rim". Two real files (492 K and 91 K)
    //                                 and the chick's two cloth masks beside 16x16 constants; each
    //                                 has a constant plane, so the bounded path is the only one open
    //                                 to it, and that saves 80 K across the set.
    //   g_tHeight1                    the 1x1 engine default.
    public static readonly IReadOnlyDictionary<
        string,
        IReadOnlyDictionary<string, GloveTextureTier>
    > Targets = new Dictionary<string, IReadOnlyDictionary<string, GloveTextureTier>>(
        StringComparer.OrdinalIgnoreCase
    )
    {
        [CharacterShader] = new Dictionary<string, GloveTextureTier>(StringComparer.Ordinal)
        {
            ["g_tColor"] = AlbedoTier,
            ["g_tDetail"] = AlbedoTier,
            ["g_tNormal"] = NormalTier,
            ["g_tAmbientOcclusion"] = ScalarTier,
            ["g_tTintMask"] = ScalarTier,
            ["g_tAnisoGloss"] = GlossTier,
        },
        [EnvironmentShader] = new Dictionary<string, GloveTextureTier>(StringComparer.Ordinal)
        {
            ["g_tColor1"] = AlbedoTier,
            ["g_tNormal1"] = NormalTier,
        },
    };

    // ---------------------------------------------------------------------------------------------
    // CLASSIFIER
    // ---------------------------------------------------------------------------------------------

    // Returns `resolved .vtex path -> tier` for the pet textures that qualify: every binding of the
    // texture, across the whole build, is a pet material binding it to a target property. One foreign
    // binding disqualifies it, exactly as in GloveTextureOptimization, and so do two bindings that
    // want different tiers.
    //
    // `materialData` is keyed by resource path because the scope rule needs it. `resolveTexturePath`
    // maps a raw `.vtex` reference to the same resolved key the encode loop uses (null when it cannot
    // be resolved).
    public static Dictionary<string, GloveTextureTier> ResolveTextureTiers(
        IEnumerable<KeyValuePair<string, object?>> materialData,
        Func<string, string?> resolveTexturePath
    )
    {
        var tiers = new Dictionary<string, GloveTextureTier>(StringComparer.Ordinal);
        var foreign = new HashSet<string>(StringComparer.Ordinal);

        foreach (var (path, data) in materialData)
            Walk(
                data,
                contextName: null,
                ResolveTargets(path, data),
                tiers,
                foreign,
                resolveTexturePath
            );

        foreach (var path in foreign)
            tiers.Remove(path);
        return tiers;
    }

    // The target table of the shader a pet material is on, or null for a material outside the family.
    private static IReadOnlyDictionary<string, GloveTextureTier>? ResolveTargets(
        string materialPath,
        object? data
    )
    {
        if (data is not Dictionary<string, object?> dict)
            return null;
        if (!dict.TryGetValue("m_shaderName", out var shader) || shader is not string name)
            return null;
        if (!Targets.TryGetValue(name, out var targets))
            return null;
        var path = $"/{MaterialPaths.NormalizeMaterialResourcePath(materialPath).TrimStart('/')}";
        foreach (var segment in PetPathSegments)
            if (path.Contains(segment, StringComparison.OrdinalIgnoreCase))
                return targets;
        return null;
    }

    private static void Walk(
        object? value,
        string? contextName,
        IReadOnlyDictionary<string, GloveTextureTier>? targets,
        Dictionary<string, GloveTextureTier> tiers,
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
                    targets != null
                    && contextName != null
                    && targets.TryGetValue(contextName, out var tier)
                    && (!tiers.TryGetValue(resolved, out var seen) || ReferenceEquals(seen, tier))
                )
                    tiers[resolved] = tier;
                else
                    foreign.Add(resolved);
                return;

            case List<object?> list:
                foreach (var entry in list)
                    Walk(entry, contextName, targets, tiers, foreign, resolveTexturePath);
                return;

            case Dictionary<string, object?> dict:
                // A texture-bearing node names its parameter with `m_name` (vmat) or `m_strName`
                // (vcompmat); the texture path sits under a sibling key.
                var name =
                    dict.TryGetValue("m_name", out var mName) && mName is string n1 && n1.Length > 0
                        ? n1
                    : dict.TryGetValue("m_strName", out var mStrName)
                    && mStrName is string n2
                    && n2.Length > 0
                        ? n2
                    : contextName;
                foreach (var (key, child) in dict)
                    Walk(child, name ?? key, targets, tiers, foreign, resolveTexturePath);
                return;
        }
    }

    private static bool IsTextureReference(string value) =>
        MaterialPaths
            .NormalizeMaterialResourcePath(value)
            .EndsWith(".vtex", StringComparison.OrdinalIgnoreCase);
}
