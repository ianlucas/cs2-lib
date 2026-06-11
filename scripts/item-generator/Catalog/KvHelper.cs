using ValveKeyValue;

namespace ItemGenerator.Catalog;

public static class KvHelper
{
    public static KVObject? GetChild(KVObject? parent, string key)
    {
        if (parent == null) return null;
        try { return parent[key]; }
        catch { return null; }
    }

    public static string? GetString(KVObject? obj, string key)
    {
        if (obj == null) return null;
        try
        {
            var child = obj[key];
            if (child == null) return null;
            return child.ToString();
        }
        catch { return null; }
    }

    public static IEnumerable<KeyValuePair<string, KVObject>> GetChildren(KVObject? obj)
    {
        if (obj == null) return [];
        return obj;
    }

    public static Dictionary<string, string?> ToDictionary(KVObject? obj)
    {
        if (obj == null) return [];
        var result = new Dictionary<string, string?>();
        foreach (var child in obj)
            result[child.Key] = child.Value?.ToString();
        return result;
    }

    public static bool HasKey(KVObject? obj, string key)
    {
        if (obj == null) return false;
        try { return obj[key] != null; }
        catch { return false; }
    }

    // items_game.txt has multiple sections with the same key (e.g. 54x "sticker_kits", 126x "items").
    // GetChild returns only the first; this method merges all matching sections.
    public static IEnumerable<KeyValuePair<string, KVObject>> GetMergedSection(KVObject? parent, string key)
    {
        if (parent == null) yield break;
        foreach (var entry in parent)
        {
            if (string.Equals(entry.Key, key, StringComparison.OrdinalIgnoreCase))
            {
                foreach (var child in entry.Value)
                    yield return child;
            }
        }
    }

    public static KVObject? FindInMergedSection(KVObject? parent, string sectionKey, string childKey)
    {
        foreach (var entry in GetMergedSection(parent, sectionKey))
        {
            if (string.Equals(entry.Key, childKey, StringComparison.OrdinalIgnoreCase))
                return entry.Value;
        }
        return null;
    }
}
