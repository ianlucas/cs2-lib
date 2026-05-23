using System.Security.Cryptography;
using static ItemGenerator.Logging;

namespace ItemGenerator.Upload;

public static class CdnUploader
{
    private static readonly HttpClient Http = new();

    public static async Task UploadAssets(ItemGeneratorContext ctx)
    {
        var storageZone = Environment.GetEnvironmentVariable("STORAGE_ZONE");
        var accessKey = Environment.GetEnvironmentVariable("STORAGE_ACCESS_KEY");

        if (storageZone == null || accessKey == null)
        {
            Log("CDN credentials not configured; skipping upload.");
            return;
        }

        var baseUrl = $"https://ny.storage.bunnycdn.com/{storageZone}";
        var semaphore = new SemaphoreSlim(Config.CdnUploadConcurrency);
        var tasks = new List<Task>();
        var uploadCount = 0;

        foreach (var folder in new[] { "images", "materials", "textures", "models" })
        {
            var existingFiles = new HashSet<string>();
            try
            {
                var listRequest = new HttpRequestMessage(HttpMethod.Get, $"{baseUrl}/{folder}/");
                listRequest.Headers.Add("AccessKey", accessKey);
                var listResponse = await Http.SendAsync(listRequest);
                if (listResponse.IsSuccessStatusCode)
                {
                    var listJson = await listResponse.Content.ReadAsStringAsync();
                    var files = System.Text.Json.JsonSerializer.Deserialize<List<BunnyCdnFile>>(listJson) ?? [];
                    foreach (var file in files)
                    {
                        if (file.ObjectName != null)
                            existingFiles.Add(file.ObjectName);
                    }
                }
            }
            catch { }

            var assetsPath = Path.Combine(Config.OutputDir, folder);
            if (!Directory.Exists(assetsPath)) continue;

            foreach (var filePath in Directory.GetFiles(assetsPath))
            {
                var filename = Path.GetFileName(filePath);
                if (existingFiles.Contains(filename)) continue;

                uploadCount++;
                var cdnPath = $"/{folder}/{filename}";
                var localPath = filePath;
                tasks.Add(Task.Run(async () =>
                {
                    await semaphore.WaitAsync();
                    try
                    {
                        using var fileStream = File.OpenRead(localPath);
                        var request = new HttpRequestMessage(HttpMethod.Put, $"{baseUrl}{cdnPath}");
                        request.Headers.Add("AccessKey", accessKey);
                        request.Content = new StreamContent(fileStream);
                        var response = await Http.SendAsync(request);
                        response.EnsureSuccessStatusCode();
                    }
                    finally { semaphore.Release(); }
                }));
            }
        }

        Log($"Uploading {FormatCount(uploadCount, "new CDN asset")}...");
        await Task.WhenAll(tasks);
        Log($"Uploaded {FormatCount(uploadCount, "new CDN asset")}.");
    }

    private record BunnyCdnFile(
        string? ObjectName,
        string? Path,
        string? Checksum);
}
