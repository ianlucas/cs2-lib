/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

using ValveResourceFormat.ResourceTypes;

namespace ItemGenerator.GameFiles;

/// <summary>
/// What a pet model carries that the model data JSON does not already say in a usable form.
/// </summary>
/// <remarks>
/// <para>
/// A pet's individual look comes from the model's own keyvalues, <c>chicken_metadata</c>, which the
/// model data already passes through verbatim under <c>m_modelInfo.m_keyValueText</c>: the shader
/// attributes a seed feeds (<c>matparams</c>) and the body proportions it blends
/// (<c>procedural_geometry_poses</c>).
/// </para>
/// <para>
/// Two things are left for this class. The proportions blend between pose SEQUENCES embedded in the
/// model, so those have to survive the animation filter. And a pet's colour variant is a material
/// GROUP picked by the instance's style, which the model data names only by game resource path.
/// </para>
/// </remarks>
public static class PetModelData
{
    /// <summary>
    /// The animations a pet's .glb keeps: its procedural pose sequences and its graph's idle clips.
    /// </summary>
    public static HashSet<string> GetAnimationFilter(Model model)
    {
        var filter = new HashSet<string>(StringComparer.Ordinal);
        filter.UnionWith(
            ReadPoseSequences(
                MetadataExtractor.ConvertKV3ToObject(model.KeyValues) as Dictionary<string, object?>
            )
        );

        if (
            MetadataExtractor.ConvertKV3ToObject(model.Data) is Dictionary<string, object?> data
            && data.GetValueOrDefault("m_animGraph2Refs") is List<object?> graphRefs
        )
        {
            foreach (var graphRef in graphRefs.OfType<Dictionary<string, object?>>())
            {
                if (
                    graphRef.GetValueOrDefault("m_hGraph") is string graph
                    && Config.PetClipsByGraph.TryGetValue(
                        NormalizeResourcePath(graph).ToLowerInvariant(),
                        out var clips
                    )
                )
                    filter.UnionWith(clips);
            }
        }

        return filter;
    }

    /// <summary>
    /// The pose sequences the model's body proportions blend between, from its keyvalues.
    /// </summary>
    public static List<string> ReadPoseSequences(Dictionary<string, object?>? keyValues)
    {
        var sequences = new List<string>();
        if (
            keyValues?.GetValueOrDefault("chicken_metadata")
                is not Dictionary<string, object?> metadata
            || metadata.GetValueOrDefault("procedural_geometry_poses")
                is not Dictionary<string, object?> poses
            || poses.GetValueOrDefault("characteristics") is not List<object?> characteristics
        )
            return sequences;

        foreach (var characteristic in characteristics.OfType<Dictionary<string, object?>>())
        {
            foreach (var key in new[] { "sequence_min", "sequence_max" })
            {
                if (
                    characteristic.GetValueOrDefault(key) is string { Length: > 0 } sequence
                    && !sequences.Contains(sequence)
                )
                    sequences.Add(sequence);
            }
        }
        return sequences;
    }

    /// <summary>
    /// The model's material groups in style order: index 0 is the default group, index N the group
    /// the game selects for style N. Each entry lists that group's materials by game resource path,
    /// positionally matching the default group's.
    /// </summary>
    /// <returns>Null for a model with nothing to choose between.</returns>
    public static List<List<string>>? ReadStyles(Dictionary<string, object?> modelData)
    {
        if (modelData.GetValueOrDefault("m_materialGroups") is not List<object?> groups)
            return null;

        var byName = new Dictionary<string, List<string>>(StringComparer.Ordinal);
        foreach (var group in groups.OfType<Dictionary<string, object?>>())
        {
            if (
                group.GetValueOrDefault("m_name") is not string name
                || group.GetValueOrDefault("m_materials") is not List<object?> materials
            )
                continue;
            byName[name] = materials.OfType<string>().Select(NormalizeResourcePath).ToList();
        }

        if (byName.Count <= 1)
            return null;

        // The client maps style 0 to the default group and style N to the group called N, so the
        // names have to be exactly that for an index to mean a style. A model that names its groups
        // some other way fails the build rather than publishing a table that selects the wrong one.
        if (!byName.TryGetValue("default", out var defaultGroup))
            throw new InvalidOperationException("Pet model has material groups but no default.");
        var styles = new List<List<string>> { defaultGroup };
        for (var style = 1; style < byName.Count; style++)
        {
            if (
                !byName.TryGetValue(style.ToString(), out var group)
                || group.Count != defaultGroup.Count
            )
                throw new InvalidOperationException(
                    $"Pet model material groups are not default plus 1..{byName.Count - 1}."
                );
            styles.Add(group);
        }
        return styles;
    }

    private static string NormalizeResourcePath(string path) =>
        MaterialPaths.NormalizeMaterialResourcePath(path.Trim('"'));
}
