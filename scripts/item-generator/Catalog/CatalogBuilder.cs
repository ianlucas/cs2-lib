namespace ItemGenerator.Catalog;

public static class CatalogBuilder
{
    private static readonly string[] MeleeOrGlovesTypes = [CS2ItemType.Melee, CS2ItemType.Gloves];

    public static async Task BuildCatalog(ItemGeneratorContext ctx)
    {
        ParseBaseWeapons(ctx);
        ParseBaseMelees(ctx);
        ParseBaseGloves(ctx);
        ParseUtilities(ctx);
        ParsePaintKits(ctx);
        ParseMusicKits(ctx);
        ParseKeychains(ctx);
        await ParseStickers(ctx);
        ParseGraffiti(ctx);
        ParsePatches(ctx);
        ParseAgents(ctx);
        await ParseCollectibles(ctx);
        ParseTools(ctx);
        await ParseContainers(ctx);
    }

    private static void ParseBaseWeapons(ItemGeneratorContext ctx)
    {
        foreach (var entry in KvHelper.GetMergedSection(ctx.GameItems!, "items"))
        {
            var itemDef = entry.Key;
            var item = entry.Value;
            var baseitem = KvHelper.GetString(item, "baseitem");
            var flexSlot = KvHelper.GetString(item, "flexible_loadout_slot");
            var name = KvHelper.GetString(item, "name") ?? "";
            var prefab = KvHelper.GetString(item, "prefab");
            var imageInventory = KvHelper.GetString(item, "image_inventory");

            if (baseitem != "1" || flexSlot == null) continue;
            var category = Config.WeaponCategoryRe.Match(flexSlot).Groups[1].Value;
            if (category == "equipment" && !Config.BaseWeaponEquipment.Contains(name)) continue;
            if (string.IsNullOrEmpty(category)) continue;

            var prefabData = GetPrefab(ctx, prefab);
            if (prefabData == null) continue;

            var usedByClasses = KvHelper.GetChild(prefabData, "used_by_classes");
            var teams = GetTeams(usedByClasses);
            var id = GetItemId(ctx, $"weapon_{GetTeamsString(usedByClasses)}_{itemDef}");
            var itemName = KvHelper.GetString(prefabData, "item_name");
            var itemDescription = KvHelper.GetString(prefabData, "item_description");
            var playerModel = KvHelper.GetString(prefabData, "model_player");

            Translations.AddTranslation(ctx, id, "name", itemName);
            Translations.AddTranslation(ctx, id, "desc", itemDescription);

            var modelInfo = CatalogAssets.GetModel(ctx, playerModel, id);
            AddItem(ctx, new CS2Item
            {
                Base = true,
                Category = GetBaseWeaponCategory(name, category),
                ClassName = name,
                Def = int.Parse(itemDef),
                DescToken = itemDescription,
                Free = true,
                Id = id,
                Image = imageInventory != null ? CatalogAssets.GetImage(ctx, imageInventory) : CatalogAssets.GetBaseImage(ctx, name),
                Index = null,
                Model = name.Replace("weapon_", ""),
                PlayerModel = modelInfo,
                NameToken = itemName,
                Rarity = SourceDataLoader.GetRarityColorHex(ctx, ["default"]),
                Teams = (int)teams,
                Type = CS2ItemType.Weapon
            });
        }
    }

    private static void ParseBaseMelees(ItemGeneratorContext ctx)
    {
        foreach (var entry in KvHelper.GetMergedSection(ctx.GameItems!, "items"))
        {
            var itemDef = entry.Key;
            var item = entry.Value;
            var itemName = KvHelper.GetString(item, "item_name");
            var imageInventory = KvHelper.GetString(item, "image_inventory");
            var name = KvHelper.GetString(item, "name") ?? "";
            var usedByClasses = KvHelper.GetChild(item, "used_by_classes");
            var prefab = KvHelper.GetString(item, "prefab");
            var baseitem = KvHelper.GetString(item, "baseitem");
            var itemDescription = KvHelper.GetString(item, "item_description");

            if (itemName == null || imageInventory == null || usedByClasses == null) continue;
            if (prefab == "melee" && baseitem != "1") continue;
            if (prefab == null || !prefab.Contains("melee")) continue;
            if (prefab.Contains("noncustomizable")) continue;
            if (!Translations.HasTranslation(ctx, itemName)) continue;

            var teams = GetTeams(usedByClasses);
            var id = GetItemId(ctx, $"melee_{GetTeamsString(usedByClasses)}_{itemDef}");

            Translations.AddTranslation(ctx, id, "name", itemName);
            Translations.AddTranslation(ctx, id, "desc", itemDescription);

            var prefabData = GetPrefab(ctx, prefab);
            var prefabRarity = KvHelper.GetString(prefabData, "item_rarity") ?? "default";
            var playerModel = KvHelper.GetString(item, "model_player");

            var modelInfo = CatalogAssets.GetModel(ctx, playerModel, id);
            AddItem(ctx, new CS2Item
            {
                Base = true,
                ClassName = name,
                Def = int.Parse(itemDef),
                DescToken = itemDescription,
                Free = baseitem == "1" ? true : null,
                Id = id,
                Image = CatalogAssets.GetImage(ctx, imageInventory),
                Index = baseitem == "1" ? null : 0,
                Model = name.Replace("weapon_", ""),
                PlayerModel = modelInfo,
                NameToken = itemName,
                Rarity = SourceDataLoader.GetRarityColorHex(ctx, [prefabRarity], "default"),
                Teams = (int)teams,
                Type = CS2ItemType.Melee
            });
        }
    }

    private static void ParseBaseGloves(ItemGeneratorContext ctx)
    {
        foreach (var entry in KvHelper.GetMergedSection(ctx.GameItems!, "items"))
        {
            var itemDef = entry.Key;
            var item = entry.Value;
            var itemName = KvHelper.GetString(item, "item_name");
            var prefab = KvHelper.GetString(item, "prefab");
            if (itemName == null || prefab == null || !prefab.Contains("hands")) continue;

            var baseitem = KvHelper.GetString(item, "baseitem");
            var name = KvHelper.GetString(item, "name") ?? "";
            var imageInventory = KvHelper.GetString(item, "image_inventory");
            var itemDescription = KvHelper.GetString(item, "item_description");
            var usedByClasses = KvHelper.GetChild(item, "used_by_classes");
            var teams = GetTeams(usedByClasses, CS2ItemTeam.Both);
            var id = GetItemId(ctx, $"glove_{GetTeamsString(usedByClasses, "3_2")}_{itemDef}");

            Translations.AddTranslation(ctx, id, "name", itemName);
            Translations.AddTranslation(ctx, id, "desc", itemDescription);

            string image;
            if (imageInventory != null)
                image = CatalogAssets.GetImage(ctx, imageInventory);
            else
                image = CatalogAssets.RequireStaticAsset(ctx, $"/images/{name}.png");

            AddItem(ctx, new CS2Item
            {
                Base = true,
                ClassName = name,
                Def = int.Parse(itemDef),
                DescToken = itemDescription,
                Free = baseitem == "1" ? true : null,
                Id = id,
                Image = image,
                Index = baseitem == "1" ? null : 0,
                Model = name,
                NameToken = itemName,
                Rarity = SourceDataLoader.GetRarityColorHex(ctx, [baseitem == "1" ? "default" : "ancient"]),
                Teams = (int)teams,
                Type = CS2ItemType.Gloves
            });
        }
    }

    private static void ParseUtilities(ItemGeneratorContext ctx)
    {
        foreach (var entry in KvHelper.GetMergedSection(ctx.GameItems!, "items"))
        {
            var itemDef = entry.Key;
            var item = entry.Value;
            var flexSlot = KvHelper.GetString(item, "flexible_loadout_slot");
            if (flexSlot == null || !flexSlot.StartsWith("grenade")) continue;

            var name = KvHelper.GetString(item, "name") ?? "";
            var prefab = KvHelper.GetString(item, "prefab");
            var imageInventory = KvHelper.GetString(item, "image_inventory");
            var prefabData = GetPrefab(ctx, prefab);
            if (prefabData == null) continue;

            var itemName = KvHelper.GetString(prefabData, "item_name");
            var itemDescription = KvHelper.GetString(prefabData, "item_description");
            var id = GetItemId(ctx, $"utility_{itemDef}");

            Translations.AddTranslation(ctx, id, "name", itemName);
            Translations.AddTranslation(ctx, id, "desc", itemDescription);

            AddItem(ctx, new CS2Item
            {
                Base = true,
                ClassName = name,
                Def = int.Parse(itemDef),
                DescToken = itemDescription,
                Free = true,
                Id = id,
                Image = imageInventory != null ? CatalogAssets.GetImage(ctx, imageInventory) : CatalogAssets.GetBaseImage(ctx, name),
                Index = null,
                Model = name.Replace("weapon_", ""),
                NameToken = itemName,
                Rarity = SourceDataLoader.GetRarityColorHex(ctx, ["default"]),
                Teams = (int)CS2ItemTeam.Both,
                Type = CS2ItemType.Utility
            });
        }
    }

    private static void ParsePaintKits(ItemGeneratorContext ctx)
    {
        foreach (var paintKit in ctx.PaintKits)
        {
            foreach (var baseItem in ctx.BaseItems)
            {
                if (!CatalogAssets.IsPaintImageValid(ctx, baseItem.ClassName, paintKit.ClassName))
                    continue;

                var itemKey = $"[{paintKit.ClassName}]{baseItem.ClassName}";
                if (baseItem.Type == CS2ItemType.Weapon && !ctx.GameItemsAsText.Contains(itemKey))
                    continue;

                var id = GetItemId(ctx, $"paint_{baseItem.Def}_{paintKit.Index}");
                Collections.AddContainerItem(ctx, itemKey, id);
                Translations.AddTranslation(ctx, id, "name", baseItem.NameToken, " | ", paintKit.NameToken);
                Translations.AddTranslation(ctx, id, "desc", paintKit.DescToken);

                var compositeMaterialPath = MaterialPaths.GetPaintCompositeMaterialPath(
                    paintKit.ClassName, paintKit.CompositeMaterialPath);
                string? paintMaterial = null;
                if (ctx.Mode == ItemGeneratorMode.Full)
                {
                    try
                    {
                        var resolved = MaterialPaths.ResolveMaterialResourcePath(ctx, compositeMaterialPath);
                        paintMaterial = $"/materials/{MaterialPaths.GetIndexedCompositeMaterialFilename(ctx, resolved)}";
                        ctx.CompositeMaterialsToProcess.Add(MaterialPaths.NormalizeMaterialResourcePath(resolved));
                    }
                    catch { }
                }

                var (collection, collectionImage) = Collections.GetItemCollection(ctx, id, itemKey);
                var rarity = MeleeOrGlovesTypes.Contains(baseItem.Type)
                    ? SourceDataLoader.GetRarityColorHex(ctx, [baseItem.Rarity, paintKit.RarityColorHex])
                    : SourceDataLoader.GetRarityColorHex(ctx, [itemKey, paintKit.RarityColorHex]);

                AddItem(ctx, new CS2Item
                {
                    AltName = GetPaintAltName(paintKit.ClassName),
                    BaseId = baseItem.Id,
                    Category = baseItem.Category,
                    ClassName = baseItem.ClassName,
                    Collection = collection,
                    CollectionImage = collectionImage,
                    Def = baseItem.Def,
                    Id = id,
                    Image = CatalogAssets.GetPaintImage(ctx, baseItem.ClassName, paintKit.ClassName),
                    Index = paintKit.Index,
                    Legacy = (baseItem.Type == CS2ItemType.Weapon && paintKit.IsLegacy) ? true : null,
                    Model = baseItem.Model,
                    NameToken = baseItem.NameToken,
                    PaintMaterial = paintMaterial,
                    Rarity = rarity,
                    Teams = baseItem.Teams,
                    Type = baseItem.Type,
                    WearMax = paintKit.WearMax,
                    WearMin = paintKit.WearMin
                });
            }
        }
    }

    private static void ParseMusicKits(ItemGeneratorContext ctx)
    {
        var baseId = CreateStub(ctx, "musickit", "#CSGO_musickit_desc");
        foreach (var entry in KvHelper.GetMergedSection(ctx.GameItems!, "music_definitions"))
        {
            var index = entry.Key;
            if (index == "2") continue;
            var name = KvHelper.GetString(entry.Value, "name") ?? "";
            var locName = KvHelper.GetString(entry.Value, "loc_name");
            var locDescription = KvHelper.GetString(entry.Value, "loc_description");
            var imageInventory = KvHelper.GetString(entry.Value, "image_inventory");
            if (imageInventory == null) continue;

            var itemKey = $"[{name}]musickit";
            var id = GetItemId(ctx, $"musickit_{index}");
            var isBase = Config.FreeMusicKits.Contains(index) ? true : (bool?)null;

            Collections.AddContainerItem(ctx, itemKey, id);
            Translations.AddTranslation(ctx, id, "name", "#CSGO_Type_MusicKit", " | ", locName);
            Translations.AddTranslation(ctx, id, "desc", locDescription);

            AddItem(ctx, new CS2Item
            {
                Base = isBase,
                BaseId = baseId,
                Def = 1314,
                Free = isBase,
                Id = id,
                Image = CatalogAssets.GetImage(ctx, imageInventory),
                Index = int.Parse(index),
                Rarity = SourceDataLoader.GetRarityColorHex(ctx, ["rare"]),
                Type = CS2ItemType.MusicKit
            });
            ctx.ItemNames[id] = $"music_kit-{index}";
        }
    }

    private static void ParseKeychains(ItemGeneratorContext ctx)
    {
        ctx.KeychainBaseId = CreateStub(ctx, "keychain", "#CSGO_Tool_Keychain_Desc");
        foreach (var entry in KvHelper.GetMergedSection(ctx.GameItems!, "keychain_definitions"))
        {
            var index = entry.Key;
            var name = KvHelper.GetString(entry.Value, "name") ?? "";
            var locName = KvHelper.GetString(entry.Value, "loc_name");
            var locDescription = KvHelper.GetString(entry.Value, "loc_description");
            var itemRarity = KvHelper.GetString(entry.Value, "item_rarity") ?? "";
            var imageInventory = KvHelper.GetString(entry.Value, "image_inventory");

            if (!Translations.HasTranslation(ctx, locName)) continue;
            if (imageInventory == null || !CatalogAssets.IsImageValid(ctx, imageInventory)) continue;

            var id = GetItemId(ctx, $"keychain_{index}");
            var itemKey = $"[{name}]keychain";
            Collections.AddContainerItem(ctx, itemKey, id);
            Translations.AddTranslation(ctx, id, "name", "#CSGO_Tool_Keychain", " | ", locName);
            Translations.TryAddTranslation(ctx, id, "desc", locDescription);

            AddItem(ctx, new CS2Item
            {
                BaseId = ctx.KeychainBaseId,
                Free = index == "37" ? true : null,
                Def = 1355,
                Id = id,
                Image = CatalogAssets.GetImage(ctx, imageInventory),
                Index = int.Parse(index),
                Rarity = SourceDataLoader.GetRarityColorHex(ctx, [itemKey, itemRarity]),
                Type = CS2ItemType.Keychain
            });
        }
    }

    private static async Task ParseStickers(ItemGeneratorContext ctx)
    {
        var baseId = CreateStub(ctx, "sticker", "#CSGO_Tool_Sticker_Desc", "stickers/dev/sticker_preview_mesh.vmdl");
        foreach (var entry in KvHelper.GetMergedSection(ctx.GameItems!, "sticker_kits"))
        {
            var index = entry.Key;
            var sticker = entry.Value;
            var name = KvHelper.GetString(sticker, "name") ?? "";
            var itemName = KvHelper.GetString(sticker, "item_name") ?? "";
            var stickerMaterial = KvHelper.GetString(sticker, "sticker_material") ?? "";
            var tournamentEventId = KvHelper.GetString(sticker, "tournament_event_id");
            var itemRarity = KvHelper.GetString(sticker, "item_rarity") ?? "";
            var descriptionString = KvHelper.GetString(sticker, "description_string");

            if (name == "default" || itemName.Contains("SprayKit") || name.Contains("spray_") ||
                name.Contains("patch_") || stickerMaterial.Contains("_graffiti") ||
                !Translations.HasTranslation(ctx, itemName))
                continue;

            var (category, categoryToken) = GetStickerCategory(ctx, stickerMaterial, tournamentEventId);
            var id = GetItemId(ctx, $"sticker_{index}");
            var itemKey = $"[{name}]sticker";
            var rarity = SourceDataLoader.GetRarityColorHex(ctx, [itemKey, itemRarity]);
            var paintMaterial = GetStickerCompositeMaterial(ctx, stickerMaterial);

            Collections.AddContainerItem(ctx, itemKey, id);
            Translations.AddTranslation(ctx, id, "name", "#CSGO_Tool_Sticker", " | ", itemName);
            Translations.AddTranslation(ctx, id, "category", categoryToken ?? category);
            Translations.TryAddTranslation(ctx, id, "desc", descriptionString);

            if (tournamentEventId != null)
                Translations.AddFormattedTranslation(ctx, id, "tournamentDesc", "#CSGO_Event_Desc",
                    $"#CSGO_Tournament_Event_Name_{tournamentEventId}");

            AddItem(ctx, new CS2Item
            {
                BaseId = baseId,
                Def = 1209,
                Id = id,
                Image = CatalogAssets.GetImage(ctx, $"econ/stickers/{stickerMaterial}"),
                Index = int.Parse(index),
                PaintMaterial = paintMaterial,
                Rarity = rarity,
                Type = CS2ItemType.Sticker
            });
            ctx.ItemNames[id] = $"sticker-{index}";

            var keychainInventoryImage = $"econ/stickers/{stickerMaterial}_1355_37";
            var keychainId = GetItemId(ctx, $"keychain_37_{index}");
            string? keychainImage;
            if (CatalogAssets.IsImageValid(ctx, keychainInventoryImage))
                keychainImage = CatalogAssets.GetImage(ctx, keychainInventoryImage);
            else
                keychainImage = await CatalogAssets.TryGetFallbackImage(ctx, "keychain", keychainInventoryImage);
            if (keychainImage == null) continue;

            Translations.AddTranslation(ctx, keychainId, "name", "#keychain_kc_sticker_display_case", " | ", itemName);
            Translations.TryAddTranslation(ctx, keychainId, "desc", "#keychain_kc_sticker_display_case_desc");

            AddItem(ctx, new CS2Item
            {
                BaseId = ctx.KeychainBaseId,
                Def = 1355,
                Id = keychainId,
                Image = keychainImage,
                Index = 37,
                Rarity = rarity,
                StickerId = id,
                Type = CS2ItemType.Keychain
            });
        }
    }

    private static void ParseGraffiti(ItemGeneratorContext ctx)
    {
        var baseId = CreateStub(ctx, "graffiti", "#CSGO_Tool_SprayPaint_Desc");
        foreach (var entry in KvHelper.GetMergedSection(ctx.GameItems!, "sticker_kits"))
        {
            var index = entry.Key;
            var sticker = entry.Value;
            var name = KvHelper.GetString(sticker, "name") ?? "";
            var itemName = KvHelper.GetString(sticker, "item_name") ?? "";
            var stickerMaterial = KvHelper.GetString(sticker, "sticker_material") ?? "";
            var itemRarity = KvHelper.GetString(sticker, "item_rarity") ?? "";
            var descriptionString = KvHelper.GetString(sticker, "description_string");
            var tournamentEventId = KvHelper.GetString(sticker, "tournament_event_id");

            if (!Translations.HasTranslation(ctx, itemName)) continue;
            var isGraffiti = name.StartsWith("spray_") || itemName.Contains("#SprayKit") ||
                itemName.StartsWith("spray_") || (descriptionString?.Contains("#SprayKit") ?? false) ||
                stickerMaterial.Contains("_graffiti");
            if (!isGraffiti) continue;

            var itemKey = $"[{name}]spray";

            if (stickerMaterial.StartsWith("default"))
            {
                foreach (var tint in ctx.GraffitiTints)
                {
                    var id = GetItemId(ctx, $"spray_{index}_{tint.Id}");
                    Collections.AddContainerItem(ctx, itemKey, id);
                    Translations.AddTranslation(ctx, id, "name", "#CSGO_Type_Spray", " | ", itemName, " (", tint.NameToken, ")");
                    Translations.AddTranslation(ctx, id, "desc", descriptionString);

                    AddItem(ctx, new CS2Item
                    {
                        BaseId = baseId,
                        Id = id,
                        Image = CatalogAssets.GetDefaultGraffitiImage(ctx, stickerMaterial, tint.HexColor),
                        Index = int.Parse(index),
                        Rarity = SourceDataLoader.GetRarityColorHex(ctx, [itemRarity]),
                        Tint = tint.Id,
                        Type = CS2ItemType.Graffiti
                    });
                    ctx.ItemNames[id] = $"graffiti-{index}";
                }
                continue;
            }

            var graffitiId = GetItemId(ctx, $"spray_{index}");
            Collections.AddContainerItem(ctx, itemKey, graffitiId);
            Translations.AddTranslation(ctx, graffitiId, "name", "#CSGO_Type_Spray", " | ", itemName);
            Translations.AddTranslation(ctx, graffitiId, "desc", descriptionString);
            if (tournamentEventId != null)
                Translations.AddFormattedTranslation(ctx, graffitiId, "tournamentDesc", "#CSGO_Event_Desc",
                    $"#CSGO_Tournament_Event_Name_{tournamentEventId}");

            AddItem(ctx, new CS2Item
            {
                BaseId = baseId,
                Def = 1348,
                Id = graffitiId,
                Image = CatalogAssets.GetImage(ctx, $"econ/stickers/{stickerMaterial}"),
                Index = int.Parse(index),
                Rarity = SourceDataLoader.GetRarityColorHex(ctx, [itemKey, itemRarity]),
                Type = CS2ItemType.Graffiti
            });
            ctx.ItemNames[graffitiId] = $"graffiti-{index}";
        }
    }

    private static void ParsePatches(ItemGeneratorContext ctx)
    {
        var baseId = CreateStub(ctx, "patch", "#CSGO_Tool_Patch_Desc");
        foreach (var entry in KvHelper.GetMergedSection(ctx.GameItems!, "sticker_kits"))
        {
            var index = entry.Key;
            var sticker = entry.Value;
            var name = KvHelper.GetString(sticker, "name") ?? "";
            var itemName = KvHelper.GetString(sticker, "item_name") ?? "";
            var patchMaterial = KvHelper.GetString(sticker, "patch_material");
            var descriptionString = KvHelper.GetString(sticker, "description_string");
            var tournamentEventId = KvHelper.GetString(sticker, "tournament_event_id");
            var itemRarity = KvHelper.GetString(sticker, "item_rarity") ?? "";

            if (!itemName.StartsWith("#PatchKit") && patchMaterial == null) continue;

            var id = GetItemId(ctx, $"patch_{index}");
            var itemKey = $"[{name}]patch";
            Collections.AddContainerItem(ctx, itemKey, id);
            Translations.AddTranslation(ctx, id, "name", "#CSGO_Tool_Patch", " | ", itemName);
            Translations.AddTranslation(ctx, id, "desc", descriptionString);
            if (tournamentEventId != null)
                Translations.AddFormattedTranslation(ctx, id, "tournamentDesc", "#CSGO_Event_Desc",
                    $"#CSGO_Tournament_Event_Name_{tournamentEventId}");

            AddItem(ctx, new CS2Item
            {
                BaseId = baseId,
                Def = 4609,
                Id = id,
                Image = CatalogAssets.GetImage(ctx, $"econ/patches/{patchMaterial}"),
                Index = int.Parse(index),
                Rarity = SourceDataLoader.GetRarityColorHex(ctx, [itemKey, itemRarity]),
                Type = CS2ItemType.Patch
            });
            ctx.ItemNames[id] = $"patch-{index}";
        }
    }

    private static void ParseAgents(ItemGeneratorContext ctx)
    {
        foreach (var entry in KvHelper.GetMergedSection(ctx.GameItems!, "items"))
        {
            var index = entry.Key;
            var item = entry.Value;
            var name = KvHelper.GetString(item, "name") ?? "";
            var itemName = KvHelper.GetString(item, "item_name");
            var usedByClasses = KvHelper.GetChild(item, "used_by_classes");
            var imageInventory = KvHelper.GetString(item, "image_inventory");
            var playerModel = KvHelper.GetString(item, "model_player");
            var itemRarity = KvHelper.GetString(item, "item_rarity") ?? "";
            var prefab = KvHelper.GetString(item, "prefab");
            var itemDescription = KvHelper.GetString(item, "item_description");

            if (itemName == null || usedByClasses == null || imageInventory == null ||
                playerModel == null || prefab != "customplayertradable")
                continue;

            var teams = GetTeams(usedByClasses);
            var id = GetItemId(ctx, $"agent_{GetTeamsString(usedByClasses)}_{index}");
            var model = playerModel.Replace("characters/models/", "").Replace(".vmdl", "");

            Translations.AddTranslation(ctx, id, "name", "#Type_CustomPlayer", " | ", itemName);
            Translations.AddTranslation(ctx, id, "desc", itemDescription);

            var (collection, collectionImage) = Collections.GetItemCollection(ctx, id, name);
            AddItem(ctx, new CS2Item
            {
                Collection = collection,
                CollectionImage = collectionImage,
                Def = int.Parse(index),
                Id = id,
                Image = CatalogAssets.GetImage(ctx, imageInventory),
                Index = null,
                Model = model,
                Rarity = SourceDataLoader.GetRarityColorHex(ctx, [name, itemRarity]),
                Teams = (int)teams,
                Type = CS2ItemType.Agent
            });
        }
    }

    private static async Task ParseCollectibles(ItemGeneratorContext ctx)
    {
        foreach (var entry in KvHelper.GetMergedSection(ctx.GameItems!, "items"))
        {
            var index = entry.Key;
            var item = entry.Value;
            var name = KvHelper.GetString(item, "name") ?? "";
            var imageInventory = KvHelper.GetString(item, "image_inventory");
            var itemName = KvHelper.GetString(item, "item_name");
            var itemRarity = KvHelper.GetString(item, "item_rarity") ?? "";
            var itemDescription = KvHelper.GetString(item, "item_description");
            var tool = KvHelper.GetChild(item, "tool");
            var attributes = KvHelper.GetChild(item, "attributes");

            if (imageInventory == null || itemName == null) continue;
            if (!imageInventory.Contains("/status_icons/") && !imageInventory.Contains("/premier_seasons/")) continue;
            if (KvHelper.GetString(tool, "use_string") == "#ConsumeItem") continue;

            var supplyCrate = KvHelper.GetChild(attributes, "set supply crate series");
            if (KvHelper.GetString(supplyCrate, "attribute_class") == "supply_crate_series") continue;
            if (itemName.StartsWith("#CSGO_TournamentPass")) continue;
            if (!KvHelper.HasKey(attributes, "pedestal display model")) continue;

            var id = GetItemId(ctx, $"pin_{index}");
            string? image;
            if (CatalogAssets.IsImageValid(ctx, imageInventory))
                image = CatalogAssets.GetImage(ctx, imageInventory);
            else
                image = await CatalogAssets.TryGetFallbackImage(ctx, "collectible", imageInventory);
            if (image == null) continue;

            Collections.AddContainerItem(ctx, name, id);
            Translations.AddTranslation(ctx, id, "name", "#CSGO_Type_Collectible", " | ", itemName);
            Translations.TryAddTranslation(ctx, id, "desc", itemDescription ?? $"{itemName}_Desc");

            var tournamentEvent = KvHelper.GetChild(attributes, "tournament event id");
            if (tournamentEvent != null)
            {
                var eventValue = KvHelper.GetString(tournamentEvent, "value");
                if (eventValue != null)
                    Translations.AddFormattedTranslation(ctx, id, "tournamentDesc", "#CSGO_Event_Desc",
                        $"#CSGO_Tournament_Event_Name_{eventValue}");
            }

            AddItem(ctx, new CS2Item
            {
                AltName = name,
                Def = int.Parse(index),
                Id = id,
                Image = image,
                Index = null,
                Rarity = SourceDataLoader.GetRarityColorHex(ctx, [itemRarity, "ancient"]),
                Type = CS2ItemType.Collectible
            });
            ctx.ItemNames[id] = $"collectible-{index}";
        }
    }

    private static void ParseTools(ItemGeneratorContext ctx)
    {
        foreach (var entry in KvHelper.GetMergedSection(ctx.GameItems!, "items"))
        {
            var index = entry.Key;
            var item = entry.Value;
            var name = KvHelper.GetString(item, "name") ?? "";
            var baseitem = KvHelper.GetString(item, "baseitem");
            var itemName = KvHelper.GetString(item, "item_name");
            var imageInventory = KvHelper.GetString(item, "image_inventory");
            var prefab = KvHelper.GetString(item, "prefab");
            var itemDescription = KvHelper.GetString(item, "item_description");

            if (prefab != "recipe" &&
                (itemName == null || imageInventory == null ||
                 !imageInventory.Contains("econ/tools/") ||
                 prefab == null || !prefab.Contains("csgo_tool")))
                continue;

            var id = GetItemId(ctx, $"tool_{index}");
            var prefabData = prefab != null ? KvHelper.FindInMergedSection(ctx.GameItems!, "prefabs", prefab) : null;
            var image = imageInventory ?? KvHelper.GetString(prefabData, "image_inventory") ?? "";

            Collections.AddContainerItem(ctx, name, id);
            Translations.AddTranslation(ctx, id, "name", "#CSGO_Type_Tool", " | ", itemName);
            Translations.AddTranslation(ctx, id, "desc", itemDescription);

            AddItem(ctx, new CS2Item
            {
                Def = int.Parse(index),
                Free = baseitem == "1" && index != Config.RemoveKeychainToolIndex ? true : null,
                Id = id,
                Image = CatalogAssets.GetImage(ctx, image),
                Index = null,
                Rarity = SourceDataLoader.GetRarityColorHex(ctx, ["common"]),
                Type = CS2ItemType.Tool
            });
        }
    }

    private static async Task ParseContainers(ItemGeneratorContext ctx)
    {
        var keyItems = new Dictionary<string, int>();

        foreach (var entry in KvHelper.GetMergedSection(ctx.GameItems!, "items"))
        {
            var containerIndex = entry.Key;
            var item = entry.Value;
            var itemName = KvHelper.GetString(item, "item_name");
            var imageInventory = KvHelper.GetString(item, "image_inventory");
            var prefab = KvHelper.GetString(item, "prefab");
            var lootListName = KvHelper.GetString(item, "loot_list_name");
            var imageUnusualItem = KvHelper.GetString(item, "image_unusual_item");
            var itemDescription = KvHelper.GetString(item, "item_description");
            var name = KvHelper.GetString(item, "name") ?? "";
            var tool = KvHelper.GetChild(item, "tool");
            var tags = KvHelper.GetChild(item, "tags");
            var attributes = KvHelper.GetChild(item, "attributes");
            var associatedItems = KvHelper.GetChild(item, "associated_items");

            var supplyCrate = KvHelper.GetChild(attributes, "set supply crate series");
            var hasSupplyCrateSeries = KvHelper.GetString(supplyCrate, "attribute_class") == "supply_crate_series";

            if (itemName == null || imageInventory == null) continue;
            if (!imageInventory.Contains("econ/weapon_cases") && !hasSupplyCrateSeries) continue;
            if (KvHelper.GetString(tool, "type") == "gift") continue;
            if (prefab != "weapon_case" && !hasSupplyCrateSeries && lootListName == null) continue;

            var revolvingKey = KvHelper.GetString(supplyCrate, "value");
            var clientLootListKey = revolvingKey != null
                ? KvHelper.FindInMergedSection(ctx.GameItems!, "revolving_loot_lists", revolvingKey)?.ToString()
                : lootListName;
            if (clientLootListKey == null) continue;

            string? contentsType = null;
            var contents = new List<int>();
            foreach (var itemKey in Collections.GetClientLootListItems(ctx, clientLootListKey))
            {
                if (!ctx.ContainerItems.TryGetValue(itemKey, out var containedId)) continue;
                if (!ctx.Items.TryGetValue(containedId, out var contained)) continue;
                contentsType = contained.Type;
                if (contained.Tint != null && contained.Index != null)
                {
                    foreach (var other in ctx.Items.Values)
                    {
                        if (other.Tint != null && other.Index == contained.Index)
                            contents.Add(other.Id);
                    }
                }
                else
                {
                    contents.Add(containedId);
                }
            }

            var specials = new List<int>();
            await Sources.External.PopulateContainerContents(itemName, contents, ctx.ItemNames);
            await Sources.External.PopulateContainerSpecials(itemName, specials, ctx.ItemNames);
            if (contents.Count == 0) continue;

            // Parse keys
            var keys = new List<int>();
            if (associatedItems != null)
            {
                foreach (var assoc in associatedItems)
                {
                    var keyItemDef = assoc.Key;
                    if (keyItems.TryGetValue(keyItemDef, out var existingKeyId))
                    {
                        keys.Add(existingKeyId);
                        continue;
                    }
                    var keyItem = KvHelper.FindInMergedSection(ctx.GameItems!, "items", keyItemDef);
                    if (keyItem == null) continue;
                    var keyImageInventory = KvHelper.GetString(keyItem, "image_inventory");
                    if (keyImageInventory == null) continue;

                    var keyId = GetItemId(ctx, $"key_{keyItemDef}");
                    var keyNameToken = KvHelper.GetString(keyItem, "item_name") ?? "#CSGO_base_crate_key";
                    keyItems[keyItemDef] = keyId;
                    Translations.AddTranslation(ctx, keyId, "name", "#CSGO_Tool_WeaponCase_KeyTag", " | ", keyNameToken);
                    Translations.TryAddTranslation(ctx, keyId, "desc", KvHelper.GetString(keyItem, "item_description"));

                    AddItem(ctx, new CS2Item
                    {
                        Def = int.Parse(keyItemDef),
                        Id = keyId,
                        Image = CatalogAssets.GetImage(ctx, keyImageInventory),
                        Rarity = SourceDataLoader.GetRarityColorHex(ctx, ["common"]),
                        Type = CS2ItemType.Key
                    });
                    keys.Add(keyId);
                }
            }

            var id = GetItemId(ctx, $"case_{containerIndex}");
            string? containerImage;
            if (CatalogAssets.IsImageValid(ctx, imageInventory))
                containerImage = CatalogAssets.GetImage(ctx, imageInventory);
            else
                containerImage = await CatalogAssets.TryGetFallbackImage(ctx, "container", imageInventory);
            if (containerImage == null) continue;

            var containerName = Translations.RequireTranslation(ctx, itemName);
            var containsMusicKit = containerName.Contains("Music Kit");
            var containsStatTrak = containerName.Contains("StatTrak");

            Translations.AddTranslation(ctx, id, "name", "#CSGO_Type_WeaponCase", " | ", itemName);
            Translations.TryAddTranslation(ctx, id, "desc", itemDescription);

            var itemSetTag = KvHelper.GetChild(tags, "ItemSet");
            var tagValue = KvHelper.GetString(itemSetTag, "tag_value");
            var (collection, collectionImage) = Collections.GetCollection(ctx, id, tagValue);

            AddItem(ctx, new CS2Item
            {
                Collection = collection,
                CollectionImage = collectionImage,
                ContainerType = Collections.GetContainerType(containerName, contentsType),
                Contents = contents,
                Def = int.Parse(containerIndex),
                Id = id,
                Image = containerImage,
                Keys = keys.Count > 0 ? keys : null,
                Rarity = SourceDataLoader.GetRarityColorHex(ctx, ["common"]),
                Specials = specials.Count > 0 ? specials
                    : ctx.ExistingItemsById.TryGetValue(id, out var prev) ? prev.Specials : null,
                SpecialsImage = CatalogAssets.GetSpecialsImage(ctx, imageUnusualItem),
                StatTrakless = containsMusicKit && !containsStatTrak ? true : null,
                StatTrakOnly = containsMusicKit && containsStatTrak ? true : null,
                Type = CS2ItemType.Container
            });
        }
    }

    // --- Helper methods ---

    private static int GetItemId(ItemGeneratorContext ctx, string identifier)
    {
        if (ctx.UniqueIdentifiers.Contains(identifier))
            throw new InvalidOperationException($"Duplicate identifier: {identifier}");
        ctx.UniqueIdentifiers.Add(identifier);

        var index = ctx.AllIdentifiers.IndexOf(identifier);
        if (index == -1)
        {
            ctx.AllIdentifiers.Add(identifier);
            return ctx.AllIdentifiers.Count - 1;
        }
        return index;
    }

    private static void AddItem(ItemGeneratorContext ctx, CS2Item item)
    {
        HydrateExistingModelFields(ctx, item);
        if (item.Base == true)
            ctx.BaseItems.Add(item);
        ctx.Items[item.Id] = item;
    }

    private static void HydrateExistingModelFields(ItemGeneratorContext ctx, CS2Item item)
    {
        if (ctx.Mode != ItemGeneratorMode.Limited) return;
        if (!ctx.ExistingItemsById.TryGetValue(item.Id, out var previous)) return;

        item.PaintMaterial ??= previous.PaintMaterial;
        item.PlayerModel ??= previous.PlayerModel;
        item.LegacyStickerSchemaCount ??= previous.LegacyStickerSchemaCount;
        item.StickerSchemaCount ??= previous.StickerSchemaCount;
        item.StickerOffsetXMin ??= previous.StickerOffsetXMin;
        item.StickerOffsetXMax ??= previous.StickerOffsetXMax;
        item.StickerOffsetYMin ??= previous.StickerOffsetYMin;
        item.StickerOffsetYMax ??= previous.StickerOffsetYMax;
        item.LegacyStickerOffsetXMin ??= previous.LegacyStickerOffsetXMin;
        item.LegacyStickerOffsetXMax ??= previous.LegacyStickerOffsetXMax;
        item.LegacyStickerOffsetYMin ??= previous.LegacyStickerOffsetYMin;
        item.LegacyStickerOffsetYMax ??= previous.LegacyStickerOffsetYMax;
    }

    private static int CreateStub(ItemGeneratorContext ctx, string name, string descToken, string? model = null)
    {
        var id = GetItemId(ctx, $"stub_{name}");
        Translations.AddTranslation(ctx, id, "name", "#Rarity_Default");
        Translations.AddTranslation(ctx, id, "desc", descToken);

        var modelInfo = CatalogAssets.GetModel(ctx, model, id);
        var item = new CS2Item
        {
            Id = id,
            PlayerModel = modelInfo,
            Type = CS2ItemType.Stub
        };
        AddItem(ctx, item);
        return id;
    }

    private static ValveKeyValue.KVObject? GetPrefab(ItemGeneratorContext ctx, string? prefab)
    {
        if (prefab == null) return null;
        return KvHelper.FindInMergedSection(ctx.GameItems!, "prefabs", prefab);
    }

    private static CS2ItemTeam GetTeams(ValveKeyValue.KVObject? teams, CS2ItemTeam fallback = CS2ItemTeam.Both)
    {
        if (teams == null) return fallback;
        var keys = teams.Select(kv => kv.Key).ToList();
        var ct = keys.Contains("counter-terrorists");
        var t = keys.Contains("terrorists");
        return (ct, t) switch
        {
            (true, true) => CS2ItemTeam.Both,
            (true, false) => CS2ItemTeam.CT,
            (false, true) => CS2ItemTeam.T,
            _ => fallback
        };
    }

    private static string GetTeamsString(ValveKeyValue.KVObject? teams, string? fallback = null)
    {
        if (teams == null) return fallback ?? "3_2";
        var parts = new List<string>();
        foreach (var kv in teams)
        {
            switch (kv.Key)
            {
                case "counter-terrorists": parts.Add("3"); break;
                case "terrorists": parts.Add("2"); break;
            }
        }
        return parts.Count > 0 ? string.Join("_", parts) : (fallback ?? "3_2");
    }

    private static string GetBaseWeaponCategory(string name, string category)
    {
        return Config.HeavyWeapons.Contains(name) ? "heavy" : category;
    }

    private static string? GetPaintAltName(string className)
    {
        if (className.Contains("_phase"))
        {
            var match = Config.SkinPhaseRe.Match(className);
            return match.Success ? $"Phase {match.Groups[1].Value}" : null;
        }
        if (className.Contains("sapphire_marbleized")) return "Sapphire";
        if (className.Contains("ruby_marbleized")) return "Ruby";
        if (className.Contains("blackpearl_marbleized")) return "Black Pearl";
        if (className.Contains("emerald_marbleized")) return "Emerald";
        return null;
    }

    private static (string Category, string? CategoryToken) GetStickerCategory(
        ItemGeneratorContext ctx, string stickerMaterial, string? tournamentEventId)
    {
        string? category = null;
        string? categoryToken = null;
        var parts = stickerMaterial.Split('/');
        var folder = parts.Length > 0 ? parts[0] : "";
        var subfolder = parts.Length > 1 ? parts[1] : "";

        if (folder == "alyx")
        {
            categoryToken = "#CSGO_crate_sticker_pack_hlalyx_capsule";
            category = Translations.FindTranslation(ctx, categoryToken);
        }
        if (subfolder == "elemental_craft")
        {
            categoryToken = "#CSGO_crate_sticker_pack_stkr_craft_01_capsule";
            category = Translations.FindTranslation(ctx, categoryToken);
        }
        if (Config.UncategorizedStickers.Contains(folder))
        {
            category = "Valve";
            categoryToken = null;
        }
        if (category == null)
        {
            categoryToken = $"#CSGO_crate_sticker_pack_{folder}";
            category = Translations.FindTranslation(ctx, categoryToken);
        }
        if (category == null)
        {
            categoryToken = $"#CSGO_crate_sticker_pack_{folder}_capsule";
            category = Translations.FindTranslation(ctx, categoryToken);
        }
        if (tournamentEventId != null)
        {
            categoryToken = $"#CSGO_Tournament_Event_NameShort_{tournamentEventId}";
            category = Translations.FindTranslation(ctx, categoryToken);
        }
        if (category == null)
        {
            categoryToken = $"#CSGO_crate_sticker_pack_{subfolder}_capsule";
            category = Translations.FindTranslation(ctx, categoryToken);
        }
        if (category == null)
        {
            categoryToken = $"#CSGO_sticker_crate_key_{folder}";
            category = Translations.FindTranslation(ctx, categoryToken);
        }

        return (category ?? "Valve", categoryToken);
    }

    private static string? GetStickerCompositeMaterial(ItemGeneratorContext ctx, string stickerMaterial)
    {
        if (ctx.Mode != ItemGeneratorMode.Full) return null;
        try
        {
            var resolvedPath = MaterialPaths.ResolveMaterialResourcePath(ctx,
                MaterialPaths.GetStickerMaterialPath(stickerMaterial));
            var normalized = MaterialPaths.NormalizeMaterialResourcePath(resolvedPath);
            ctx.MaterialsToProcess.Add(normalized);
            return $"/materials/{MaterialPaths.GetIndexedVmatFilename(ctx, normalized)}";
        }
        catch { return null; }
    }
}
