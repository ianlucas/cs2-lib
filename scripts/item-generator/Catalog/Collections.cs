namespace ItemGenerator.Catalog;

public static class Collections
{
    public static (string? Collection, string? CollectionImage) GetCollection(
        ItemGeneratorContext ctx, int itemId, string? collection)
    {
        string? collectionImage = null;
        if (collection == null) return (null, null);

        // "item_sets" is split across many sections in items_game.txt; search all of them.
        var itemSet = KvHelper.FindInMergedSection(ctx.GameItems!, "item_sets", collection);
        if (itemSet == null) return (collection, null);

        var name = KvHelper.GetString(itemSet, "name");
        var setDescription = KvHelper.GetString(itemSet, "set_description");
        Translations.TryAddTranslation(ctx, itemId, "collectionName", name);
        Translations.TryAddTranslation(ctx, itemId, "collectionDesc", setDescription);

        if (ctx.ItemSetImage.TryGetValue(collection, out collectionImage))
            return (collection, collectionImage);

        return (collection, null);
    }

    public static (string? Collection, string? CollectionImage) GetItemCollection(
        ItemGeneratorContext ctx, int itemId, string itemKey)
    {
        ctx.ItemSetItemKey.TryGetValue(itemKey, out var collection);
        return GetCollection(ctx, itemId, collection);
    }

    public static void AddContainerItem(ItemGeneratorContext ctx, string itemKey, int id)
    {
        ctx.ContainerItems.TryAdd(itemKey, id);
    }

    public static List<string> GetClientLootListItems(ItemGeneratorContext ctx, string clientLootListKey, List<string>? items = null)
    {
        items ??= [];
        // items_game.txt contains many "client_loot_lists" sections; GetChild would only see
        // the first, so most container loot lists must be resolved across all merged sections.
        var lootList = KvHelper.FindInMergedSection(ctx.GameItems!, "client_loot_lists", clientLootListKey);
        if (lootList == null) return items;

        foreach (var child in lootList)
        {
            var key = child.Key;
            if (ctx.ContainerItems.ContainsKey(key))
                items.Add(key);
            else
                GetClientLootListItems(ctx, key, items);
        }

        return items;
    }

    public static int? GetContainerType(string? name, string? type)
    {
        if (name?.Contains("Souvenir") == true) return CS2ContainerType.SouvenirCase;
        if (type == CS2ItemType.Weapon) return CS2ContainerType.WeaponCase;
        if (type == CS2ItemType.Sticker) return CS2ContainerType.StickerCapsule;
        if (type == CS2ItemType.Graffiti) return CS2ContainerType.GraffitiBox;
        return null;
    }
}
