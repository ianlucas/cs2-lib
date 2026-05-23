using System.Text.Json;
using System.Text.RegularExpressions;
using ItemGenerator.GameFiles;
using ValveKeyValue;

namespace ItemGenerator.Catalog;

public static class SourceDataLoader
{
    public static async Task LoadSourceData(ItemGeneratorContext ctx)
    {
        Directory.CreateDirectory(Config.StaticImagesDir);

        if (ctx.Mode == ItemGeneratorMode.Limited)
            await DepotSync(ctx);

        VpkIndexBuilder.BuildVpkIndex(ctx);
        ResourceDecompiler.DecompileItemDefinitionResources(ctx);
        ReadCsgoLanguageFiles(ctx);
        ReadItemsGameFile(ctx);
    }

    private static async Task DepotSync(ItemGeneratorContext ctx)
    {
        await Depot.DepotDownloaderService.SyncAssetsManifest();
        await Depot.DepotDownloaderService.EnsureItemDefinitionPackages(ctx);
    }

    private static void ReadCsgoLanguageFiles(ItemGeneratorContext ctx)
    {
        ctx.ItemTranslationByLanguage = [];
        ctx.CsgoTranslationByLanguage = [];

        if (!Directory.Exists(Config.GameResourceDir)) return;

        foreach (var file in Directory.GetFiles(Config.GameResourceDir))
        {
            var match = Config.LanguageFileRe.Match(Path.GetFileName(file));
            if (!match.Success) continue;
            var language = match.Groups[1].Value;

            ctx.ItemTranslationByLanguage[language] = [];

            var serializer = KVSerializer.Create(KVSerializationFormat.KeyValues1Text);
            var options = new KVSerializerOptions { HasEscapeSequences = true, EnableValveNullByteBugBehavior = true };
            using var reader = new StreamReader(file, detectEncodingFromByteOrderMarks: true);
            var text = reader.ReadToEnd();
            using var stream = new MemoryStream(System.Text.Encoding.UTF8.GetBytes(text));
            KVObject doc = serializer.Deserialize(stream, options);
            var tokens = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase);
            var langObj = KvHelper.GetChild(doc, "Tokens");
            if (langObj != null)
            {
                foreach (var child in langObj)
                    tokens[child.Key.ToLowerInvariant()] = child.Value?.ToString();
            }

            ctx.CsgoTranslationByLanguage[language] = tokens!;
        }

        if (!ctx.CsgoTranslationByLanguage.ContainsKey("english"))
            throw new InvalidOperationException("English language file not found.");
    }

    private static void ReadItemsGameFile(ItemGeneratorContext ctx)
    {
        if (!File.Exists(Config.GameItemsPath))
            throw new FileNotFoundException($"items_game.txt not found at: {Config.GameItemsPath}");

        ctx.GameItemsAsText = File.ReadAllText(Config.GameItemsPath);

        var serializer = KVSerializer.Create(KVSerializationFormat.KeyValues1Text);
        using var stream = File.OpenRead(Config.GameItemsPath);
        var doc = serializer.Deserialize(stream);
        ctx.GameItems = doc;

        // Build rarities color hex
        var rarities = KvHelper.GetChild(ctx.GameItems, "rarities");
        var colors = KvHelper.GetChild(ctx.GameItems, "colors");
        ctx.RaritiesColorHex = [];
        if (rarities != null && colors != null)
        {
            foreach (var rarity in rarities)
            {
                var colorKey = KvHelper.GetString(rarity.Value, "color");
                if (colorKey == null) continue;
                var colorObj = KvHelper.GetChild(colors, colorKey);
                var hexColor = KvHelper.GetString(colorObj, "hex_color");
                if (hexColor != null)
                    ctx.RaritiesColorHex[rarity.Key] = hexColor;
            }
        }

        // Build paint kits rarity color hex
        var paintKitsRarity = KvHelper.GetChild(ctx.GameItems, "paint_kits_rarity");
        ctx.PaintKitsRaritiesColorHex = [];
        if (paintKitsRarity != null)
        {
            foreach (var entry in paintKitsRarity)
            {
                var rarityKey = entry.Value?.ToString();
                if (rarityKey != null && ctx.RaritiesColorHex.TryGetValue(rarityKey, out var color))
                    ctx.PaintKitsRaritiesColorHex[entry.Key] = color;
            }
        }

        // Build items rarities color hex from client_loot_lists
        var clientLootLists = KvHelper.GetChild(ctx.GameItems, "client_loot_lists");
        ctx.ItemsRaritiesColorHex = [];
        if (clientLootLists != null)
        {
            var rarityKeys = ctx.RaritiesColorHex.Keys.ToList();
            foreach (var lootList in clientLootLists)
            {
                var rarityKey = rarityKeys.FirstOrDefault(k => lootList.Key.Contains($"_{k}"));
                if (rarityKey == null) continue;

                foreach (var item in lootList.Value)
                {
                    var key = item.Key;
                    if (key.Contains("customplayer_") || Config.LootItemRe.IsMatch(key))
                        ctx.ItemsRaritiesColorHex[key] = ctx.RaritiesColorHex[rarityKey];
                }
            }
        }

        // Build paint kits
        var paintKitsObj = KvHelper.GetChild(ctx.GameItems, "paint_kits");
        ctx.PaintKits = [];
        if (paintKitsObj != null)
        {
            foreach (var entry in paintKitsObj)
            {
                var name = KvHelper.GetString(entry.Value, "name");
                var descriptionTag = KvHelper.GetString(entry.Value, "description_tag");
                if (name == null || name == "default" || descriptionTag == null) continue;

                var wearMaxStr = KvHelper.GetString(entry.Value, "wear_remap_max");
                var wearMinStr = KvHelper.GetString(entry.Value, "wear_remap_min");

                ctx.PaintKits.Add(new PaintKitRecord(
                    ClassName: name,
                    CompositeMaterialPath: KvHelper.GetString(entry.Value, "composite_material_path"),
                    DescToken: PrependHash(KvHelper.GetString(entry.Value, "description_string")),
                    Index: int.Parse(entry.Key),
                    IsLegacy: KvHelper.GetString(entry.Value, "use_legacy_model") == "1",
                    NameToken: PrependHash(descriptionTag)!,
                    RarityColorHex: GetRarityColorHex(ctx, [name]),
                    WearMax: wearMaxStr != null ? double.Parse(wearMaxStr) : 1.0,
                    WearMin: wearMinStr != null ? double.Parse(wearMinStr) : 0.06
                ));
            }
        }

        // Build graffiti tints
        var graffitiTints = KvHelper.GetChild(ctx.GameItems, "graffiti_tints");
        ctx.GraffitiTints = [];
        if (graffitiTints != null)
        {
            foreach (var entry in graffitiTints)
            {
                var id = int.Parse(KvHelper.GetString(entry.Value, "id") ?? "0");
                var hexColor = KvHelper.GetString(entry.Value, "hex_color") ?? "";
                ctx.GraffitiTints.Add(new GraffitiTintRecord(
                    HexColor: hexColor,
                    Id: id,
                    Name: Translations.RequireTranslation(ctx, $"#Attrib_SprayTintValue_{id}"),
                    NameToken: $"#Attrib_SprayTintValue_{id}"
                ));
            }
        }

        // Build item set mappings
        ctx.ItemSetImage = [];
        ctx.ItemSetItemKey = [];
        var itemSets = KvHelper.GetChild(ctx.GameItems, "item_sets");
        if (itemSets != null)
        {
            foreach (var itemSet in itemSets)
            {
                var items = KvHelper.GetChild(itemSet.Value, "items");
                if (items == null) continue;
                foreach (var item in items)
                {
                    if (!ctx.ItemSetImage.ContainsKey(itemSet.Key))
                        ctx.ItemSetImage[itemSet.Key] = CatalogAssets.GetCollectionImage(ctx, itemSet.Key);
                    ctx.ItemSetItemKey[item.Key] = itemSet.Key;
                }
            }
        }

        // Load existing identifiers
        var idsPath = Path.Combine(Config.CwdPath, Config.ItemIdsJsonPath);
        ctx.AllIdentifiers = File.Exists(idsPath)
            ? JsonSerializer.Deserialize<List<string>>(File.ReadAllText(idsPath)) ?? []
            : [];
    }

    public static string GetRarityColorHex(ItemGeneratorContext ctx, string?[] keywords, string? defaultsTo = null)
    {
        string? colorHex = null;
        if (defaultsTo != null)
        {
            colorHex = defaultsTo.StartsWith('#')
                ? defaultsTo
                : ctx.RaritiesColorHex.GetValueOrDefault(defaultsTo);
        }

        foreach (var keyword in keywords)
        {
            if (keyword == null) continue;
            if (keyword.StartsWith('#')) { colorHex = keyword; break; }

            colorHex = ctx.ItemsRaritiesColorHex.GetValueOrDefault(keyword)
                ?? ctx.PaintKitsRaritiesColorHex.GetValueOrDefault(keyword)
                ?? ctx.RaritiesColorHex.GetValueOrDefault(keyword);
            if (colorHex != null) break;
        }

        return colorHex ?? ctx.RaritiesColorHex.GetValueOrDefault("default")
            ?? throw new InvalidOperationException("Unable to resolve rarity color hex.");
    }

    private static string? PrependHash(string? str)
    {
        if (str == null || str.StartsWith('#')) return str;
        return $"#{str}";
    }
}
