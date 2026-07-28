using System.Text.Json;
using System.Text.Json.Serialization;

namespace ItemGenerator.Emit;

public static class OutputWriter
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    private const string Banner = "/*---------------------------------------------------------------------------------------------\n *  Copyright (c) Ian Lucas. All rights reserved.\n *  Licensed under the MIT License. See License.txt in the project root for license information.\n *--------------------------------------------------------------------------------------------*/";

    public static async Task EmitOutputs(ItemGeneratorContext ctx)
    {
        var items = ctx.Items.Values
            .OrderBy(i => i.Id)
            .Select(i => new CS2Item
            {
                AlternateName = i.AlternateName,
                CollectionImagePath = i.CollectionImagePath,
                CollectionKey = i.CollectionKey,
                ContainerType = i.ContainerType,
                ContentIds = i.ContentIds,
                DefinitionIndex = i.DefinitionIndex,
                DisplayedStickerId = i.DisplayedStickerId,
                HasColliderData = i.HasColliderData,
                Id = i.Id,
                ImagePath = i.ImagePath,
                IsBase = i.IsBase,
                IsDefault = i.IsDefault,
                IsLegacyModel = i.IsLegacyModel,
                KeychainOffsetXMax = i.KeychainOffsetXMax,
                KeychainOffsetXMin = i.KeychainOffsetXMin,
                KeychainOffsetYMax = i.KeychainOffsetYMax,
                KeychainOffsetYMin = i.KeychainOffsetYMin,
                KeychainOffsetZMax = i.KeychainOffsetZMax,
                KeychainOffsetZMin = i.KeychainOffsetZMin,
                KeyIds = i.KeyIds,
                LegacyKeychainOffsetXMax = i.LegacyKeychainOffsetXMax,
                LegacyKeychainOffsetXMin = i.LegacyKeychainOffsetXMin,
                LegacyKeychainOffsetYMax = i.LegacyKeychainOffsetYMax,
                LegacyKeychainOffsetYMin = i.LegacyKeychainOffsetYMin,
                LegacyKeychainOffsetZMax = i.LegacyKeychainOffsetZMax,
                LegacyKeychainOffsetZMin = i.LegacyKeychainOffsetZMin,
                LegacyStickerOffsetXMax = i.LegacyStickerOffsetXMax,
                LegacyStickerOffsetXMin = i.LegacyStickerOffsetXMin,
                LegacyStickerOffsetYMax = i.LegacyStickerOffsetYMax,
                LegacyStickerOffsetYMin = i.LegacyStickerOffsetYMin,
                LegacyStickerSchemaCount = i.LegacyStickerSchemaCount,
                LoadoutCategory = i.LoadoutCategory,
                MaterialPath = i.MaterialPath,
                ModelKey = i.ModelKey,
                ModelPath = i.ModelPath,
                ParentId = i.ParentId,
                PreviewSeed = i.PreviewSeed,
                RarityColor = i.RarityColor,
                SpecialIds = i.SpecialIds,
                SpecialsImagePath = i.SpecialsImagePath,
                StatTrakMode = i.StatTrakMode,
                StickerOffsetXMax = i.StickerOffsetXMax,
                StickerOffsetXMin = i.StickerOffsetXMin,
                StickerOffsetYMax = i.StickerOffsetYMax,
                StickerOffsetYMin = i.StickerOffsetYMin,
                StickerSchemaCount = i.StickerSchemaCount,
                Team = i.Team,
                TintIndex = i.TintIndex,
                Type = i.Type,
                VariantIndex = i.VariantIndex,
                WearMax = i.WearMax,
                WearMin = i.WearMin
            })
            .ToList();

        var itemsJson = JsonSerializer.Serialize(items, JsonOptions);
        var idsJson = JsonSerializer.Serialize(ctx.AllIdentifiers);

        await WriteFileAsync(Config.ItemsJsonPath, itemsJson);
        await WriteFileAsync(Config.ItemIdsJsonPath, idsJson);
        await WriteFileAsync(Config.ItemsTsPath, CreateItemsModule(itemsJson));

        foreach (var (language, translations) in ctx.ItemTranslationByLanguage)
        {
            var translationsJson = SerializeTranslationMap(translations);
            var tsPath = string.Format(Config.TranslationsTsPath, language);
            await WriteFileAsync(tsPath, CreateTranslationModule(language, translationsJson));
            Console.Error.WriteLine($"Successfully generated '{tsPath}'.");

            if (language == "english")
                await WriteFileAsync(Config.EnglishJsonPath, translationsJson);
        }

        Console.Error.WriteLine($"Successfully generated '{Config.ItemsJsonPath}'.");
        Console.Error.WriteLine($"Successfully generated '{Config.ItemIdsJsonPath}'.");
        Console.Error.WriteLine($"Successfully generated '{Config.ItemsTsPath}'.");
    }

    private static string SerializeTranslationMap(Dictionary<int, CS2ItemTranslation> map)
    {
        var output = new Dictionary<string, CS2ItemTranslation>();
        foreach (var (id, translation) in map)
            output[id.ToString()] = translation;
        return JsonSerializer.Serialize(output, JsonOptions);
    }

    private static string CreateItemsModule(string itemsJson)
    {
        return Banner + "\n\nimport type { CS2Item } from \"./economy-types.ts\";\n\n// @generated\n// @ts-ignore\nexport const CS2_ITEMS: CS2Item[] = " + itemsJson + ";";
    }

    private static string CreateTranslationModule(string language, string tokensJson)
    {
        return Banner + "\n\nimport type { CS2ItemTranslationMap } from \"../economy-types.ts\";\n\n// @generated\n// @ts-ignore\nexport const " + language + ": CS2ItemTranslationMap = " + tokensJson + ";";
    }

    private static async Task WriteFileAsync(string relativePath, string content)
    {
        var fullPath = Path.Combine(Config.CwdPath, relativePath);
        Directory.CreateDirectory(Path.GetDirectoryName(fullPath)!);
        await File.WriteAllTextAsync(fullPath, content);
    }
}
