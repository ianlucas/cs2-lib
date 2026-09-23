/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

namespace ItemGenerator;

// Per-property WebP encode tiers for PATCH textures, the sixth tuning surface beside
// StickerTextureOptimization, WeaponTextureOptimization, GloveTextureOptimization,
// KeychainTextureOptimization and CharacterTextureOptimization. Same contract: this file owns POLICY,
// scripts/item-generator-webp.ts owns MEASUREMENT, and a property absent from Targets is never
// touched.
//
// SCOPE. A patch item's material (`patches/<case>/<name>.vmat`) is a csgo_character.vfx material
// published through the ordinary material pipeline, and its `g_tPatch0` binding is the artwork a
// consumer composites onto an agent (see docs/patches.md). The shader is shared with agents and glove
// arms, so the property name alone does not scope it: a material is admitted only under `/patches/`,
// the mirror of GloveTextureOptimization's `/models/shared/arms/`. CharacterTextureOptimization never
// sees these -- it tiers the textures embedded in an agent's .glb, not published materials.
//
// THE TIER RECORD IS GloveTextureTier, as it is for CharacterTextureOptimization, with `Kind`
// overridden so a manifest line names the family that chose it.
public static class PatchTextureOptimization
{
    public const string CharacterShader = "csgo_character.vfx";

    public static readonly IReadOnlyList<string> PatchPathSegments = ["/patches/"];

    private const string Patch = "patch";

    // ARTWORK -- 512x512 RGBA, RGB = embroidered artwork, A = the cut-out around its shape. Lossy q90,
    // the sticker artwork tier. There is deliberately NO LossyGuard: the 30 dB gate exists to catch
    // region masks whose values feed a lookup, and embroidery -- dense thread texture at the pixel
    // scale -- scores 27-29 dB at q90 while being visually indistinguishable from the source at 2x
    // zoom. The gate would send most patches back to lossless for no visible reason. Alpha stays
    // lossless (the encoder's default): a hard cut-out rings under a lossy encode, and at ~15% soft it
    // is not what the file's bytes are spent on. Measured: patch_howl 367 KB -> 98 KB,
    // patch_koi 352 KB -> 108 KB.
    private static readonly GloveTextureTier ArtworkTier = new()
    {
        Kind = Patch,
        Mode = GloveEncodeMode.Lossy,
        Quality = 90
    };

    // Every patch material binds its one artwork to all three slots. Absent on purpose:
    //   g_tPatchNBacking        the shared patch_backing_default, one file, and a patch material draws
    //                           it at BackingScale 0; an agent embeds its own backing in its .glb.
    //   g_tColor, g_tNormal     the shared patch_inspect model maps, one file each.
    //   g_tAmbientOcclusion,    engine defaults bound across the build.
    //   g_tMetalness
    public static readonly IReadOnlyDictionary<string, GloveTextureTier> Targets =
        new Dictionary<string, GloveTextureTier>(StringComparer.Ordinal)
        {
            ["g_tPatch0"] = ArtworkTier,
            ["g_tPatch1"] = ArtworkTier,
            ["g_tPatch2"] = ArtworkTier
        };

    // ---------------------------------------------------------------------------------------------
    // CLASSIFIER
    // ---------------------------------------------------------------------------------------------

    // Returns `resolved .vtex path -> tier` for the patch textures that qualify: every binding of the
    // texture, across the whole build, is a patch material binding it to a target property. One
    // foreign binding disqualifies it, exactly as in GloveTextureOptimization.
    //
    // `materialData` is keyed by resource path because the scope rule needs it. `resolveTexturePath`
    // maps a raw `.vtex` reference to the same resolved key the encode loop uses (null when it cannot
    // be resolved).
    public static Dictionary<string, GloveTextureTier> ResolveTextureTiers(
        IEnumerable<KeyValuePair<string, object?>> materialData,
        Func<string, string?> resolveTexturePath)
    {
        var tiers = new Dictionary<string, GloveTextureTier>(StringComparer.Ordinal);
        var foreign = new HashSet<string>(StringComparer.Ordinal);

        foreach (var (path, data) in materialData)
            Walk(data, contextName: null, IsPatchMaterial(path, data), tiers, foreign, resolveTexturePath);

        foreach (var path in foreign)
            tiers.Remove(path);
        return tiers;
    }

    private static bool IsPatchMaterial(string materialPath, object? data)
    {
        if (data is not Dictionary<string, object?> dict) return false;
        if (!dict.TryGetValue("m_shaderName", out var shader) || shader is not string name) return false;
        if (!string.Equals(name, CharacterShader, StringComparison.OrdinalIgnoreCase)) return false;
        var path = $"/{MaterialPaths.NormalizeMaterialResourcePath(materialPath).TrimStart('/')}";
        foreach (var segment in PatchPathSegments)
            if (path.Contains(segment, StringComparison.OrdinalIgnoreCase)) return true;
        return false;
    }

    private static void Walk(
        object? value,
        string? contextName,
        bool patchFamily,
        Dictionary<string, GloveTextureTier> tiers,
        HashSet<string> foreign,
        Func<string, string?> resolveTexturePath)
    {
        switch (value)
        {
            case string reference:
                if (!IsTextureReference(reference)) return;
                var resolved = resolveTexturePath(reference);
                if (resolved == null) return;
                if (patchFamily && contextName != null && Targets.TryGetValue(contextName, out var tier) &&
                    (!tiers.TryGetValue(resolved, out var seen) || ReferenceEquals(seen, tier)))
                    tiers[resolved] = tier;
                else
                    foreign.Add(resolved);
                return;

            case List<object?> list:
                foreach (var entry in list)
                    Walk(entry, contextName, patchFamily, tiers, foreign, resolveTexturePath);
                return;

            case Dictionary<string, object?> dict:
                // A texture-bearing node names its parameter with `m_name` (vmat) or `m_strName`
                // (vcompmat); the texture path sits under a sibling key.
                var name =
                    dict.TryGetValue("m_name", out var mName) && mName is string n1 && n1.Length > 0 ? n1 :
                    dict.TryGetValue("m_strName", out var mStrName) && mStrName is string n2 && n2.Length > 0 ? n2 :
                    contextName;
                foreach (var (key, child) in dict)
                    Walk(child, name ?? key, patchFamily, tiers, foreign, resolveTexturePath);
                return;
        }
    }

    private static bool IsTextureReference(string value) =>
        MaterialPaths.NormalizeMaterialResourcePath(value).EndsWith(".vtex", StringComparison.OrdinalIgnoreCase);
}
