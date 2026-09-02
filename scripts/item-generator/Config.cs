/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

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
    // Every texture takes the same lossy VP8 encode. The old carve-outs -- fully-lossless VP8L
    // for data selectors (masks, AO, glove ID maps) and near-lossless for normal maps -- were
    // not an optimization at all on this corpus: measured over a 60-texture stratified sample,
    // near-lossless level 60 is byte-for-byte the lossless size, and dropping it to level 20
    // buys 2.8% on normals and 0.0% on data selectors. They were carrying 6,084 of the 11,038 MB
    // we ship (55%) essentially uncompressed. At q95 the same files land 73% (normals) and 65%
    // (data selectors) smaller, taking the corpus to ~6.7 GB.
    //
    // What that costs is real and worth knowing before lowering this further. VP8 is YUV 4:2:0,
    // so any texture whose channels are independent data rather than a color loses the most:
    // measured max per-channel error is 177 on normal maps, 223 on packed ORM (occlusion,
    // roughness, metalness in r/g/b) and 255 along the hard borders of paint-by-number masks,
    // versus 8-11 on plain grayscale AO. That is the error budget the previous carve-outs
    // existed to avoid -- see git history for the artifacts it produced in cs2-3d-viewer
    // (pixelated squares on Desert Eagle | Blaze, mis-bucketed wear on Driver Gloves | Brocade
    // Flowers, a faint mosaic on metallic normals).
    //
    // Also used for the SkiaSharp-encoded item images in Catalog/Assets.cs.
    public const int WebpQuality = 95;
    public const int CdnUploadConcurrency = 40;
    public static readonly int ExternalConcurrency = Math.Max(2, Environment.ProcessorCount);

    public static readonly string StaticImagesDir = Path.Combine(ScriptsDir, "images");

    public static readonly string DepotFileListPath = Path.Combine(ScriptsDir, "cs2.depot");
    public static readonly string AssetsManifestPath = Path.Combine(ScriptsDir, "cs2.manifest");
    public static readonly string DepotCsgoPath = Path.Combine(WorkdirDir, "game/csgo");
    public static readonly string CsgoPakDirPath = Path.Combine(DepotCsgoPath, "pak01_dir.vpk");

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
