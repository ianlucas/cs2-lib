using SteamKit2;
using SteamKit2.CDN;

namespace ItemGenerator.Depot;

public sealed class SteamSession : IDisposable
{
    private readonly SteamClient _client;
    private readonly CallbackManager _callbacks;
    private readonly SteamUser _user;
    private readonly SteamApps _apps;
    private readonly SteamContent _content;
    private bool _isConnected;
    private bool _isLoggedOn;
    private readonly CancellationTokenSource _cts = new();

    public SteamSession()
    {
        _client = new SteamClient();
        _callbacks = new CallbackManager(_client);
        _user = _client.GetHandler<SteamUser>()!;
        _apps = _client.GetHandler<SteamApps>()!;
        _content = _client.GetHandler<SteamContent>()!;

        _callbacks.Subscribe<SteamClient.ConnectedCallback>(_ => _isConnected = true);
        _callbacks.Subscribe<SteamClient.DisconnectedCallback>(_ =>
        {
            _isConnected = false;
            _isLoggedOn = false;
        });
        _callbacks.Subscribe<SteamUser.LoggedOnCallback>(cb =>
        {
            _isLoggedOn = cb.Result == EResult.OK;
        });
    }

    public async Task ConnectAnonymous()
    {
        _client.Connect();
        await WaitFor(() => _isConnected);

        _user.LogOnAnonymous();
        await WaitFor(() => _isLoggedOn);
    }

    public async Task<ulong> GetDepotManifestId(uint appId, uint depotId, string branch)
    {
        var request = new SteamApps.PICSRequest(appId);
        var info = await _apps.PICSGetProductInfo(new List<SteamApps.PICSRequest> { request }, []);
        var appInfo = info.Results?.FirstOrDefault()?.Apps?.FirstOrDefault().Value;
        if (appInfo == null) throw new InvalidOperationException("Failed to get app info.");

        var depots = appInfo.KeyValues["depots"];
        var depot = depots[depotId.ToString()];
        var manifests = depot["manifests"];
        var gid = manifests[branch]?["gid"]?.Value;
        if (gid == null) throw new InvalidOperationException($"Manifest not found for depot {depotId} branch {branch}.");
        return ulong.Parse(gid);
    }

    public async Task DownloadDepotFiles(uint appId, uint depotId, string branch,
        List<string> fileFilter, string outputDir)
    {
        var manifestId = await GetDepotManifestId(appId, depotId, branch);

        var depotKey = await _apps.GetDepotDecryptionKey(depotId, appId);
        if (depotKey.Result != EResult.OK)
            throw new InvalidOperationException($"Failed to get depot key: {depotKey.Result}");

        var servers = await _content.GetServersForSteamPipe();
        if (servers == null || servers.Count == 0)
            throw new InvalidOperationException("No CDN servers available.");

        var server = servers.First();
        var cdnClient = new Client(_client);

        var manifestRequestCode = await _content.GetManifestRequestCode(depotId, appId, manifestId, branch);
        var manifest = await cdnClient.DownloadManifestAsync(depotId, manifestId,
            manifestRequestCode, server, depotKey.DepotKey);

        var normalizedFilter = fileFilter
            .Select(f => f.Replace('\\', '/'))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var filesToDownload = manifest.Files!
            .Where(f => f.FileName != null && normalizedFilter.Any(filter =>
                f.FileName.Replace('\\', '/').StartsWith(filter, StringComparison.OrdinalIgnoreCase) ||
                f.FileName.Replace('\\', '/').Equals(filter, StringComparison.OrdinalIgnoreCase)))
            .ToList();

        var totalFiles = filesToDownload.Count;
        var completedFiles = 0;
        var lastReportedStep = -1;
        var progressLock = new object();

        void ReportProgress(int completed)
        {
            if (totalFiles == 0) return;
            var percent = (int)(completed * 100L / totalFiles);
            var step = percent / 5;
            lock (progressLock)
            {
                if (step <= lastReportedStep) return;
                lastReportedStep = step;
                Console.WriteLine($"Downloaded {completed} of {totalFiles} files ({percent}%)");
            }
        }

        ReportProgress(0);

        var semaphore = new SemaphoreSlim(8);
        var tasks = filesToDownload.Select(async file =>
        {
            await semaphore.WaitAsync();
            try
            {
                var filePath = Path.Combine(outputDir, file.FileName!.Replace('\\', '/'));
                if (File.Exists(filePath)) return;

                Directory.CreateDirectory(Path.GetDirectoryName(filePath)!);
                using var fs = File.Create(filePath);

                foreach (var chunk in file.Chunks)
                {
                    var chunkBuffer = new byte[chunk.UncompressedLength];
                    await cdnClient.DownloadDepotChunkAsync(depotId, chunk, server, chunkBuffer, depotKey.DepotKey);
                    // Chunks are not enumerated in file-offset order, so seek to each
                    // chunk's offset before writing or the output gets scrambled.
                    fs.Seek((long)chunk.Offset, SeekOrigin.Begin);
                    fs.Write(chunkBuffer, 0, (int)chunk.UncompressedLength);
                }
            }
            finally
            {
                semaphore.Release();
                ReportProgress(Interlocked.Increment(ref completedFiles));
            }
        });

        await Task.WhenAll(tasks);
    }

    private async Task WaitFor(Func<bool> condition, int timeoutMs = 30000)
    {
        var sw = System.Diagnostics.Stopwatch.StartNew();
        while (!condition() && sw.ElapsedMilliseconds < timeoutMs)
        {
            _callbacks.RunWaitCallbacks(TimeSpan.FromMilliseconds(100));
            await Task.Delay(50);
        }
        if (!condition()) throw new TimeoutException("Steam connection timed out.");
    }

    public void Dispose()
    {
        _client.Disconnect();
        _cts.Dispose();
    }
}
