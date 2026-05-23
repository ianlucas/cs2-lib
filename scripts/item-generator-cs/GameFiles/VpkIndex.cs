using SteamDatabase.ValvePak;

namespace ItemGenerator.GameFiles;

public static class VpkIndexBuilder
{
    private static readonly Dictionary<string, string> CompiledExtensions = new()
    {
        [".vsvg_c"] = ".svg",
        [".vtex_c"] = ".png"
    };

    private static readonly Dictionary<string, string> OutputExtensions =
        CompiledExtensions.ToDictionary(kv => kv.Value, kv => kv.Key);

    private static string NormalizeIndexedPath(string path)
    {
        foreach (var (compiledExt, outputExt) in CompiledExtensions)
        {
            if (path.EndsWith(compiledExt, StringComparison.Ordinal))
                return path[..^compiledExt.Length] + outputExt;
        }
        return path;
    }

    public static void BuildVpkIndex(ItemGeneratorContext ctx)
    {
        if (ctx.VpkIndex.Count > 0) return;

        var pakDirPath = Config.GetPakDirPath();
        if (!File.Exists(pakDirPath))
            throw new FileNotFoundException($"pak01_dir.vpk not found at: {pakDirPath}");

        var package = new Package();
        package.Read(pakDirPath);
        ctx.VpkPackage = package;

        foreach (var (_, entries) in package.Entries!)
        {
            foreach (var entry in entries)
            {
                var fullPath = entry.GetFullPath();
                var crc = entry.CRC32.ToString("x8");
                var fnumber = entry.ArchiveIndex.ToString();
                var vpkEntry = new VpkIndexEntry(crc, fnumber);

                ctx.VpkIndex[fullPath] = vpkEntry;
                var normalized = NormalizeIndexedPath(fullPath);
                if (normalized != fullPath)
                    ctx.VpkIndex[normalized] = vpkEntry;
            }
        }
    }

    public static byte[]? ReadVpkEntry(ItemGeneratorContext ctx, string path)
    {
        if (ctx.VpkPackage == null) return null;
        var entry = ctx.VpkPackage.FindEntry(path);
        if (entry == null) return null;
        ctx.VpkPackage.ReadEntry(entry, out var data);
        return data;
    }
}
