using SkiaSharp;

namespace ItemGenerator.Catalog;

public static class CatalogAssets
{
    public static string RequireStaticAsset(ItemGeneratorContext ctx, string path)
    {
        if (ctx.StaticAssets.TryGetValue(path, out var value) && value != null)
            return value;
        throw new InvalidOperationException($"Unable to find '{path}' static asset.");
    }

    private static string GetVpkImagePath(string path)
    {
        return $"panorama/images/{path}_png.png".ToLowerInvariant();
    }

    private static string GetVpkPaintImagePath(string className, string paintClassName, string suffix)
    {
        return $"panorama/images/econ/default_generated/{className}_{paintClassName}_{suffix}_png.png".ToLowerInvariant();
    }

    private static string VpkCrcFilename(string vpkPath, string crc, string? suffix = null)
    {
        var baseName = Path.GetFileNameWithoutExtension(vpkPath);
        if (baseName.EndsWith("_png")) baseName = baseName[..^4];
        return suffix != null
            ? $"/images/{baseName}_{crc}_{suffix}.webp"
            : $"/images/{baseName}_{crc}.webp";
    }

    public static bool IsImageValid(ItemGeneratorContext ctx, string path)
    {
        return ctx.VpkIndex.ContainsKey(GetVpkImagePath(path));
    }

    public static bool IsPaintImageValid(ItemGeneratorContext ctx, string? className, string? paintClassName)
    {
        if (className == null || paintClassName == null) return false;
        return ctx.VpkIndex.ContainsKey(GetVpkPaintImagePath(className, paintClassName, "light"));
    }

    public static string GetBaseImage(ItemGeneratorContext ctx, string className)
    {
        return GetImage(ctx, $"econ/weapons/base_weapons/{className}");
    }

    public static string GetImage(ItemGeneratorContext ctx, string path)
    {
        var vpkPath = GetVpkImagePath(path);
        if (!ctx.VpkIndex.TryGetValue(vpkPath, out var entry))
            throw new FileNotFoundException($"VPK entry not found: {vpkPath}");

        var filename = VpkCrcFilename(vpkPath, entry.Crc);
        if (!ctx.ExistingImages.Contains(filename))
        {
            ctx.NeededVpkPaths.Add(entry.EntryPath);
            var localPath = Path.Combine(Config.GameImagesDir, $"{path}_png.png".ToLowerInvariant());
            ctx.ImagesToProcess[entry.EntryPath] = new RegularImageTask(localPath, filename);
        }
        return filename;
    }

    public static string GetPaintImage(ItemGeneratorContext ctx, string? className, string? paintClassName)
    {
        var cn = className ?? throw new InvalidOperationException("className is null");
        var pcn = paintClassName ?? throw new InvalidOperationException("paintClassName is null");
        var lightVpkPath = GetVpkPaintImagePath(cn, pcn, "light");
        if (!ctx.VpkIndex.TryGetValue(lightVpkPath, out var entry))
            throw new FileNotFoundException($"VPK entry not found: {lightVpkPath}");

        var baseName = $"{cn}_{pcn}_{entry.Crc}";
        var baseFilename = $"/images/{baseName}.webp";
        if (!ctx.ExistingImages.Contains(baseFilename))
        {
            var localPaths = Config.PaintImageSuffixes.Select(suffix =>
            {
                var paintImagePath = Path.Combine(Config.GameImagesDir,
                    $"econ/default_generated/{cn}_{pcn}_{suffix}_png.png".ToLowerInvariant());
                return (paintImagePath, suffix);
            }).ToList();

            foreach (var suffix in Config.PaintImageSuffixes)
            {
                var suffixVpkPath = GetVpkPaintImagePath(cn, pcn, suffix);
                if (ctx.VpkIndex.TryGetValue(suffixVpkPath, out var suffixEntry))
                    ctx.NeededVpkPaths.Add(suffixEntry.EntryPath);
            }

            ctx.ImagesToProcess[entry.EntryPath] = new PaintImageTask(localPaths, baseName, baseFilename);
        }
        return baseFilename;
    }

    public static string GetDefaultGraffitiImage(ItemGeneratorContext ctx, string stickerMaterial, string hexColor)
    {
        var vpkPath = GetVpkImagePath($"econ/stickers/{stickerMaterial}");
        if (!ctx.VpkIndex.TryGetValue(vpkPath, out var entry))
            throw new FileNotFoundException($"VPK entry not found: {vpkPath}");

        var materialBase = stickerMaterial.Split('/').Last();
        var colorNoHash = hexColor.Replace("#", "");
        var filename = $"/images/{materialBase}_{colorNoHash}_{entry.Crc}.webp";
        if (!ctx.ExistingImages.Contains(filename))
        {
            ctx.NeededVpkPaths.Add(entry.EntryPath);
            var localPath = Path.Combine(Config.GameImagesDir, $"econ/stickers/{stickerMaterial}_png.png".ToLowerInvariant());
            ctx.ImagesToProcess[$"{entry.EntryPath}:{hexColor}"] = new GraffitiImageTask(localPath, hexColor, filename);
        }
        return filename;
    }

    public static string GetSpecialsImage(ItemGeneratorContext ctx, string? path)
    {
        if (path == null)
            return RequireStaticAsset(ctx, "/images/default_rare_item.png");

        var vpkPath = GetVpkImagePath(path);
        if (!ctx.VpkIndex.ContainsKey(vpkPath))
            return RequireStaticAsset(ctx, "/images/default_rare_item.png");

        var entry = ctx.VpkIndex[vpkPath];
        var filename = VpkCrcFilename(vpkPath, entry.Crc, "rare");
        if (!ctx.ExistingImages.Contains(filename))
        {
            ctx.NeededVpkPaths.Add(entry.EntryPath);
            var localPath = Path.Combine(Config.GameImagesDir, $"{path}_png.png".ToLowerInvariant());
            ctx.ImagesToProcess[$"{entry.EntryPath}:rare"] = new RegularImageTask(localPath, filename);
        }
        return filename;
    }

    public static (string? ModelData, string? ModelPlayer)? GetModel(ItemGeneratorContext ctx, string? path, int? existingId = null)
    {
        if (path == null) return null;

        if (ctx.Mode == ItemGeneratorMode.Limited && existingId.HasValue)
        {
            if (ctx.ExistingItemsById.TryGetValue(existingId.Value, out var existing))
                return (existing.ModelData, existing.ModelPlayer);
            return null;
        }

        var vpkPath = path.Replace(".vmdl", ".vmdl_c").ToLowerInvariant();
        if (!ctx.VpkIndex.TryGetValue(vpkPath, out var entry))
            return null;

        var baseName = Path.GetFileNameWithoutExtension(path);
        var modelPlayer = $"/models/{baseName}_{entry.Crc}.glb";
        var modelData = $"/models/{baseName}_{entry.Crc}.json";
        ctx.ModelsToProcess[vpkPath] = new PendingModelTask
        {
            Base = baseName,
            Crc = entry.Crc,
            ModelData = modelData,
            ModelPlayer = modelPlayer,
            DirectMaterials = []
        };
        return (modelData, modelPlayer);
    }

    public static string? GetCollectionImage(ItemGeneratorContext ctx, string name)
    {
        var pngVpkPath = $"panorama/images/econ/set_icons/{name}_png.png";
        var svgVpkPath = $"panorama/images/econ/set_icons/{name}.svg";
        var isSvg = !ctx.VpkIndex.ContainsKey(pngVpkPath) && ctx.VpkIndex.ContainsKey(svgVpkPath);
        var vpkPath = isSvg ? svgVpkPath : pngVpkPath;

        if (!ctx.VpkIndex.TryGetValue(vpkPath, out var entry))
            return null;

        var filename = $"/images/{name}_{entry.Crc}.webp";
        if (!ctx.ExistingImages.Contains(filename))
        {
            var ext = isSvg ? ".svg" : "_png.png";
            var localPath = Path.Combine(Config.GameImagesDir, $"econ/set_icons/{name}{ext}");
            ctx.NeededVpkPaths.Add(entry.EntryPath);
            ctx.ImagesToProcess[entry.EntryPath] = isSvg
                ? new SvgImageTask(localPath, filename)
                : new RegularImageTask(localPath, filename);
        }
        return filename;
    }

    public static async Task<string?> TryGetFallbackImage(
        ItemGeneratorContext ctx, string source, string imagePath, int existingId)
    {
        if (ctx.ExistingItemsById.TryGetValue(existingId, out var existing) && existing.Image != null)
            return existing.Image;

        var staticKey = $"/images/{Path.GetFileName(imagePath)}.png";
        if (ctx.StaticAssets.TryGetValue(staticKey, out var staticValue) && staticValue != null)
            return staticValue;

        var localPath = Path.Combine(Config.StaticImagesDir, Path.GetFileName(staticKey));
        if (!File.Exists(localPath))
        {
            var fallback = await Sources.External.FindFallbackImage(source, imagePath);
            if (fallback == null) return null;
        }

        var filename = await CopyAndOptimizeImage(localPath, "/images/{sha256}.webp");
        ctx.StaticAssets[staticKey] = filename;
        return filename;
    }

    public static async Task<string> CopyAndOptimizeImage(string src, string dest)
    {
        if (dest.Contains("{sha256}"))
        {
            var hash = await ComputeFileSha256(src);
            dest = dest.Replace("{sha256}", hash);
        }

        using var bitmap = SKBitmap.Decode(src);
        using var image = SKImage.FromBitmap(bitmap);
        using var data = image.Encode(SKEncodedImageFormat.Webp, Config.WebpQuality);
        var outPath = Path.Combine(Config.OutputDir, dest.TrimStart('/'));
        Directory.CreateDirectory(Path.GetDirectoryName(outPath)!);
        using var stream = File.OpenWrite(outPath);
        data.SaveTo(stream);
        return dest;
    }

    public static async Task<string> ComputeFileSha256(string filePath)
    {
        using var stream = File.OpenRead(filePath);
        var hash = await System.Security.Cryptography.SHA256.HashDataAsync(stream);
        return Convert.ToHexStringLower(hash);
    }
}
