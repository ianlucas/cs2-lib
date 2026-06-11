using System.Text.RegularExpressions;
using SteamKit2;
using SteamKit2.CDN;

namespace ItemGenerator.Depot;

/// <summary>
/// Thrown when the depot already matches the recorded manifest, signalling a
/// clean no-op so the run can exit successfully instead of failing.
/// </summary>
public sealed class DepotUpToDateException(string message) : Exception(message);

public static class DepotDownloaderService
{
    private const string DefaultBranch = "public";

    public static async Task<string> FetchLatestManifestId()
    {
        using var session = new SteamSession();
        await session.ConnectAnonymous();
        var manifestId = await session.GetDepotManifestId(Config.AppId, Config.AssetsDepotId, DefaultBranch);
        return manifestId.ToString();
    }

    public static async Task DownloadFiles(List<string> files, string outputDir)
    {
        if (files.Count == 0) return;
        using var session = new SteamSession();
        await session.ConnectAnonymous();
        await session.DownloadDepotFiles(Config.AppId, Config.AssetsDepotId, DefaultBranch, files, outputDir);
    }

    public static async Task DownloadFileList(string fileListPath, string outputDir)
    {
        if (!File.Exists(fileListPath)) return;
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
            throw new DepotUpToDateException($"Depot {Config.AssetsDepotId} is already up to date.");

        // Defer the write until the run finishes successfully (see CommitAssetsManifest)
        // so a failed download/processing run doesn't mark this depot version as
        // processed and skip the next download.
        ctx.AssetsManifestId = latestManifest;
    }

    public static async Task CommitAssetsManifest(ItemGeneratorContext ctx)
    {
        if (ctx.AssetsManifestId == null) return;
        await File.WriteAllTextAsync(Config.AssetsManifestPath, ctx.AssetsManifestId);
    }

    public static async Task EnsureItemDefinitionPackages(ItemGeneratorContext ctx)
    {
        Directory.CreateDirectory(Config.WorkdirDir);
        if (ctx.Mode == ItemGeneratorMode.Full) return;

        await DownloadFileList(Config.DepotFileListPath, Config.WorkdirDir);
    }
}
