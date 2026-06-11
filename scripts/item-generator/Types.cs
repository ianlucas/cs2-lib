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

public class CS2Item
{
    [JsonPropertyName("altName"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? AltName { get; set; }

    [JsonPropertyName("base"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public bool? Base { get; set; }

    [JsonPropertyName("baseId"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? BaseId { get; set; }

    [JsonPropertyName("category"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Category { get; set; }

    [JsonPropertyName("collection"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Collection { get; set; }

    [JsonPropertyName("collectionImage"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? CollectionImage { get; set; }

    [JsonPropertyName("containerType"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? ContainerType { get; set; }

    [JsonPropertyName("contents"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public List<int>? Contents { get; set; }

    [JsonPropertyName("def"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? Def { get; set; }

    [JsonPropertyName("free"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public bool? Free { get; set; }

    [JsonPropertyName("id")]
    public int Id { get; set; }

    [JsonPropertyName("image"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Image { get; set; }

    [JsonPropertyName("index"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? Index { get; set; }

    [JsonPropertyName("keys"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public List<int>? Keys { get; set; }

    [JsonPropertyName("legacy"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public bool? Legacy { get; set; }

    [JsonPropertyName("legacyStickerMask"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? LegacyStickerMask { get; set; }

    [JsonPropertyName("legacyStickerSlots"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? LegacyStickerSlots { get; set; }

    [JsonPropertyName("model"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Model { get; set; }

    [JsonPropertyName("paintMaterial"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? PaintMaterial { get; set; }

    [JsonPropertyName("playerModel"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? PlayerModel { get; set; }

    [JsonPropertyName("rarity"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Rarity { get; set; }

    [JsonPropertyName("specials"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public List<int>? Specials { get; set; }

    [JsonPropertyName("specialsImage"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? SpecialsImage { get; set; }

    [JsonPropertyName("statTrakless"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public bool? StatTrakless { get; set; }

    [JsonPropertyName("statTrakOnly"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public bool? StatTrakOnly { get; set; }

    [JsonPropertyName("stickerId"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? StickerId { get; set; }

    [JsonPropertyName("stickerMask"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? StickerMask { get; set; }

    [JsonPropertyName("stickerSlots"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? StickerSlots { get; set; }

    [JsonPropertyName("teams"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? Teams { get; set; }

    [JsonPropertyName("tint"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? Tint { get; set; }

    [JsonPropertyName("type")]
    public string Type { get; set; } = CS2ItemType.Stub;

    [JsonPropertyName("wearMax"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public double? WearMax { get; set; }

    [JsonPropertyName("wearMin"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public double? WearMin { get; set; }

    [JsonIgnore] public string? ClassName { get; set; }
    [JsonIgnore] public string? DescToken { get; set; }
    [JsonIgnore] public string? NameToken { get; set; }
}

public class CS2ItemTranslation
{
    [JsonPropertyName("category"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Category { get; set; }

    [JsonPropertyName("collectionDesc"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? CollectionDesc { get; set; }

    [JsonPropertyName("collectionName"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? CollectionName { get; set; }

    [JsonPropertyName("desc"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Desc { get; set; }

    [JsonPropertyName("name"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Name { get; set; }

    [JsonPropertyName("tournamentDesc"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? TournamentDesc { get; set; }
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

public abstract record PendingImageTask(string Filename);
public record RegularImageTask(string LocalPath, string Filename) : PendingImageTask(Filename);
public record PaintImageTask(List<(string Src, string Suffix)> LocalPaths, string BaseName, string BaseFilename) : PendingImageTask(BaseFilename);
public record GraffitiImageTask(string LocalPath, string HexColor, string Filename) : PendingImageTask(Filename);
public record SvgImageTask(string LocalPath, string Filename) : PendingImageTask(Filename);

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
    public HashSet<string> ExistingImages { get; set; } = [];
    public HashSet<string> NeededVpkPaths { get; set; } = [];
    public Dictionary<string, PendingImageTask> ImagesToProcess { get; set; } = [];
    public Dictionary<string, PendingModelTask> ModelsToProcess { get; set; } = [];
    public HashSet<string> CompositeMaterialsToProcess { get; set; } = [];
    public HashSet<string> MaterialsToProcess { get; set; } = [];
    public HashSet<string> TexturesToProcess { get; set; } = [];
    public Dictionary<string, object?> CompositeMaterialDataByPath { get; set; } = [];
    public Dictionary<string, string> CompositeMaterialFilenameByPath { get; set; } = [];
    public Dictionary<string, List<string>> CompositeMaterialRefsByPath { get; set; } = [];
    public Dictionary<string, object?> MaterialDataByPath { get; set; } = [];
    public Dictionary<string, string> MaterialFilenameByPath { get; set; } = [];
    public Dictionary<string, List<string>> MaterialRefsByPath { get; set; } = [];
    public Dictionary<string, string> TextureFilenameByPath { get; set; } = [];
    public List<CS2Item> BaseItems { get; set; } = [];
    public Dictionary<string, int> ContainerItems { get; set; } = [];
    public Dictionary<int, CS2Item> Items { get; set; } = [];
    public List<PaintKitRecord> PaintKits { get; set; } = [];
    public List<GraffitiTintRecord> GraffitiTints { get; set; } = [];
    public int? KeychainBaseId { get; set; }
    public List<string> AllIdentifiers { get; set; } = [];
    public List<string> UniqueIdentifiers { get; set; } = [];
    public Dictionary<int, CS2Item> ExistingItemsById { get; set; } = [];

    // Parsed game items (KV1)
    public ValveKeyValue.KVObject? GameItems { get; set; }
}
