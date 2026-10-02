/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

using System.Text.RegularExpressions;
using SteamKit2;
using SteamKit2.CDN;
using static ItemGenerator.Logging;

namespace ItemGenerator.Depot;

/// <summary>
/// Thrown when the depot already matches the recorded manifest, signalling a
/// clean no-op so the run can exit successfully instead of failing.
/// </summary>
public sealed class DepotUpToDateException(string message) : Exception(message);

public static class DepotDownloaderService
{
    private const string DefaultBranch = "public";

    private const int MaxAttempts = 5;

    // Each attempt opens a fresh session, so a retry lands on another Steam server. Downloads
    // skip files already on disk, so a retried download resumes where the last one stopped.
    private static async Task WithSession(Func<SteamSession, Task> action)
    {
        for (var attempt = 1; ; attempt++)
        {
            try
            {
                using var session = new SteamSession();
                await session.ConnectAnonymous();
                await action(session);
                return;
            }
            catch (Exception ex) when (attempt < MaxAttempts)
            {
                var delay = TimeSpan.FromSeconds(5 * Math.Pow(2, attempt - 1));
                Log(
                    $"Steam attempt {attempt}/{MaxAttempts} failed ({ex.Message}); retrying in {delay.TotalSeconds:F0}s..."
                );
                await Task.Delay(delay);
            }
        }
    }

    public static async Task<string> FetchLatestManifestId()
    {
        var manifestId = 0UL;
        await WithSession(async session =>
        {
            manifestId = await session.GetDepotManifestId(
                Config.AppId,
                Config.AssetsDepotId,
                DefaultBranch
            );
        });
        return manifestId.ToString();
    }

    public static async Task DownloadFiles(List<string> files, string outputDir)
    {
        // Full mode bulk-fetches the pak set up front, so most later requests name archives
        // that are already on disk; those need no Steam session at all. Prefix filters never
        // match a file here and always go to the depot manifest.
        files = [.. files.Where(file => !File.Exists(Path.Combine(outputDir, file)))];
        if (files.Count == 0)
            return;
        await WithSession(session =>
            session.DownloadDepotFiles(
                Config.AppId,
                Config.AssetsDepotId,
                DefaultBranch,
                files,
                outputDir
            )
        );
    }

    public static async Task DownloadFileList(string fileListPath, string outputDir)
    {
        if (!File.Exists(fileListPath))
            return;
        var files = (await File.ReadAllLinesAsync(fileListPath))
            .Where(l => !string.IsNullOrWhiteSpace(l))
            .ToList();
        await DownloadFiles(files, outputDir);
    }

    public static async Task SyncAssetsManifest(ItemGeneratorContext ctx)
    {
        var currentManifest = File.Exists(Config.AssetsManifestPath)
            ? (await File.ReadAllTextAsync(Config.AssetsManifestPath)).Trim()
            : "";

        var latestManifest = await FetchLatestManifestId();
        if (!Config.IsForceMode() && currentManifest == latestManifest)
            throw new DepotUpToDateException(
                $"Depot {Config.AssetsDepotId} is already up to date."
            );

        // Defer the write until the run finishes successfully (see CommitAssetsManifest)
        // so a failed download/processing run doesn't mark this depot version as
        // processed and skip the next download.
        ctx.AssetsManifestId = latestManifest;
    }

    public static async Task CommitAssetsManifest(ItemGeneratorContext ctx)
    {
        if (ctx.AssetsManifestId == null)
            return;
        await File.WriteAllTextAsync(Config.AssetsManifestPath, ctx.AssetsManifestId);
    }

    public static async Task EnsureItemDefinitionPackages(ItemGeneratorContext ctx)
    {
        Directory.CreateDirectory(Config.WorkdirDir);
        if (ctx.SourceMode == Cs2SourceMode.InstalledGame)
            return;

        await DownloadFileList(Config.DepotFileListPath, Config.WorkdirDir);

        // Full regenerates every model/material/texture. Their archives are discovered
        // chicken-and-egg (a model's archive must be read to learn its materials, whose
        // archives reveal textures, ...), so the needed set can't be computed up front.
        // Bulk-fetch the whole pak set; DownloadFiles skips archives already on disk.
        // Model export also reads shaders to unpack material channels: VRF follows gameinfo.gi's
        // search paths to each mod's shaders_vulkan VPK (csgo_character.vfx lives in csgo_core).
        if (ctx.Mode == ItemGeneratorMode.Full)
            await DownloadFiles(
                [
                    "game/csgo/pak01_",
                    "game/csgo/gameinfo.gi",
                    "game/csgo/shaders_vulkan_",
                    "game/csgo_core/shaders_vulkan_",
                    "game/core/shaders_vulkan_",
                ],
                Config.WorkdirDir
            );
    }
}
