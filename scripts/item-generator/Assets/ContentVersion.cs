using System.Security.Cryptography;
using System.Text;

namespace ItemGenerator;

// Content-addressed asset naming: every generated file embeds the first 8 hex chars of the
// SHA-256 of its *output* bytes in its filename, so a change in source data or in the pipeline
// itself always yields a new CDN URL (URLs are treated as immutable by edge and browser caches).
// Assets whose URLs must co-derive from one token — paint wear sets (base/_light/_medium/_heavy,
// see economy.ts getImage) and model .glb/.json pairs — combine their members' full hashes.
public static class ContentVersion
{
    public static string HashBytes(ReadOnlySpan<byte> bytes)
    {
        return Convert.ToHexStringLower(SHA256.HashData(bytes))[..8];
    }

    public static string HashFile(string path)
    {
        return HashFileFull(path)[..8];
    }

    public static string HashFileFull(string path)
    {
        using var fs = File.OpenRead(path);
        return Convert.ToHexStringLower(SHA256.HashData(fs));
    }

    public static string Combine(IEnumerable<string> hashes)
    {
        var sorted = hashes.Where(h => h.Length > 0).Distinct().Order().ToList();
        return HashBytes(Encoding.UTF8.GetBytes(string.Join("\n", sorted)));
    }
}
