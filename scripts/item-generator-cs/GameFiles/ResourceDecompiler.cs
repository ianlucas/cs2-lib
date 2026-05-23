using SteamDatabase.ValvePak;
using SkiaSharp;
using ValveResourceFormat;
using ValveResourceFormat.IO;
using ValveResourceFormat.ResourceTypes;

namespace ItemGenerator.GameFiles;

public static class ResourceDecompiler
{
    public static void DecompileItemDefinitionResources(ItemGeneratorContext ctx)
    {
        if (ctx.VpkPackage == null) return;
        var prefixes = new[] { "scripts/items/items_game.txt", "resource/csgo_" };

        foreach (var (_, entries) in ctx.VpkPackage.Entries!)
        {
            foreach (var entry in entries)
            {
                var path = entry.GetFullPath();
                if (!prefixes.Any(p => path.StartsWith(p, StringComparison.OrdinalIgnoreCase)))
                    continue;

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
    }

    public static void DecompileAssets(ItemGeneratorContext ctx, IEnumerable<string> vpkPaths)
    {
        if (ctx.VpkPackage == null) return;

        foreach (var vpkPath in vpkPaths)
        {
            var entry = ctx.VpkPackage.FindEntry(vpkPath);
            if (entry == null) continue;

            ctx.VpkPackage.ReadEntry(entry, out var data);
            var outDir = Config.DecompiledDir;

            if (vpkPath.EndsWith(".vtex_c", StringComparison.OrdinalIgnoreCase))
            {
                DecompileTexture(data, vpkPath, outDir);
            }
            else if (vpkPath.EndsWith(".vsvg_c", StringComparison.OrdinalIgnoreCase))
            {
                DecompileSvg(data, vpkPath, outDir);
            }
            else
            {
                var outPath = Path.Combine(outDir, vpkPath.EndsWith("_c") ? vpkPath[..^2] : vpkPath);
                Directory.CreateDirectory(Path.GetDirectoryName(outPath)!);
                if (!File.Exists(outPath))
                    File.WriteAllBytes(outPath, data);
            }
        }
    }

    public static void DecompileModelAssets(ItemGeneratorContext ctx, IEnumerable<string> vpkPaths)
    {
        if (ctx.VpkPackage == null) return;
        var fileLoader = new GameFileLoader(ctx.VpkPackage, ctx.VpkPackage.FileName);

        foreach (var vpkPath in vpkPaths)
        {
            var entry = ctx.VpkPackage.FindEntry(vpkPath);
            if (entry == null) continue;

            ctx.VpkPackage.ReadEntry(entry, out var data);
            using var resource = new Resource();
            resource.Read(new MemoryStream(data));

            if (!GltfModelExporter.CanExport(resource)) continue;

            var baseName = Path.GetFileNameWithoutExtension(vpkPath.EndsWith("_c") ? vpkPath[..^2] : vpkPath);
            var outDir = Path.Combine(Config.DecompiledDir, Path.GetDirectoryName(vpkPath) ?? "");
            Directory.CreateDirectory(outDir);
            var glbPath = Path.Combine(outDir, $"{baseName}.glb");

            if (!File.Exists(glbPath))
            {
                var exporter = new GltfModelExporter(fileLoader)
                {
                    ProgressReporter = new Progress<string>(_ => { }),
                    ExportMaterials = true,
                };
                exporter.Export(resource, glbPath);
            }
        }
    }

    private static void DecompileTexture(byte[] data, string vpkPath, string outDir)
    {
        using var resource = new Resource();
        resource.FileName = vpkPath;
        resource.Read(new MemoryStream(data));

        var basePath = vpkPath.EndsWith("_c") ? vpkPath[..^2] : vpkPath;
        var baseName = Path.GetFileNameWithoutExtension(basePath);
        if (baseName.EndsWith(".vtex")) baseName = baseName[..^5];
        var dir = Path.Combine(outDir, Path.GetDirectoryName(basePath) ?? "");
        Directory.CreateDirectory(dir);

        var pngPath = Path.Combine(dir, $"{baseName}.png");
        if (File.Exists(pngPath)) return;

        var textureExtract = new TextureExtract(resource);
        using var content = textureExtract.ToContentFile();
        if (content.Data != null)
        {
            File.WriteAllBytes(pngPath, content.Data);
            return;
        }
        var written = false;
        foreach (var subFile in content.SubFiles)
        {
            if (!subFile.FileName.EndsWith(".png", StringComparison.OrdinalIgnoreCase)) continue;
            var pngBytes = subFile.Extract?.Invoke();
            if (pngBytes != null) { File.WriteAllBytes(pngPath, pngBytes); written = true; }
            break;
        }
        if (!written)
            throw new InvalidOperationException($"No PNG data produced for texture: {vpkPath}");
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
