using System.Collections.Concurrent;
using SteamDatabase.ValvePak;
using ValveResourceFormat;
using ValveResourceFormat.IO;
using static ItemGenerator.Logging;

namespace ItemGenerator.GameFiles;

public static class ResourceDecompiler
{
    private static readonly string[] ItemDefinitionPrefixes =
        ["scripts/items/items_game.txt", "resource/csgo_"];

    private static IEnumerable<PackageEntry> GetItemDefinitionEntries(Package package)
    {
        foreach (var (_, entries) in package.Entries!)
            foreach (var entry in entries)
            {
                var path = entry.GetFullPath();
                if (ItemDefinitionPrefixes.Any(p => path.StartsWith(p, StringComparison.OrdinalIgnoreCase)))
                    yield return entry;
            }
    }

    /// <summary>
    /// Depot paths of the split pak01_NNN.vpk archives holding item definition entries
    /// that still need extraction. Item definitions are not guaranteed to be inlined in
    /// pak01_dir.vpk — CS2 updates can move them into split archives, which Limited mode
    /// must download before DecompileItemDefinitionResources can read them.
    /// </summary>
    public static List<string> GetItemDefinitionArchiveFiles(ItemGeneratorContext ctx)
    {
        if (ctx.VpkPackage == null) return [];
        return [.. GetItemDefinitionEntries(ctx.VpkPackage)
            .Where(e => e.ArchiveIndex != 0x7FFF
                && !File.Exists(Path.Combine(Config.DecompiledDir, e.GetFullPath())))
            .Select(e => Config.GetArchiveDepotPath(e.ArchiveIndex))
            .Distinct()];
    }

    public static void DecompileItemDefinitionResources(ItemGeneratorContext ctx)
    {
        if (ctx.VpkPackage == null) return;

        foreach (var entry in GetItemDefinitionEntries(ctx.VpkPackage))
        {
            var path = entry.GetFullPath();
            var outPath = Path.Combine(Config.DecompiledDir, path);
            if (File.Exists(outPath)) continue;

            ctx.VpkPackage.ReadEntry(entry, out var data);
            Directory.CreateDirectory(Path.GetDirectoryName(outPath)!);

            if (path.EndsWith("_c", StringComparison.Ordinal))
            {
                using var resource = new Resource();
                resource.Read(new MemoryStream(data));
                var extracted = FileExtract.Extract(resource, null!);
                var outputPath = outPath[..^2]; // strip _c
                File.WriteAllBytes(outputPath, extracted.Data!);
            }
            else
            {
                File.WriteAllBytes(outPath, data);
            }
        }
    }

    public static void DecompileAssets(ItemGeneratorContext ctx, IEnumerable<string> vpkPaths)
    {
        if (ctx.VpkPackage == null) return;

        var package = ctx.VpkPackage;
        var outDir = Config.DecompiledDir;
        var parallelism = Math.Max(2, Environment.ProcessorCount);

        // Resolve entries and drop already-extracted paths in parallel.
        // FindEntry is a read-only dictionary lookup; File.Exists is independent per path.
        var work = vpkPaths
            .AsParallel()
            .WithDegreeOfParallelism(parallelism)
            .Select(vpkPath => (VpkPath: vpkPath, Entry: package.FindEntry(vpkPath)))
            .Where(t => t.Entry != null && !IsAlreadyExtracted(t.VpkPath, outDir))
            .ToArray();

        if (work.Length == 0) return;

        // Sort by (archive, offset) so each archive file is read sequentially,
        // which avoids head-seek thrashing across the split _NNN.vpk files.
        Array.Sort(work, static (a, b) =>
        {
            var c = a.Entry!.ArchiveIndex.CompareTo(b.Entry!.ArchiveIndex);
            return c != 0 ? c : a.Entry.Offset.CompareTo(b.Entry.Offset);
        });

        // Pre-create all unique output directories once instead of per-file in the hot loop.
        var dirs = new HashSet<string>(StringComparer.Ordinal);
        foreach (var (vpkPath, _) in work)
        {
            var basePath = vpkPath.EndsWith("_c", StringComparison.Ordinal) ? vpkPath[..^2] : vpkPath;
            dirs.Add(Path.Combine(outDir, Path.GetDirectoryName(basePath) ?? ""));
        }
        foreach (var d in dirs) Directory.CreateDirectory(d);

        var total = work.Length;
        var decompiled = 0;
        var lastMilestone = 0;
        var reportProgress = total >= 100;
        // Entries inlined in pak01_dir.vpk (ArchiveIndex 0x7FFF) share Package.Reader's
        // base stream and seek on it, so they cannot be read concurrently.
        var dirVpkLock = new object();

        var po = new ParallelOptions { MaxDegreeOfParallelism = parallelism };
        Parallel.ForEach(Partitioner.Create(work, loadBalance: true), po, item =>
        {
            var (vpkPath, entry) = item;
            byte[] data;
            if (entry!.ArchiveIndex == 0x7FFF)
            {
                lock (dirVpkLock)
                    package.ReadEntry(entry, out data, validateCrc: false);
            }
            else
            {
                package.ReadEntry(entry, out data, validateCrc: false);
            }

            if (vpkPath.EndsWith(".vtex_c", StringComparison.OrdinalIgnoreCase))
                DecompileTexture(data, vpkPath, outDir);
            else if (vpkPath.EndsWith(".vsvg_c", StringComparison.OrdinalIgnoreCase))
                DecompileSvg(data, vpkPath, outDir);
            else
            {
                var outPath = Path.Combine(outDir, vpkPath.EndsWith("_c", StringComparison.Ordinal) ? vpkPath[..^2] : vpkPath);
                if (!File.Exists(outPath))
                    File.WriteAllBytes(outPath, data);
            }

            if (!reportProgress) return;
            var current = Interlocked.Increment(ref decompiled);
            var pct = current * 100 / total;
            var milestone = pct / 5 * 5;
            if (milestone > 0 && milestone > Volatile.Read(ref lastMilestone) &&
                Interlocked.Exchange(ref lastMilestone, milestone) < milestone)
                Log($"  {milestone}% ({current}/{total})");
        });
    }

    private static bool IsAlreadyExtracted(string vpkPath, string outDir)
    {
        if (vpkPath.EndsWith(".vtex_c", StringComparison.OrdinalIgnoreCase))
        {
            // Texture output extension (.png vs .exr) depends on the resource header,
            // so check both candidates conservatively to avoid re-reading.
            var basePath = vpkPath[..^7]; // strip ".vtex_c"
            var dir = Path.Combine(outDir, Path.GetDirectoryName(basePath) ?? "");
            var baseName = Path.GetFileName(basePath);
            return File.Exists(Path.Combine(dir, baseName + ".png"))
                || File.Exists(Path.Combine(dir, baseName + ".exr"));
        }
        var outPath = Path.Combine(outDir, vpkPath.EndsWith("_c", StringComparison.Ordinal) ? vpkPath[..^2] : vpkPath);
        return File.Exists(outPath);
    }

    public static void DecompileModelAssets(ItemGeneratorContext ctx, IEnumerable<string> vpkPaths)
    {
        if (ctx.VpkPackage == null) return;
        var package = ctx.VpkPackage;
        var fileLoader = new GameFileLoader(package, package.FileName);
        var parallelism = Math.Max(2, Environment.ProcessorCount);

        // Resolve entries, compute glb output path, drop already-exported, in parallel.
        var work = vpkPaths
            .AsParallel()
            .WithDegreeOfParallelism(parallelism)
            .Select(vpkPath =>
            {
                var entry = package.FindEntry(vpkPath);
                if (entry == null) return default;
                var basePath = vpkPath.EndsWith("_c", StringComparison.Ordinal) ? vpkPath[..^2] : vpkPath;
                var outDir = Path.Combine(Config.DecompiledDir, Path.GetDirectoryName(vpkPath) ?? "");
                var glbPath = Path.Combine(outDir, Path.GetFileNameWithoutExtension(basePath) + ".glb");
                if (File.Exists(glbPath)) return default;
                return (VpkPath: vpkPath, Entry: entry, OutDir: outDir, GlbPath: glbPath);
            })
            .Where(t => t.Entry != null)
            .ToArray();

        if (work.Length == 0) return;

        Array.Sort(work, static (a, b) =>
        {
            var c = a.Entry!.ArchiveIndex.CompareTo(b.Entry!.ArchiveIndex);
            return c != 0 ? c : a.Entry.Offset.CompareTo(b.Entry.Offset);
        });

        foreach (var d in work.Select(w => w.OutDir).Distinct(StringComparer.Ordinal))
            Directory.CreateDirectory(d);

        var dirVpkLock = new object();
        var po = new ParallelOptions { MaxDegreeOfParallelism = parallelism };
        Parallel.ForEach(Partitioner.Create(work, loadBalance: true), po, item =>
        {
            var (vpkPath, entry, _, glbPath) = item;
            byte[] data;
            if (entry!.ArchiveIndex == 0x7FFF)
            {
                lock (dirVpkLock)
                    package.ReadEntry(entry, out data, validateCrc: false);
            }
            else
            {
                package.ReadEntry(entry, out data, validateCrc: false);
            }

            using var resource = new Resource();
            resource.Read(new MemoryStream(data));
            if (!GltfModelExporter.CanExport(resource)) return;

            var exporter = new GltfModelExporter(fileLoader)
            {
                ProgressReporter = new Progress<string>(_ => { }),
                ExportMaterials = true,
            };
            exporter.Export(resource, glbPath);
        });
    }

    private static void DecompileTexture(byte[] data, string vpkPath, string outDir)
    {
        var basePath = vpkPath.EndsWith("_c") ? vpkPath[..^2] : vpkPath;
        var baseName = Path.GetFileNameWithoutExtension(basePath);
        if (baseName.EndsWith(".vtex")) baseName = baseName[..^5];
        var dir = Path.Combine(outDir, Path.GetDirectoryName(basePath) ?? "");
        Directory.CreateDirectory(dir);

        if (File.Exists(Path.Combine(dir, $"{baseName}.png")) ||
            File.Exists(Path.Combine(dir, $"{baseName}.exr"))) return;

        using var resource = new Resource();
        resource.FileName = vpkPath;
        resource.Read(new MemoryStream(data));

        var textureExtract = new TextureExtract(resource);
        var ext = textureExtract.ImageOutputExtension;
        var outPath = Path.Combine(dir, $"{baseName}{ext}");

        using var content = textureExtract.ToContentFile();
        if (content.Data != null)
        {
            File.WriteAllBytes(outPath, content.Data);
            return;
        }
        var imageSubFile = content.SubFiles.FirstOrDefault(sf =>
            sf.FileName.EndsWith(ext, StringComparison.OrdinalIgnoreCase));
        if (imageSubFile == null)
            throw new InvalidOperationException($"No {ext} subfile produced for texture: {vpkPath}");
        var imageBytes = imageSubFile.Extract?.Invoke()
            ?? throw new InvalidOperationException($"SubFile Extract returned null for texture: {vpkPath}");
        File.WriteAllBytes(outPath, imageBytes);
    }

    private static void DecompileSvg(byte[] data, string vpkPath, string outDir)
    {
        using var resource = new Resource();
        resource.Read(new MemoryStream(data));

        var basePath = vpkPath.EndsWith("_c") ? vpkPath[..^2] : vpkPath;
        var dir = Path.Combine(outDir, Path.GetDirectoryName(basePath) ?? "");
        Directory.CreateDirectory(dir);

        var outPath = Path.Combine(dir, Path.GetFileName(basePath));
        if (File.Exists(outPath)) return;

        var extracted = FileExtract.Extract(resource, null!);
        File.WriteAllBytes(outPath, extracted.Data!);
    }
}
