using System.Text.Json;

namespace ItemGenerator;

public static class AssetWorkspace
{
    public static Task PrepareWorkspace(ItemGeneratorContext ctx)
    {
        Directory.CreateDirectory(Config.ItemGeneratorWorkdirDir);
        Directory.CreateDirectory(Config.ItemGeneratorCacheDir);

        // Build dir holds per-run staging output (pre-hash encodes); never carry state across runs.
        if (Directory.Exists(Config.ItemGeneratorBuildDir))
            Directory.Delete(Config.ItemGeneratorBuildDir, true);
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
                ctx.StaticAssets[key] = Catalog.CatalogAssets.CopyAndOptimizeImage(file);
            }
            else
            {
                File.Copy(file, Path.Combine(Config.OutputDir, "images", filename), true);
            }
        }

        var existingItems = LoadExistingItems();
        ctx.ExistingItemsById = [];
        foreach (var item in existingItems)
            ctx.ExistingItemsById[item.Id] = item;

        return Task.CompletedTask;
    }

    private static List<CS2Item> LoadExistingItems()
    {
        var path = Path.Combine(Config.CwdPath, Config.ItemsJsonPath);
        if (!File.Exists(path)) return [];
        var json = File.ReadAllText(path);
        return JsonSerializer.Deserialize<List<CS2Item>>(json) ?? [];
    }
}
