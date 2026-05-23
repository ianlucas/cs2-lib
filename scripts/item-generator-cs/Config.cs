using System.Text.RegularExpressions;

namespace ItemGenerator;

public enum ItemGeneratorMode { Limited, Full }
public enum Cs2SourceMode { InstalledGame, WorkspaceDepot }

public static partial class Config
{
    public static readonly string CwdPath = Directory.GetCurrentDirectory();
    public static readonly string ScriptsDir = Path.Combine(CwdPath, "scripts");
    public static readonly string WorkdirDir = Path.Combine(ScriptsDir, "workdir");
    public static readonly string DecompiledDir = Path.Combine(WorkdirDir, "decompiled");

    public static readonly string GameImagesDir = Path.Combine(DecompiledDir, "panorama/images");
    public static readonly string GameItemsPath = Path.Combine(DecompiledDir, "scripts/items/items_game.txt");
    public static readonly string GameResourceDir = Path.Combine(DecompiledDir, "resource");
    public static readonly string OutputDir = Path.Combine(WorkdirDir, "output");

    public static readonly string ItemGeneratorWorkdirDir = Path.Combine(WorkdirDir, "item-generator");
    public static readonly string ItemGeneratorCacheDir = Path.Combine(ItemGeneratorWorkdirDir, "cache");
    public static readonly string ItemGeneratorBuildDir = Path.Combine(ItemGeneratorWorkdirDir, "build");

    public const string ItemIdsJsonPath = "scripts/data/items-ids.json";
    public const string ItemsJsonPath = "scripts/data/items.json";
    public const string ItemsTsPath = "src/items.ts";
    public const string TranslationsTsPath = "src/translations/{0}.ts";
    public const string EnglishJsonPath = "scripts/data/english.json";

    public static readonly Regex FormattedStringRe = FormattedStringRegex();
    public static readonly Regex LanguageFileRe = LanguageFileRegex();
    public static readonly Regex LootItemRe = LootItemRegex();
    public static readonly Regex SkinPhaseRe = SkinPhaseRegex();
    public static readonly Regex WeaponCategoryRe = WeaponCategoryRegex();

    public static readonly string[] BaseWeaponEquipment = ["weapon_taser"];
    public static readonly string[] FreeMusicKits = ["1", "70"];
    public static readonly string[] HeavyWeapons =
    [
        "weapon_m249", "weapon_mag7", "weapon_negev",
        "weapon_nova", "weapon_sawedoff", "weapon_xm1014"
    ];
    public static readonly string[] PaintImageSuffixes = ["light", "medium", "heavy"];
    public static readonly string[] UncategorizedStickers =
    [
        "community_mix01", "community02", "danger_zone",
        "standard", "stickers2", "tournament_assets"
    ];
    public const string RemoveKeychainToolIndex = "65";
    public const int WebpQuality = 95;
    public const int CdnUploadConcurrency = 40;
    public static readonly int ExternalConcurrency = Math.Max(2, Environment.ProcessorCount);

    public static readonly string StaticImagesDir = Path.Combine(ScriptsDir, "images");

    public static readonly string DepotFileListPath = Path.Combine(ScriptsDir, "cs2.depot");
    public static readonly string AssetsManifestPath = Path.Combine(ScriptsDir, "cs2.manifest");
    public static readonly string DepotCsgoPath = Path.Combine(WorkdirDir, "game/csgo");
    public static readonly string CsgoPakDirPath = Path.Combine(DepotCsgoPath, "pak01_dir.vpk");
    public static readonly string TempPakFileListPath = Path.Combine(WorkdirDir, "cs2_temp_pak.depot");

    public const uint AppId = 730;
    public const uint AssetsDepotId = 2347770;

    public static ItemGeneratorMode DetectMode()
    {
        return Environment.GetEnvironmentVariable("CS2_CSGO_PATH") != null
            ? ItemGeneratorMode.Full
            : ItemGeneratorMode.Limited;
    }

    public static Cs2SourceMode DetectSourceMode()
    {
        return DetectMode() == ItemGeneratorMode.Full
            ? Cs2SourceMode.InstalledGame
            : Cs2SourceMode.WorkspaceDepot;
    }

    public static string? GetInstalledGamePath()
    {
        return DetectSourceMode() == Cs2SourceMode.InstalledGame
            ? Environment.GetEnvironmentVariable("CS2_CSGO_PATH")
            : null;
    }

    public static string GetPakDirPath()
    {
        var installedPath = GetInstalledGamePath();
        if (installedPath != null)
            return Path.Combine(installedPath, "pak01_dir.vpk");
        return CsgoPakDirPath;
    }

    public static bool IsForceMode()
    {
        return Environment.GetEnvironmentVariable("INPUT_FORCE") == "true";
    }

    [GeneratedRegex(@"%s(\d+)")]
    private static partial Regex FormattedStringRegex();

    [GeneratedRegex(@"csgo_([^\._]+)\.txt$")]
    private static partial Regex LanguageFileRegex();

    [GeneratedRegex(@"^\[([^\]]+)\](.*)$")]
    private static partial Regex LootItemRegex();

    [GeneratedRegex(@"_phase(\d)")]
    private static partial Regex SkinPhaseRegex();

    [GeneratedRegex(@"(c4|[^\d]+)")]
    private static partial Regex WeaponCategoryRegex();
}
