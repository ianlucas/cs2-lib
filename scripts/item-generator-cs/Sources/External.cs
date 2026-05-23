using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace ItemGenerator.Sources;

public static class External
{
    private static readonly HttpClient Http = new();
    // External JSON uses lowercase keys (e.g. "contains", "original"); match them
    // case-insensitively so records without explicit [JsonPropertyName] still bind.
    private static readonly JsonSerializerOptions ExternalJsonOptions = new() { PropertyNameCaseInsensitive = true };
    private static readonly Dictionary<string, string> ExternalUrls = new()
    {
        ["collectible"] = "https://raw.githubusercontent.com/ByMykel/CSGO-API/refs/heads/main/public/api/en/collectibles.json",
        ["container"] = "https://raw.githubusercontent.com/ByMykel/CSGO-API/refs/heads/main/public/api/en/crates.json",
        ["keychain"] = "https://raw.githubusercontent.com/ByMykel/CSGO-API/refs/heads/main/public/api/en/sticker_slabs.json"
    };

    private record CacheMetadata(string? Etag, string? LastModified, string Url);
    private record SourceEntry(string Image, SourceEntryOriginal Original);
    private record SourceEntryOriginal([property: JsonPropertyName("image_inventory")] string ImageInventory);
    private record CrateEntry(
        List<CrateItem> Contains,
        [property: JsonPropertyName("contains_rare")] List<CrateItem> ContainsRare,
        CrateOriginal Original);
    private record CrateItem(string Name, string Id);
    private record CrateOriginal([property: JsonPropertyName("item_name")] string ItemName);

    private static async Task<T> FetchCachedExternalJson<T>(string key)
    {
        var url = ExternalUrls[key];
        var dataPath = Path.Combine(Config.ItemGeneratorCacheDir, $"{key}.json");
        var metadataPath = Path.Combine(Config.ItemGeneratorCacheDir, $"{key}.metadata.json");
        Directory.CreateDirectory(Config.ItemGeneratorCacheDir);

        CacheMetadata? metadata = null;
        if (File.Exists(metadataPath))
        {
            var raw = await File.ReadAllTextAsync(metadataPath);
            metadata = JsonSerializer.Deserialize<CacheMetadata>(raw);
        }

        var request = new HttpRequestMessage(HttpMethod.Get, url);
        if (metadata?.Etag != null)
            request.Headers.TryAddWithoutValidation("If-None-Match", metadata.Etag);
        if (metadata?.LastModified != null)
            request.Headers.TryAddWithoutValidation("If-Modified-Since", metadata.LastModified);

        try
        {
            var response = await Http.SendAsync(request);
            if (response.StatusCode == System.Net.HttpStatusCode.NotModified && File.Exists(dataPath))
                return JsonSerializer.Deserialize<T>(await File.ReadAllTextAsync(dataPath), ExternalJsonOptions)!;

            response.EnsureSuccessStatusCode();
            var body = await response.Content.ReadAsStringAsync();
            await File.WriteAllTextAsync(dataPath, body);

            var nextMetadata = new CacheMetadata(
                response.Headers.ETag?.Tag,
                response.Content.Headers.LastModified?.ToString("R"),
                url);
            await File.WriteAllTextAsync(metadataPath, JsonSerializer.Serialize(nextMetadata));
            return JsonSerializer.Deserialize<T>(body, ExternalJsonOptions)!;
        }
        catch
        {
            if (File.Exists(dataPath))
                return JsonSerializer.Deserialize<T>(await File.ReadAllTextAsync(dataPath), ExternalJsonOptions)!;
            throw;
        }
    }

    private static int? ResolveContainerItemId(Dictionary<string, int> nameToId, CrateItem item)
    {
        if (nameToId.TryGetValue(item.Id, out var id)) return id;
        if (nameToId.TryGetValue(item.Id.Replace("_st", ""), out id)) return id;
        if (nameToId.TryGetValue(item.Name, out id)) return id;
        if (nameToId.TryGetValue(item.Name.Replace("★ ", ""), out id)) return id;
        return null;
    }

    public static async Task PopulateContainerContents(string itemName, List<int> contents, Dictionary<int, string> itemNames)
    {
        var crates = await FetchCachedExternalJson<List<CrateEntry>>("container");
        var crate = crates.FirstOrDefault(e => e.Original?.ItemName == itemName);
        if (crate == null) return;

        var nameToId = new Dictionary<string, int>();
        foreach (var (id, name) in itemNames)
            nameToId[name] = id;

        foreach (var item in crate.Contains)
        {
            var id = ResolveContainerItemId(nameToId, item);
            if (id.HasValue && !contents.Contains(id.Value))
                contents.Add(id.Value);
        }
    }

    public static async Task PopulateContainerSpecials(string itemName, List<int> specials, Dictionary<int, string> itemNames)
    {
        var crates = await FetchCachedExternalJson<List<CrateEntry>>("container");
        var crate = crates.FirstOrDefault(e => e.Original?.ItemName == itemName);
        if (crate == null) return;

        var nameToId = new Dictionary<string, int>();
        foreach (var (id, name) in itemNames)
            nameToId[name] = id;

        foreach (var item in crate.ContainsRare)
        {
            var id = ResolveContainerItemId(nameToId, item);
            if (id.HasValue && !specials.Contains(id.Value))
                specials.Add(id.Value);
        }
    }

    public static async Task<string?> FindFallbackImage(string source, string imagePath)
    {
        var entries = await FetchCachedExternalJson<List<SourceEntry>>(source);
        var normalizedPath = imagePath.ToLowerInvariant();
        var entry = entries.FirstOrDefault(e => e.Original?.ImageInventory?.ToLowerInvariant() == normalizedPath);
        if (entry == null) return null;

        try
        {
            var response = await Http.GetAsync(entry.Image);
            if (response.StatusCode == System.Net.HttpStatusCode.NotFound) return null;
            response.EnsureSuccessStatusCode();

            var filename = $"{Path.GetFileName(imagePath)}.png";
            var localPath = Path.Combine(Config.StaticImagesDir, filename);
            var bytes = await response.Content.ReadAsByteArrayAsync();
            await File.WriteAllBytesAsync(localPath, bytes);
            return localPath;
        }
        catch
        {
            return null;
        }
    }
}
