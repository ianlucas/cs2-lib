using System.Text.Json;
using SkiaSharp;

namespace ItemGenerator;

public static class AssetWorkspace
{
    public static async Task PrepareWorkspace(ItemGeneratorContext ctx)
    {
        Directory.CreateDirectory(Config.ItemGeneratorWorkdirDir);
        Directory.CreateDirectory(Config.ItemGeneratorCacheDir);
        Directory.CreateDirectory(Config.ItemGeneratorBuildDir);

        if (Directory.Exists(Config.OutputDir))
            Directory.Delete(Config.OutputDir, true);

        foreach (var folder in new[] { "images", "materials", "models", "textures" })
            Directory.CreateDirectory(Path.Combine(Config.OutputDir, folder));

        ctx.StaticAssets = [];
        Directory.CreateDirectory(Config.StaticImagesDir);
        foreach (var file in Directory.GetFiles(Config.StaticImagesDir))
        {
            var filename = Path.GetFileName(file);
            if (filename.EndsWith(".png", StringComparison.OrdinalIgnoreCase))
            {
                var key = $"/images/{filename}";
                var value = await CopyAndOptimizeImage(file, "/images/{sha256}.webp");
                ctx.StaticAssets[key] = value;
            }
            else
            {
                File.Copy(file, Path.Combine(Config.OutputDir, "images", filename), true);
            }
        }

        var existingItems = LoadExistingItems();
        ctx.ExistingItemsById = [];
        foreach (var item in existingItems)
        {
            ctx.ExistingItemsById[item.Id] = item;
            if (item.Image != null) ctx.ExistingImages.Add(item.Image);
            if (item.CollectionImage != null) ctx.ExistingImages.Add(item.CollectionImage);
            if (item.SpecialsImage != null) ctx.ExistingImages.Add(item.SpecialsImage);
        }
    }

    private static List<CS2Item> LoadExistingItems()
    {
        var path = Path.Combine(Config.CwdPath, Config.ItemsJsonPath);
        if (!File.Exists(path)) return [];
        var json = File.ReadAllText(path);
        return JsonSerializer.Deserialize<List<CS2Item>>(json) ?? [];
    }

    private static async Task<string> CopyAndOptimizeImage(string src, string dest)
    {
        if (dest.Contains("{sha256}"))
        {
            var hash = await Catalog.CatalogAssets.ComputeFileSha256(src);
            dest = dest.Replace("{sha256}", hash);
        }

        using var bitmap = SKBitmap.Decode(src);
        if (bitmap == null) return dest;
        using var image = SKImage.FromBitmap(bitmap);
        using var data = image.Encode(SKEncodedImageFormat.Webp, Config.WebpQuality);
        var outPath = Path.Combine(Config.OutputDir, dest.TrimStart('/'));
        Directory.CreateDirectory(Path.GetDirectoryName(outPath)!);
        await using var stream = File.Create(outPath);
        data.SaveTo(stream);
        return dest;
    }
}
