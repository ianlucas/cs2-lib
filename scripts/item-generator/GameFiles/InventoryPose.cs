/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

using System.Globalization;
using ValveResourceFormat;

namespace ItemGenerator.GameFiles;

/// <summary>
/// Reads the pose the game renders an agent's inventory icon in.
/// </summary>
/// <remarks>
/// <para>
/// The pose is NOT an animation of the agent model — an agent's own sequences are only "eye_test",
/// "tools_preview" and "default". It is a standalone clip at
/// <c>animation/anims/ui_anims/inventory_pose/{ct,t}/&lt;name&gt;.vnmclip_c</c>, named per item by
/// items_game.txt's <c>inventory_image_data.pose_sequence</c>, and every agent's clip is authored
/// against one shared skeleton, <c>animation/skeletons/characters/worldmodel.vnmskel</c>.
/// </para>
/// <para>
/// Every one of those clips is two frames in which EVERY track is static —
/// <c>m_bIsRotationStatic</c> and <c>m_bIsTranslationStatic</c> are set on all 74 tracks and
/// <c>m_compressedPoseData</c> is empty — so a bone's transform is just its
/// <c>m_constantRotation</c> and the three <c>m_translationRange*.m_flRangeStart</c> values. There
/// is no animation stream to decompress. That is asserted rather than assumed: a clip that ever
/// stops being static fails the build instead of being read wrong.
/// </para>
/// <para>
/// Values are parent-relative local transforms in RAW MODEL SPACE (inches, Z-up), which is the space
/// the published .glb is in after item-generator-glb.ts hands the Source-to-glTF conversion back to
/// the root node. They therefore drop into the joint nodes verbatim. Bones are matched BY NAME: the
/// shared skeleton has 74 bones and an agent model has ~86, so the agent's own additions (jiggle
/// bones, twist bones, eyeballs) keep their rest transform.
/// </para>
/// </remarks>
public static class InventoryPose
{
    private const string SkeletonVpkPath = "animation/skeletons/characters/worldmodel.vnmskel_c";

    private static List<string>? cachedBoneIds;
    private static readonly Dictionary<string, Dictionary<string, object?>> cachedPoses = new(StringComparer.Ordinal);

    public static Dictionary<string, object?> Read(ItemGeneratorContext ctx, string team, string poseSequence)
    {
        var cacheKey = $"{team}/{poseSequence}";
        if (cachedPoses.TryGetValue(cacheKey, out var cached)) return cached;

        var pose = ReadUncached(ctx, team, poseSequence);
        cachedPoses[cacheKey] = pose;
        return pose;
    }

    private static Dictionary<string, object?> ReadUncached(
        ItemGeneratorContext ctx, string team, string poseSequence)
    {
        var pose = new Dictionary<string, object?>();
        var boneIds = ReadBoneIds(ctx);
        if (boneIds == null) return pose;

        var clipPath = $"animation/anims/ui_anims/inventory_pose/{team}/{poseSequence}.vnmclip_c";
        if (ReadResourceData(ctx, clipPath) is not { } clip) return pose;

        if (clip.GetValueOrDefault("m_trackCompressionSettings") is not List<object?> tracks)
            return pose;

        // A track array that has drifted out of step with the skeleton would silently pose the wrong
        // bones, so mismatched lengths fail rather than pose partially.
        if (tracks.Count != boneIds.Count)
            throw new InvalidOperationException(
                $"Inventory pose '{clipPath}' has {tracks.Count} tracks for {boneIds.Count} skeleton bones.");

        for (var index = 0; index < tracks.Count; index++)
        {
            if (tracks[index] is not Dictionary<string, object?> track) continue;
            if (!IsTrue(track.GetValueOrDefault("m_bIsRotationStatic")) ||
                !IsTrue(track.GetValueOrDefault("m_bIsTranslationStatic")))
                throw new InvalidOperationException(
                    $"Inventory pose '{clipPath}' track {index} ({boneIds[index]}) is animated, not static. " +
                    "These clips have always been static poses; reading one as a pose would be wrong.");

            var rotation = ParseFloats(track.GetValueOrDefault("m_constantRotation"), 4);
            var translation = new[]
            {
                RangeStart(track, "m_translationRangeX"),
                RangeStart(track, "m_translationRangeY"),
                RangeStart(track, "m_translationRangeZ")
            };
            if (rotation == null) continue;

            pose[boneIds[index]] = new Dictionary<string, object?>
            {
                ["translation"] = translation.Select(v => (object?)v).ToList(),
                ["rotation"] = rotation.Select(v => (object?)v).ToList()
            };
        }

        return pose;
    }

    private static List<string>? ReadBoneIds(ItemGeneratorContext ctx)
    {
        if (cachedBoneIds != null) return cachedBoneIds;
        if (ReadResourceData(ctx, SkeletonVpkPath) is not { } skeleton) return null;
        if (skeleton.GetValueOrDefault("m_boneIDs") is not List<object?> boneIds) return null;
        cachedBoneIds = [.. boneIds.Select(id => id?.ToString() ?? "")];
        return cachedBoneIds;
    }

    private static Dictionary<string, object?>? ReadResourceData(ItemGeneratorContext ctx, string vpkPath)
    {
        var entry = ctx.VpkPackage?.FindEntry(vpkPath);
        if (entry == null) return null;
        ctx.VpkPackage!.ReadEntry(entry, out var data);
        using var resource = new Resource();
        resource.Read(new MemoryStream(data));
        return MetadataExtractor.ConvertKV3ToObject(MetadataExtractor.GetRootKvObject(resource))
            as Dictionary<string, object?>;
    }

    private static double RangeStart(Dictionary<string, object?> track, string key) =>
        track.GetValueOrDefault(key) is Dictionary<string, object?> range
            ? ParseDouble(range.GetValueOrDefault("m_flRangeStart"))
            : 0;

    private static double[]? ParseFloats(object? value, int expected)
    {
        if (value is not List<object?> list || list.Count != expected) return null;
        return [.. list.Select(ParseDouble)];
    }

    private static double ParseDouble(object? value) =>
        double.TryParse(value?.ToString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed)
            ? parsed
            : 0;

    private static bool IsTrue(object? value) =>
        value?.ToString() is { } text &&
        (text.Equals("true", StringComparison.OrdinalIgnoreCase) || text == "1");
}
