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
}
