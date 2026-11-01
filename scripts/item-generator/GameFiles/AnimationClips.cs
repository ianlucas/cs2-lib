/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

using System.Text.Json;
using ValveResourceFormat;
using ValveResourceFormat.ResourceTypes.ModelAnimation;
using ValveResourceFormat.ResourceTypes.ModelAnimation2;

namespace ItemGenerator.GameFiles;

/// <summary>
/// Decodes the game's animation clips (<c>.vnmclip</c>): whole, as the three.js
/// <c>AnimationClip</c> JSON a clip is published as, or one frame of one, as the pose a pet model
/// is published in.
/// </summary>
/// <remarks>
/// <para>
/// A clip is authored against a SKELETON, not a model: its tracks are parallel to the skeleton's
/// <c>m_boneIDs</c>, and every model rigged to that skeleton plays it, matched by bone name. So a
/// published clip carries every bone and is pruned against nothing a single model says. A model
/// needn't have every bone of its skeleton (an agent lacks the weapon bones of the character
/// skeleton), and a consumer skips the tracks it has no node for.
/// </para>
/// <para>
/// Values are parent-relative local transforms in RAW MODEL SPACE (inches, Z-up), the space every
/// published .glb's joints are in (see InventoryPose), so they drop into the joints verbatim.
/// </para>
/// <para>
/// An ADDITIVE clip (<c>m_bIsAdditive</c>, as <c>t_idle_layer01</c> is) is compiled to deltas from
/// its reference frame, and the decoded stream already holds them: rotation <c>conj(ref) * frame</c>,
/// translation <c>frame - ref</c>, which is the convention three.js's
/// <c>AdditiveAnimationBlendMode</c> applies. It is written as decoded, so it layers over whatever
/// pose the joints already hold.
/// </para>
/// </remarks>
public static class AnimationClips
{
    // How close two keys must be to count as one: a constant track is written as a single key, and
    // an additive track at the identity throughout is dropped. A rotation also matches its
    // negation, the same rotation.
    private const double RotationEpsilon = 1e-5;
    private const double TranslationEpsilon = 1e-4;

    // The precision a published key is rounded to. A unit quaternion to 1e-5 and an inch to 1e-3
    // (25 micrometres) are both far below anything that renders.
    private const int RotationDecimals = 5;
    private const int TranslationDecimals = 3;

    private const string ClipExtension = ".vnmclip";

    // three.js's NormalAnimationBlendMode and AdditiveAnimationBlendMode.
    private const int NormalBlendMode = 2500;
    private const int AdditiveBlendMode = 2501;

    private static readonly double[] IdentityRotation = [0, 0, 0, 1];
    private static readonly double[] IdentityTranslation = [0, 0, 0];

    private static readonly Dictionary<string, List<string>> cachedBoneIds = new(
        StringComparer.Ordinal
    );

    private sealed record DecodedClip(
        string Skeleton,
        int NumFrames,
        float Duration,
        bool IsAdditive,
        List<string> Bones,
        FrameBone[][] Frames
    );

    /// <summary>
    /// The name a clip is published under: its path below <c>Config.AnimationClipsPrefix</c>,
    /// without the extension. A leaf alone is not unique (<c>viewmodel/chicken/chick_idle01</c> is
    /// a different clip from <c>chicken/world/chick_idle01</c>), and the path is stable.
    /// </summary>
    /// <remarks>
    /// The absolute copy the compiler keeps of an additive clip's source,
    /// <c>t_idle_layer01.vnmclip+non_additive.vnmclip</c>, is named
    /// <c>t_idle_layer01+non_additive</c>.
    /// </remarks>
    public static string GetName(string clipPath)
    {
        if (
            !clipPath.StartsWith(Config.AnimationClipsPrefix, StringComparison.Ordinal)
            || !clipPath.EndsWith(ClipExtension, StringComparison.Ordinal)
        )
            throw new InvalidOperationException(
                $"Clip '{clipPath}' is not a {ClipExtension} under {Config.AnimationClipsPrefix}."
            );
        return clipPath[Config.AnimationClipsPrefix.Length..^ClipExtension.Length]
            .Replace($"{ClipExtension}+", "+", StringComparison.Ordinal);
    }

    /// <summary>
    /// A clip as three.js's <c>AnimationClip.toJSON()</c> writes one, ready for
    /// <c>AnimationClip.parse</c>.
    /// </summary>
    /// <param name="clipPath">The clip's resource path, e.g.
    /// <c>animation/anims/chicken/world/chick_idle01.vnmclip</c>.</param>
    /// <returns>The clip's name (see <see cref="GetName"/>), the name of its skeleton (see
    /// <c>Config.AnimationSkeletonNames</c>), and the UTF-8 JSON.</returns>
    public static (string Name, string Skeleton, byte[] Json) Serialize(
        ItemGeneratorContext ctx,
        string clipPath
    )
    {
        var clip = Decode(ctx, clipPath);
        var name = GetName(clipPath);
        if (!Config.AnimationSkeletonNames.TryGetValue(clip.Skeleton, out var skeleton))
            throw new InvalidOperationException(
                $"Clip '{clipPath}' is authored against '{clip.Skeleton}', which has no name in "
                    + "Config.AnimationSkeletonNames."
            );

        var tracks = new List<object>();
        for (var bone = 0; bone < clip.Bones.Count; bone++)
        {
            var rotations = clip
                .Frames.Select(frame =>
                {
                    var q = frame[bone].Angle;
                    return new double[] { q.X, q.Y, q.Z, q.W };
                })
                .ToList();
            var translations = clip
                .Frames.Select(frame =>
                {
                    var p = frame[bone].Position;
                    return new double[] { p.X, p.Y, p.Z };
                })
                .ToList();
            AddTrack(tracks, clip, $"{clip.Bones[bone]}.quaternion", "quaternion", rotations);
            AddTrack(tracks, clip, $"{clip.Bones[bone]}.position", "vector", translations);

            // No clip the game ships scales a bone, so the format carries no scale track. A clip
            // that does fails here rather than play without it.
            var unscaled = clip.IsAdditive ? 0 : 1;
            if (clip.Frames.Any(frame => frame[bone].Scale != unscaled))
                throw new InvalidOperationException(
                    $"Clip '{clipPath}' scales '{clip.Bones[bone]}', which a published clip does not carry."
                );
        }

        var json = new Dictionary<string, object?> { ["name"] = name };
        // Keys are written at frame indices, which three.js divides by `fps`. A single frame is a
        // pose: one key, held, with no length and so no rate.
        if (clip.NumFrames == 1)
            json["duration"] = 0;
        else
        {
            if (clip.Duration <= 0)
                throw new InvalidOperationException(
                    $"Clip '{clipPath}' has {clip.NumFrames} frames and no duration."
                );
            // Clips are authored at a whole frame rate and the stored duration is that rate's,
            // rounded, so a rate within rounding of a whole one is written whole, which lands the
            // last key on the exact duration. A few are not (a C4 turn, the default knife's
            // swings), and take the rate their stored duration implies.
            var frames = clip.NumFrames - 1;
            var duration = (double)clip.Duration;
            var whole = Math.Round(frames / duration);
            var fps = Math.Abs(whole * duration - frames) <= 0.01 ? whole : frames / duration;
            json["duration"] = frames / fps;
            json["fps"] = fps;
        }
        json["blendMode"] = clip.IsAdditive ? AdditiveBlendMode : NormalBlendMode;
        // three.js writes userData as a JSON string, and parses it back.
        json["userData"] = JsonSerializer.Serialize(new { skeleton });
        json["tracks"] = tracks;
        return (name, skeleton, JsonSerializer.SerializeToUtf8Bytes(json));
    }

    /// <summary>
    /// The first frame of a clip, as a pose: bone name -&gt; { translation, rotation }, in raw model
    /// space, the shape item-generator-pose.ts writes into a .glb's joints.
    /// </summary>
    public static Dictionary<string, object?> ReadPose(ItemGeneratorContext ctx, string clipPath)
    {
        var clip = Decode(ctx, clipPath);
        // An additive clip's frame is a delta, which posed as a transform would collapse the bones.
        if (clip.IsAdditive)
            throw new InvalidOperationException(
                $"Clip '{clipPath}' is additive, so its frames are not poses."
            );

        var pose = new Dictionary<string, object?>();
        for (var bone = 0; bone < clip.Bones.Count; bone++)
        {
            var frame = clip.Frames[0][bone];
            if (frame.Scale != 1)
                throw new InvalidOperationException(
                    $"Clip '{clipPath}' scales '{clip.Bones[bone]}', which a pose does not carry."
                );
            pose[clip.Bones[bone]] = new Dictionary<string, object?>
            {
                ["translation"] = new double[]
                {
                    frame.Position.X,
                    frame.Position.Y,
                    frame.Position.Z,
                },
                ["rotation"] = new double[]
                {
                    frame.Angle.X,
                    frame.Angle.Y,
                    frame.Angle.Z,
                    frame.Angle.W,
                },
            };
        }
        return pose;
    }

    // Appends a bone's track for one property. A track that holds one value throughout is written
    // as that single key, and in an additive clip a track at the identity throughout is left out,
    // since it leaves the pose below as it is.
    private static void AddTrack(
        List<object> tracks,
        DecodedClip clip,
        string name,
        string type,
        List<double[]> keys
    )
    {
        var isRotation = type == "quaternion";
        var epsilon = isRotation ? RotationEpsilon : TranslationEpsilon;
        var decimals = isRotation ? RotationDecimals : TranslationDecimals;

        var constant = keys.All(key => IsSame(key, keys[0], epsilon, isRotation));
        if (
            clip.IsAdditive
            && constant
            && IsSame(
                keys[0],
                isRotation ? IdentityRotation : IdentityTranslation,
                epsilon,
                isRotation
            )
        )
            return;

        var kept = constant ? keys.Take(1).ToList() : keys;
        tracks.Add(
            new
            {
                name,
                type,
                times = Enumerable.Range(0, kept.Count).ToList(),
                values = kept.SelectMany(key => key.Select(value => Round(value, decimals)))
                    .ToList(),
            }
        );
    }

    private static bool IsSame(double[] a, double[] b, double epsilon, bool isRotation)
    {
        var same = true;
        var negated = isRotation;
        for (var k = 0; k < a.Length; k++)
        {
            if (Math.Abs(a[k] - b[k]) > epsilon)
                same = false;
            if (Math.Abs(a[k] + b[k]) > epsilon)
                negated = false;
        }
        return same || negated;
    }

    // Rounds half away from zero, as JavaScript's toFixed does, and never writes -0.
    private static double Round(double value, int decimals)
    {
        var rounded = Math.Round(value, decimals, MidpointRounding.AwayFromZero);
        return rounded == 0 ? 0 : rounded;
    }

    private static DecodedClip Decode(ItemGeneratorContext ctx, string clipPath)
    {
        using var resource = ReadResource(ctx, clipPath);
        if (resource.DataBlock is not AnimationClip clip)
            throw new InvalidOperationException($"'{clipPath}' is not an animation clip.");

        var bones = ReadBoneIds(ctx, clip.SkeletonName);
        // A track array that has drifted out of step with the skeleton would silently move the wrong
        // bones, so mismatched lengths fail rather than decode partially.
        if (clip.TrackCompressionSettings.Length != bones.Count)
            throw new InvalidOperationException(
                $"Clip '{clipPath}' has {clip.TrackCompressionSettings.Length} tracks for "
                    + $"{bones.Count} bones of '{clip.SkeletonName}'."
            );

        var frames = new FrameBone[clip.NumFrames][];
        for (var frame = 0; frame < clip.NumFrames; frame++)
        {
            frames[frame] = new FrameBone[bones.Count];
            clip.ReadFrame(frame, frames[frame]);
        }
        return new DecodedClip(
            clip.SkeletonName,
            clip.NumFrames,
            clip.Duration,
            clip.IsAdditive,
            bones,
            frames
        );
    }

    private static List<string> ReadBoneIds(ItemGeneratorContext ctx, string skeletonPath)
    {
        if (cachedBoneIds.TryGetValue(skeletonPath, out var cached))
            return cached;
        using var resource = ReadResource(ctx, skeletonPath);
        if (
            MetadataExtractor.ConvertKV3ToObject(MetadataExtractor.GetRootKvObject(resource))
                is not Dictionary<string, object?> skeleton
            || skeleton.GetValueOrDefault("m_boneIDs") is not List<object?> boneIds
        )
            throw new InvalidOperationException($"Skeleton '{skeletonPath}' has no bones.");
        cachedBoneIds[skeletonPath] = [.. boneIds.Select(id => id?.ToString() ?? "")];
        return cachedBoneIds[skeletonPath];
    }

    private static Resource ReadResource(ItemGeneratorContext ctx, string path)
    {
        var vpkPath = path + "_c";
        var entry =
            ctx.VpkPackage?.FindEntry(vpkPath)
            ?? throw new FileNotFoundException($"'{vpkPath}' is not in the game files.");
        ctx.VpkPackage.ReadEntry(entry, out var data);
        var resource = new Resource { FileName = vpkPath };
        resource.Read(new MemoryStream(data));
        return resource;
    }
}
