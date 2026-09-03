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
    // The lossy Q for the VP8 half of the encoder's two candidates. Every texture is encoded both
    // this way and fully-lossless VP8L, and the smaller output ships; see item-generator-webp.ts.
    //
    // Lowering this is not the free win it looks like. VP8 is YUV 4:2:0, so any texture whose
    // channels are independent data rather than a color loses the most: measured max per-channel
    // error at q95 is 177 on normal maps, 223 on packed ORM (occlusion, roughness, metalness in
    // r/g/b) and 255 along the hard borders of paint-by-number masks, versus 8-11 on plain
    // grayscale AO. Dropping Q widens that budget on exactly the textures a shader reads as data.
    //
    // Min-pick already covers the worst of it: the textures that break most visibly under lossy
    // are low-entropy, so VP8L both wins on bytes and is bit-exact for them. That is what fixed
    // the pixelated squares on Desert Eagle | Blaze -- its g_tMasks is 27.9 KB lossy vs 10.3 KB
    // lossless. It is NOT a general safety net: a high-entropy texture that a shader still reads
    // as data (the large paint-by-number masks) keeps the lossy encode because VP8L is bigger
    // for it, and keeps this error budget with it. Normal maps are the case where that went
    // visibly wrong, and they are routed around min-pick entirely; see WebpNormalQuantizeBits.
    //
    // Also used for the SkiaSharp-encoded item images in Catalog/Assets.cs, which are single-path
    // lossy and do not go through min-pick.
    public const int WebpQuality = 95;
    // Bits per colour channel kept for normal maps, which are quantized onto a 2^n level ladder
    // and then encoded lossless instead of going through min-pick (see item-generator-webp.ts for
    // why no lossy setting can serve them, and AssetProcessor.CollectNormalMapTexturePaths for
    // how they are identified).
    //
    // This is the size/fidelity dial for ~5,400 textures, 1.86 GB of the corpus at the lossy
    // encode they must stop using. Measured over 22 normals, against that baseline:
    //
    //   8 bits (bit-exact)     x5.97     7 bits (max err 1)   x3.88
    //   6 bits (max err 2)     x2.85     5 bits (max err 4)   x2.11
    //   4 bits (max err 8)     x1.62
    //
    // For reference the near-lossless path this replaces was x5.08 at max err 2, so 6 bits is
    // strictly better than what shipped before this branch. 4 bits is the deliberate choice to
    // spend fidelity on size: max err 8 is 3.6 degrees of normal tilt, and quantization bias
    // follows the surface gradient, so the failure mode if it is too aggressive is banding on a
    // smooth mirror-like surface. Raise this if that shows up.
    public const int WebpNormalQuantizeBits = 4;
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
