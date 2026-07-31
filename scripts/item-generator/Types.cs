using System.Text.Json.Serialization;
using SteamDatabase.ValvePak;

namespace ItemGenerator;

public enum CS2ItemTeam { T = 0, CT = 1, Both = 2 }

public static class CS2ItemType
{
    public const string Agent = "agent";
    public const string Collectible = "collectible";
    public const string Container = "case";
    public const string Gloves = "glove";
    public const string Graffiti = "graffiti";
    public const string Key = "key";
    public const string Keychain = "keychain";
    public const string Melee = "melee";
    public const string MusicKit = "musickit";
    public const string Patch = "patch";
    public const string Sticker = "sticker";
    public const string Stub = "stub";
    public const string Tool = "tool";
    public const string Utility = "utility";
    public const string Weapon = "weapon";
}

public static class CS2ContainerType
{
    public const int WeaponCase = 0;
    public const int StickerCapsule = 1;
    public const int GraffitiBox = 2;
    public const int SouvenirCase = 3;
}

// Null means the normal roll — see CS2_STATTRAK_ODD.
public static class CS2StatTrakMode
{
    public const string Excluded = "excluded";
    public const string Guaranteed = "guaranteed";
}

public class CS2Item
{
    [JsonPropertyName("alternateName"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? AlternateName { get; set; }

    [JsonPropertyName("collectionImagePath"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? CollectionImagePath { get; set; }

    // The schema's `item_sets` key, e.g. "set_weapons_i". The display name is the collectionName
    // translation.
    [JsonPropertyName("collectionKey"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? CollectionKey { get; set; }

    [JsonPropertyName("containerType"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? ContainerType { get; set; }

    [JsonPropertyName("contentIds"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public List<int>? ContentIds { get; set; }

    // The item's key into the schema's `items` table.
    [JsonPropertyName("definitionIndex"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? DefinitionIndex { get; set; }

    // The sticker shown inside a display-case keychain.
    [JsonPropertyName("displayedStickerId"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? DisplayedStickerId { get; set; }

    // True when the model publishes a cloth collider beside its model data — the shapes a keychain
    // is pushed out of. See MetadataExtractor.ExtractClothCollider.
    [JsonPropertyName("hasColliderData"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public bool? HasColliderData { get; set; }

    [JsonPropertyName("id")]
    public int Id { get; set; }

    [JsonPropertyName("imagePath"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? ImagePath { get; set; }

    // The finishless row a model's skins hang off — a paint-kit template, not the schema's
    // `baseitem`, which this type calls IsDefault.
    [JsonPropertyName("isBase"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public bool? IsBase { get; set; }

    // The schema's `baseitem`: the game hands it to you, so it carries no wear, seed or StatTrak.
    [JsonPropertyName("isDefault"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public bool? IsDefault { get; set; }

    // The pre-CS2 body and markup generation, not a retired item.
    [JsonPropertyName("isLegacyModel"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public bool? IsLegacyModel { get; set; }

    // The keychain bounds below are absolute coordinates in the model's markup space, which is why
    // they run to 41.29 on an AWP. The sticker bounds further down are deltas from a slot's authored
    // offset and stay inside ±0.5 — hence position for one and offset for the other.
    [JsonPropertyName("keychainPositionXMax"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public double? KeychainPositionXMax { get; set; }

    [JsonPropertyName("keychainPositionXMin"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public double? KeychainPositionXMin { get; set; }

    [JsonPropertyName("keychainPositionYMax"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public double? KeychainPositionYMax { get; set; }

    [JsonPropertyName("keychainPositionYMin"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public double? KeychainPositionYMin { get; set; }

    [JsonPropertyName("keychainPositionZMax"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public double? KeychainPositionZMax { get; set; }

    [JsonPropertyName("keychainPositionZMin"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public double? KeychainPositionZMin { get; set; }

    [JsonPropertyName("keyIds"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public List<int>? KeyIds { get; set; }

    [JsonPropertyName("legacyKeychainPositionXMax"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public double? LegacyKeychainPositionXMax { get; set; }

    [JsonPropertyName("legacyKeychainPositionXMin"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public double? LegacyKeychainPositionXMin { get; set; }

    [JsonPropertyName("legacyKeychainPositionYMax"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public double? LegacyKeychainPositionYMax { get; set; }

    [JsonPropertyName("legacyKeychainPositionYMin"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public double? LegacyKeychainPositionYMin { get; set; }

    [JsonPropertyName("legacyKeychainPositionZMax"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public double? LegacyKeychainPositionZMax { get; set; }

    [JsonPropertyName("legacyKeychainPositionZMin"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public double? LegacyKeychainPositionZMin { get; set; }

    [JsonPropertyName("legacyStickerOffsetXMax"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public double? LegacyStickerOffsetXMax { get; set; }

    [JsonPropertyName("legacyStickerOffsetXMin"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public double? LegacyStickerOffsetXMin { get; set; }

    [JsonPropertyName("legacyStickerOffsetYMax"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public double? LegacyStickerOffsetYMax { get; set; }

    [JsonPropertyName("legacyStickerOffsetYMin"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public double? LegacyStickerOffsetYMin { get; set; }

    [JsonPropertyName("legacyStickerSchemaCount"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? LegacyStickerSchemaCount { get; set; }

    // The weapon's loadout slot, e.g. "rifle" or "secondary". A sticker's capsule name is the
    // categoryName translation.
    [JsonPropertyName("loadoutCategory"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? LoadoutCategory { get; set; }

    [JsonPropertyName("materialPath"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? MaterialPath { get; set; }

    // The model's identifier, e.g. "ak47" or "knife_karambit". Its .glb lives at ModelPath.
    [JsonPropertyName("modelKey"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? ModelKey { get; set; }

    [JsonPropertyName("modelPath"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? ModelPath { get; set; }

    // The item this one inherits its model, material and placement data from.
    [JsonPropertyName("parentId"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? ParentId { get; set; }

    // The seed this kit's own artwork is rendered at, not a default an instance inherits.
    [JsonPropertyName("previewSeed"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? PreviewSeed { get; set; }

    // The rarity's hex color, e.g. "#eb4b4b" — not the grade it stands for.
    [JsonPropertyName("rarityColor"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? RarityColor { get; set; }

    [JsonPropertyName("specialIds"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public List<int>? SpecialIds { get; set; }

    [JsonPropertyName("specialsImagePath"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? SpecialsImagePath { get; set; }

    // See CS2StatTrakMode.
    [JsonPropertyName("statTrakMode"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? StatTrakMode { get; set; }

    [JsonPropertyName("stickerOffsetXMax"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public double? StickerOffsetXMax { get; set; }

    [JsonPropertyName("stickerOffsetXMin"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public double? StickerOffsetXMin { get; set; }

    [JsonPropertyName("stickerOffsetYMax"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public double? StickerOffsetYMax { get; set; }

    [JsonPropertyName("stickerOffsetYMin"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public double? StickerOffsetYMin { get; set; }

    [JsonPropertyName("stickerSchemaCount"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? StickerSchemaCount { get; set; }

    // The one CS2ItemTeam that may use this item; Both covers the pair.
    [JsonPropertyName("team"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? Team { get; set; }

    // The graffiti tint's key into the schema's tint table.
    [JsonPropertyName("tintIndex"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? TintIndex { get; set; }

    [JsonPropertyName("type")]
    public string Type { get; set; } = CS2ItemType.Stub;

    // The kit's key into whichever table defines it: paint_kits, sticker_kits, music_definitions
    // or keychain_definitions.
    [JsonPropertyName("variantIndex"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? VariantIndex { get; set; }

    [JsonPropertyName("wearMax"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public double? WearMax { get; set; }

    [JsonPropertyName("wearMin"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public double? WearMin { get; set; }

    [JsonIgnore] public string? ClassName { get; set; }
    [JsonIgnore] public string? DescriptionToken { get; set; }
    [JsonIgnore] public string? NameToken { get; set; }
}

public class CS2ItemTranslation
{
    // A sticker's capsule name. A weapon's loadout slot is the item's LoadoutCategory.
    [JsonPropertyName("categoryName"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? CategoryName { get; set; }

    [JsonPropertyName("collectionDescription"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? CollectionDescription { get; set; }

    [JsonPropertyName("collectionName"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? CollectionName { get; set; }

    [JsonPropertyName("description"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Description { get; set; }

    [JsonPropertyName("name"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Name { get; set; }

    [JsonPropertyName("tournamentDescription"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? TournamentDescription { get; set; }
}

public record VpkIndexEntry(string Crc, string Fnumber, string EntryPath);

public record PaintKitRecord(
    string ClassName,
    string? CompositeMaterialPath,
    string? DescToken,
    int Index,
    bool IsLegacy,
    string NameToken,
    string RarityColorHex,
    double WearMax,
    double WearMin
);

public record GraffitiTintRecord(string HexColor, int Id, string Name, string NameToken);

// Image tasks carry a Provisional name (the CRC-derived name items reference at catalog time,
// before any bytes exist) and a FinalBase; the final CDN name is computed after encoding as
// `{FinalBase}_{contentHash8}{_FinalSuffix?}.webp` and recorded in ctx.AssetRenames.
public abstract record PendingImageTask(string Provisional, string FinalBase, string? FinalSuffix = null);
public record RegularImageTask(string LocalPath, string Provisional, string FinalBase, string? FinalSuffix = null)
    : PendingImageTask(Provisional, FinalBase, FinalSuffix);
public record PaintImageTask(List<(string Src, string Suffix)> LocalPaths, string Provisional, string FinalBase)
    : PendingImageTask(Provisional, FinalBase);
public record GraffitiImageTask(string LocalPath, string HexColor, string Provisional, string FinalBase)
    : PendingImageTask(Provisional, FinalBase);
public record SvgImageTask(string LocalPath, string Provisional, string FinalBase)
    : PendingImageTask(Provisional, FinalBase);

public record PendingModelTask
{
    public string Base { get; init; } = "";
    public string Crc { get; init; } = "";
    public string ModelData { get; set; } = "";
    public string PlayerModel { get; set; } = "";
    public HashSet<string> DirectMaterials { get; init; } = [];
}

public class ItemGeneratorContext
{
    public ItemGeneratorMode Mode { get; set; }
    public Cs2SourceMode SourceMode { get; set; }
    public string? AssetsManifestId { get; set; }
    public Package? VpkPackage { get; set; }
    public Dictionary<string, VpkIndexEntry> VpkIndex { get; set; } = [];
    public string GameItemsAsText { get; set; } = "";
    public Dictionary<string, Dictionary<string, string?>> CsgoTranslationByLanguage { get; set; } = [];
    public Dictionary<string, Dictionary<int, CS2ItemTranslation>> ItemTranslationByLanguage { get; set; } = [];
    public Dictionary<int, string> ItemNames { get; set; } = [];
    public Dictionary<string, string?> ItemSetImage { get; set; } = [];
    public Dictionary<string, string?> ItemSetItemKey { get; set; } = [];
    public Dictionary<string, string?> ItemsRaritiesColorHex { get; set; } = [];
    public Dictionary<string, string?> PaintKitsRaritiesColorHex { get; set; } = [];
    public Dictionary<string, string?> RaritiesColorHex { get; set; } = [];
    public Dictionary<string, string?> StaticAssets { get; set; } = [];
    public HashSet<string> NeededVpkPaths { get; set; } = [];
    public Dictionary<string, PendingImageTask> ImagesToProcess { get; set; } = [];
    public Dictionary<string, PendingModelTask> ModelsToProcess { get; set; } = [];
    public HashSet<string> CompositeMaterialsToProcess { get; set; } = [];
    public HashSet<string> MaterialsToProcess { get; set; } = [];
    public HashSet<string> TexturesToProcess { get; set; } = [];
    public Dictionary<string, object?> CompositeMaterialDataByPath { get; set; } = [];
    public Dictionary<string, string> CompositeMaterialFilenameByPath { get; set; } = [];
    public Dictionary<string, object?> MaterialDataByPath { get; set; } = [];
    public Dictionary<string, string> MaterialFilenameByPath { get; set; } = [];
    public Dictionary<string, string> TextureFilenameByPath { get; set; } = [];
    // Provisional asset path → final content-hashed path; applied to item fields after processing.
    public Dictionary<string, string> AssetRenames { get; set; } = [];
    public List<CS2Item> BaseItems { get; set; } = [];
    public Dictionary<string, int> ContainerItems { get; set; } = [];
    public Dictionary<int, CS2Item> Items { get; set; } = [];
    public List<PaintKitRecord> PaintKits { get; set; } = [];
    public List<GraffitiTintRecord> GraffitiTints { get; set; } = [];
    public int? KeychainParentId { get; set; }
    // The "keychain_37" (sticker display case slab) item id: the parent the per-sticker
    // display-case keychains resolve their modelPath/materialPath through.
    public int? StickerDisplayCaseKeychainId { get; set; }
    public List<string> AllIdentifiers { get; set; } = [];
    public List<string> UniqueIdentifiers { get; set; } = [];
    public Dictionary<int, CS2Item> ExistingItemsById { get; set; } = [];

    // Parsed game items (KV1)
    public ValveKeyValue.KVObject? GameItems { get; set; }
}
