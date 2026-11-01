/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

using ItemGenerator.GameFiles;
using static ItemGenerator.Logging;

namespace ItemGenerator;

// Every animation clip the game ships (under Config.AnimationClipsPrefix), published beside the
// models as three.js AnimationClip JSON under /animations/, content-addressed like every other
// asset. No model carries a clip: an agent and a pet ship posed (see InventoryPose and
// PetModelData.GetPoseClip), and a consumer finds a clip by name through
// src/model-animations.ts, which these entries become.
public static partial class AssetProcessor
{
    private const string CompiledClipExtension = ".vnmclip_c";

    private static void ExportModelAnimations(ItemGeneratorContext ctx)
    {
        var clipPaths = (ctx.VpkPackage?.Entries?.GetValueOrDefault("vnmclip_c") ?? [])
            .Select(entry => entry.GetFullPath())
            .Where(path => path.StartsWith(Config.AnimationClipsPrefix, StringComparison.Ordinal))
            .Select(path => path[..^"_c".Length])
            .Order(StringComparer.Ordinal)
            .ToList();
        if (clipPaths.Count == 0)
            throw new InvalidOperationException(
                $"No {CompiledClipExtension} under {Config.AnimationClipsPrefix} in the game files."
            );

        Log($"Exporting {FormatCount(clipPaths.Count, "animation clip")}...");
        var outDir = Path.Combine(Config.OutputDir, "animations");
        Directory.CreateDirectory(outDir);
        // The CDN folder is flat, so a name's folders become dots in its filename. No clip path
        // has a dot of its own, but two names meeting in one filename would overwrite each other.
        var stems = new Dictionary<string, string>(StringComparer.Ordinal);
        var exported = 0;
        var lastMilestone = 0;
        foreach (var clipPath in clipPaths)
        {
            var (name, skeleton, json) = AnimationClips.Serialize(ctx, clipPath);
            var stem = name.Replace('/', '.').Replace('+', '.');
            if (!stems.TryAdd(stem, name))
                throw new InvalidOperationException(
                    $"Clips '{stems[stem]}' and '{name}' would both be published as '{stem}'."
                );
            var filename = $"{stem}_{ContentVersion.HashBytes(json)}.json";
            File.WriteAllBytes(Path.Combine(outDir, filename), json);
            ctx.ModelAnimations[name] = new ModelAnimation($"/animations/{filename}", skeleton);
            LogProgress(ref exported, ref lastMilestone, clipPaths.Count);
        }
    }
}
