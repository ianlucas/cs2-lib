/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

namespace ItemGenerator;

// Per-property WebP encode tiers for STICKER textures. Every texture in the pipeline is lossless by
// default (see item-generator-webp.ts); this is the one place that opts specific sticker textures
// into a smaller encoding. It is deliberately the sole tuning surface -- edit Targets, rebuild, done.
//
// SCOPE. Only the properties below are ever touched, and only textures reached through them. Each is
// a sticker-EXCLUSIVE material parameter (the "Sticker0" suffix), so keying on the parameter name is
// enough to stay on sticker textures and never touch a weapon/glove/character texture. A texture that
// ALSO feeds any non-target parameter is dropped (ExcludeShared) so a shared mask is never re-encoded.
//
// WHY EACH TIER (validated out of band against ../cs2-3d-viewer; see the branch follow-up notes):
//   g_tSticker0                lossy q90                 the visible artwork (color) -- safe, ~-63%.
//   g_tHoloSpectrumSticker0    lossy q90, -alpha, w>=1024 RGB view-angle gradient LUT; alpha is dead
//                              (strip it -- also dodges the "zero alpha blanks RGB" webp trap). Only
//                              the wide ones carry weight.
//   g_tSfxMaskSticker0         lossless, downscale <=512  holo mask that GATES the spectrum composite.
//                              RGB are three independent masks + live alpha; lossy shifts the composite
//                              (bad even at q95). High-entropy, so the only lever is a lossless downscale.
//   g_tNormalRoughnessSticker0 lossless, downscale <=512  RG=hemi-oct normal, B=roughness, A=self-illum.
//                              Lossy (even q95) facets the normal on glossy/metallic stickers; downscale
//                              keeps values exact (no faceting) while shedding spatial detail.
//
// NOT ported here: g_tColor (sticker paper backing) -- it is a generic base-color parameter shared with
// non-sticker materials, so it cannot be scoped to stickers by name alone; it was ~1 texture out of band.

public enum StickerEncodeMode
{
    Lossless,
    Lossy,
    NearLossless
}

// One encode tier. `Quality` is the VP8 quality for Lossy, or the near-lossless level for NearLossless
// (ignored for Lossless). `MinWidth` skips (leaves lossless) textures narrower than it. `MaxWidth`
// downscales (Lanczos, aspect-preserving) so the long side is at most it -- values stay exact, so it is
// the safe lever for data textures whose magnitudes matter but whose spatial detail can be reduced.
// `SmartSubsample` forces 4:4:4 (needed when RGB pack independent data rather than a color).
public sealed record StickerTextureTier(
    StickerEncodeMode Mode,
    int Quality = 100,
    bool StripAlpha = false,
    int? MinWidth = null,
    int? MaxWidth = null,
    bool SmartSubsample = false);

// The serializable descriptor emitted per encode job (null on a job means "default lossless", which is
// byte-identical to the untiered path -- so no non-sticker texture filename ever changes).
public sealed record StickerEncodeSpec(
    string Mode,
    int? Quality,
    bool? StripAlpha,
    int? MinWidth,
    int? MaxWidth,
    bool? SmartSubsample);

public static class StickerTextureOptimization
{
    // >>> TUNE HERE <<< property name -> encode tier.
    public static readonly IReadOnlyDictionary<string, StickerTextureTier> Targets =
        new Dictionary<string, StickerTextureTier>(StringComparer.Ordinal)
        {
            ["g_tSticker0"] = new(StickerEncodeMode.Lossy, Quality: 90),
            ["g_tHoloSpectrumSticker0"] = new(StickerEncodeMode.Lossy, Quality: 90, StripAlpha: true, MinWidth: 1024),
            ["g_tSfxMaskSticker0"] = new(StickerEncodeMode.Lossless, MaxWidth: 512),
            ["g_tNormalRoughnessSticker0"] = new(StickerEncodeMode.Lossless, MaxWidth: 512)
        };

    public static StickerEncodeSpec ToSpec(StickerTextureTier tier) => new(
        Mode: tier.Mode switch
        {
            StickerEncodeMode.Lossy => "lossy",
            StickerEncodeMode.NearLossless => "nearLossless",
            _ => "lossless"
        },
        Quality: tier.Mode == StickerEncodeMode.Lossless ? null : tier.Quality,
        StripAlpha: tier.StripAlpha ? true : null,
        MinWidth: tier.MinWidth,
        MaxWidth: tier.MaxWidth,
        SmartSubsample: tier.SmartSubsample ? true : null);

    // Walks every material's parsed data and returns `resolved .vtex path -> tier` for the sticker
    // textures that qualify. A texture qualifies only if it is bound to a target parameter AND to no
    // other parameter (mask safety), mirroring the out-of-band prototype's classifier.
    //
    // `resolveTexturePath` maps a raw `.vtex` reference to the same resolved key the encode loop uses
    // (returns null when it cannot be resolved). Material data nodes are the plain object graph the
    // metadata extractor produces: nested Dictionary<string, object?> / List<object?> / string.
    public static Dictionary<string, StickerTextureTier> ResolveTextureTiers(
        IEnumerable<object?> materialData,
        Func<string, string?> resolveTexturePath)
    {
        var targetProperty = new Dictionary<string, string>(StringComparer.Ordinal);
        var shared = new HashSet<string>(StringComparer.Ordinal);

        foreach (var data in materialData)
            Walk(data, contextName: null, targetProperty, shared, resolveTexturePath);

        // Any texture that also feeds a non-target parameter is unsafe to re-encode -- drop it.
        foreach (var path in shared)
            targetProperty.Remove(path);

        var tiers = new Dictionary<string, StickerTextureTier>(StringComparer.Ordinal);
        foreach (var (path, property) in targetProperty)
            tiers[path] = Targets[property];
        return tiers;
    }

    private static void Walk(
        object? value,
        string? contextName,
        Dictionary<string, string> targetProperty,
        HashSet<string> shared,
        Func<string, string?> resolveTexturePath)
    {
        switch (value)
        {
            case string reference:
                if (!IsTextureReference(reference)) return;
                var resolved = resolveTexturePath(reference);
                if (resolved == null) return;
                if (contextName != null && Targets.ContainsKey(contextName))
                {
                    if (!targetProperty.ContainsKey(resolved))
                        targetProperty[resolved] = contextName;
                }
                else
                {
                    shared.Add(resolved);
                }
                return;

            case List<object?> list:
                foreach (var entry in list)
                    Walk(entry, contextName, targetProperty, shared, resolveTexturePath);
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
                    Walk(child, name ?? key, targetProperty, shared, resolveTexturePath);
                return;
        }
    }

    private static bool IsTextureReference(string value) =>
        MaterialPaths.NormalizeMaterialResourcePath(value).EndsWith(".vtex", StringComparison.OrdinalIgnoreCase);
}
