/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

using System.Text.RegularExpressions;

namespace ItemGenerator;

public enum ItemGeneratorMode
{
    Limited,
    Full,
}

public enum Cs2SourceMode
{
    InstalledGame,
    WorkspaceDepot,
}

public static partial class Config
{
    public static readonly string CwdPath = Directory.GetCurrentDirectory();
    public static readonly string ScriptsDir = Path.Combine(CwdPath, "scripts");
    public static readonly string WorkdirDir = Path.Combine(ScriptsDir, "workdir");
    public static readonly string DecompiledDir = Path.Combine(WorkdirDir, "decompiled");

    public static readonly string GameImagesDir = Path.Combine(DecompiledDir, "panorama/images");
    public static readonly string GameItemsPath = Path.Combine(
        DecompiledDir,
        "scripts/items/items_game.txt"
    );
    public static readonly string GameResourceDir = Path.Combine(DecompiledDir, "resource");
    public static readonly string OutputDir = Path.Combine(WorkdirDir, "output");

    public static readonly string ItemGeneratorWorkdirDir = Path.Combine(
        WorkdirDir,
        "item-generator"
    );
    public static readonly string ItemGeneratorCacheDir = Path.Combine(
        ItemGeneratorWorkdirDir,
        "cache"
    );
    public static readonly string ItemGeneratorBuildDir = Path.Combine(
        ItemGeneratorWorkdirDir,
        "build"
    );

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
        "weapon_m249",
        "weapon_mag7",
        "weapon_negev",
        "weapon_nova",
        "weapon_sawedoff",
        "weapon_xm1014",
    ];
    public static readonly string[] PaintImageSuffixes = ["light", "medium", "heavy"];

    // The loadout slot every pet item sits in: the owned `pet` itself plus the egg and the feed it
    // is offered and kept alive with.
    public const string PetLoadoutSlot = "pet";

    // Pets have no authored inventory icon -- the client renders them live -- so a pet is given a
    // render in scripts/images, and one without it takes this image. It is one of 30
    // `pet_hen_1_hen_catalan_*` icons the game ships that nothing references, all of the same
    // brown hen.
    public const string PetPlaceholderImage =
        "econ/default_generated/pet_hen_1_hen_catalan_tan_light";

    // The clips kept on a pet model, by the animation graph it uses. Everything else the graph
    // references (locomotion, tricks, the main-menu and photo-booth sets) is left out. They are
    // named by full path because a leaf name is not unique: the chicken graph also references
    // viewmodel/chicken/chick_idle01, which is a different clip.
    public static readonly Dictionary<string, string[]> PetClipsByGraph = new()
    {
        ["animation/graphs/chicken/chicken.vnmgraph"] =
        [
            "animation/anims/chicken/world/chick_idle01",
            "animation/anims/chicken/world/chick_idle02",
            "animation/anims/chicken/world/chick_idle03",
        ],
        ["animation/graphs/chicken/egg_pristine_world.vnmgraph"] =
        [
            "animation/anims/egg/chick_egg_idle_phase02",
            "animation/anims/egg/chick_egg_idle_phase03",
            "animation/anims/egg/chick_egg_idle_phase04",
        ],
    };

    // The client scales a pet model by its life stage: 1.0 egg, 0.25 chick, 0.6 pullet, 1.0 hen.
    // The chick is the only catalog item it changes, because a breed is always exported as a hen
    // and the chick model is authored at hen size. Keyed by pet_definitions index.
    public static readonly Dictionary<string, double> PetScaleByDefinition = new() { ["2"] = 0.25 };
    public static readonly string[] UncategorizedStickers =
    [
        "community_mix01",
        "community02",
        "danger_zone",
        "standard",
        "stickers2",
        "tournament_assets",
    ];

    // Lossy quality for the image pipeline (item icons, graffiti, paint previews, GLB texture
    // stubs).
    public const int WebpQuality = 95;
    public const int CdnUploadConcurrency = 40;
    public static readonly int ExternalConcurrency = Math.Max(2, Environment.ProcessorCount);

    public static readonly string StaticImagesDir = Path.Combine(ScriptsDir, "images");

    public static readonly string DepotFileListPath = Path.Combine(ScriptsDir, "cs2.depot");
    public static readonly string AssetsManifestPath = Path.Combine(ScriptsDir, "cs2.manifest");
    public static readonly string DepotGameDir = Path.Combine(WorkdirDir, "game");
    public static readonly string DepotCsgoPath = Path.Combine(DepotGameDir, "csgo");
    public static readonly string CsgoPakDirPath = Path.Combine(DepotCsgoPath, "pak01_dir.vpk");

    public static readonly string[] GeneratedDirs =
    [
        DecompiledDir,
        OutputDir,
        ItemGeneratorWorkdirDir,
        ItemGeneratorCacheDir,
        ItemGeneratorBuildDir,
        DepotGameDir,
    ];

    public static string GetArchiveDepotPath(int archiveIndex) =>
        $"game/csgo/pak01_{archiveIndex:D3}.vpk";

    public const uint AppId = 730;
    public const uint AssetsDepotId = 2347770;

    public static ItemGeneratorMode DetectMode()
    {
        // Full is the default (regenerate every asset from the depot). Limited is an
        // opt-in fallback via the workflow input (INPUT_LIMITED) for when Full breaks:
        // it refreshes item defs/images and inherits heavy 3D assets from items.json.
        return Environment.GetEnvironmentVariable("INPUT_LIMITED") == "true"
            ? ItemGeneratorMode.Limited
            : ItemGeneratorMode.Full;
    }

    public static Cs2SourceMode DetectSourceMode()
    {
        // Source is independent of Mode: only a local installed game reads from disk.
        // Full-in-CI has no CS2_CSGO_PATH and sources everything from the depot download.
        return Environment.GetEnvironmentVariable("CS2_CSGO_PATH") != null
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

    public static bool IsUploadSkipped()
    {
        return Environment.GetEnvironmentVariable("INPUT_SKIP_UPLOAD") == "true";
    }

    public static bool IsAssetReuseEnabled()
    {
        return Environment.GetEnvironmentVariable("INPUT_REUSE_ASSETS") == "true";
    }

    public static bool IsTextureOptimizationSkipped()
    {
        // Opts every material texture out of the per-property encode tiers (see
        // Assets/*TextureOptimization.cs), producing an unoptimized build to compare a tuned one
        // against.
        return Environment.GetEnvironmentVariable("INPUT_SKIP_TEXTURE_OPTIMIZATION") == "true";
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
