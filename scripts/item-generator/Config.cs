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
    // NOTE this is the quality the min-pick COMPARISON candidate is encoded at, and it is
    // deliberately not the quality a lossy winner ships at -- see WebpLossyQualityCeiling. Pinning
    // the comparison here keeps the codec choice identical to what it was before the ceiling
    // existed, so no texture can trade a bit-exact VP8L encode for a cheaper lossy one.
    public const int WebpQuality = 95;
    // The highest quality a texture that ALREADY WON min-pick may ship at. `WebpQuality` decides
    // which codec a texture gets; this decides what the lossy winners cost, and the per-texture
    // search descends from here toward `WebpQualityFloor`.
    //
    // The two are separate because they answer different questions, and answering both with one
    // number is what made this expensive. Lowering `WebpQuality` to 85 outright would also shrink
    // the comparison candidate, and the lossy candidate winning more often is precisely the
    // outcome min-pick exists to prevent: measured on a 40-texture sample of the non-normal VP8L
    // winners (the masks and ID maps), 14 of 40 flip to lossy at a comparison quality of 85. Those
    // are the textures whose lossy encode brings back the 16px mosaic. Comparing at 95 and
    // shipping at 85 takes the size and leaves the codec decision untouched.
    //
    // 85 is the deliberate pick. It is the point where the search's own reference moves: the
    // budget is measured on THIS texture at the ceiling, so a lower ceiling both caps the top rung
    // and loosens the relative tolerance below it. Measured over a 24-texture sample drawn
    // probability-proportional-to-size from the lossy textures that carry an alpha plane, a
    // ceiling of 85 lands the corpus at 46.3% of its q95 bytes, with most textures settling at 80
    // or 85 rather than at the ceiling itself. Raise it if a lossy texture looks soft.
    public const int WebpLossyQualityCeiling = 85;
    // Bits per colour channel kept for normal maps, which are quantized onto a 2^n level ladder
    // and then encoded lossless instead of going through min-pick (see item-generator-webp.ts for
    // why no lossy setting can serve them, and AssetProcessor.CollectNormalMapTexturePaths for
    // how they are identified).
    //
    // This is the size/fidelity dial for ~5,400 textures, 1.86 GB of the corpus at the lossy
    // encode they must stop using. Cost against that baseline, by bit depth:
    //
    //   8 bits (bit-exact)     x5.97     7 bits (max err 1)   x3.88
    //   6 bits (max err 2)     x2.85     5 bits (max err 4)   x2.11
    //   4 bits (max err 8)     x2.14
    //
    // Ratios come from samples of ~20 normals and vary by several points between samples, so
    // read them as the shape of the curve rather than exact figures; 4 bits is the one measured
    // through the shipped encoder, and puts corpus normals near 3.98 GB.
    //
    // For reference the near-lossless path this replaces was x5.08 at max err 2, so 6 bits is
    // strictly better than what shipped before this branch. 4 bits is the deliberate choice to
    // spend fidelity on size: max err 8 is 3.6 degrees of normal tilt, and quantization bias
    // follows the surface gradient, so the failure mode if it is too aggressive is banding on a
    // smooth mirror-like surface. Raise this if that shows up. Note the encoder pins 127/128
    // onto the ladder whatever this is set to, so a flat surface never picks up a uniform tilt.
    public const int WebpNormalQuantizeBits = 4;
    // Bits per pixel kept in the ALPHA plane of every texture that goes through min-pick. RGB is
    // untouched; this is only the separate ALPH chunk, which WebP always compresses losslessly and
    // which `WebpQuality` therefore cannot reach. See item-generator-webp.ts for why quantizing is
    // preferred over libwebp's own alphaQuality.
    //
    // This is the size/fidelity dial for 11,263 textures, 3.52 GiB of the 6.95 GiB corpus, of
    // which 1.17 GiB is the alpha planes themselves. Cost against that baseline, measured on a
    // 60-texture sample stratified by size rank:
    //
    //   6 bits (max err 2)   84.1%     5 bits (max err 4)   75.4%     4 bits (max err 8)   69.6%
    //
    // The saving is far larger than that average on the files that actually hurt, because it
    // scales with how dithered the plane is: at 5 bits, ak47_autoexec_camo albedo 4.21 -> 1.59 MB,
    // p2000_deep_red 6.76 -> 3.75 MB, mp5_statics_blue 6.81 -> 3.01 MB.
    //
    // Alpha in this corpus is a mask read through smoothstep, not a colour, so the error moves a
    // wear threshold by far less than the wear slider itself does, and unlike the normals ladder
    // there is no unbounded decode downstream to amplify it. The one place alpha is a genuine
    // gradient is a sticker's transparency ramp.
    //
    // Note the saving is bounded by how DITHERED the plane is, not by how large it is. A plane
    // that is genuine per-pixel noise rather than a dithered plateau barely responds at any depth:
    // gun_grunge_psd's alpha costs 1.51 MiB at 5 bits, 1.28 at 4, and still 0.67 at ONE bit. No
    // setting of this makes such a texture cheap; only fewer pixels would.
    // 4 is the pick as of the ceiling change. 5 was chosen when the alpha ladder was the only
    // lever on these files; now that the RGB side moves too, the extra bit is a bigger share of
    // what is left. It costs max err 8 instead of 4 (3.1% of range) and buys ~7% of the bytes of
    // every texture that carries an alpha plane, measured over the same 24-texture sample. The
    // failure mode is unchanged -- banding on a sticker's transparency ramp -- so go back to 5 if
    // that shows up.
    public const int WebpAlphaQuantizeBits = 4;
    // Floor and budget for the per-texture quality search that re-rates a lossy min-pick winner.
    // `WebpQuality` sets what a texture may spend; these decide whether spending it buys anything
    // on THAT texture. See item-generator-webp.ts for the mechanism and for why the search runs
    // after min-pick rather than before it.
    //
    // This is the size/fidelity dial for the ~11,900 textures that ship a lossy encode, 3.48 GB of
    // the 6.10 GB corpus. Measured over a 42-texture sample stratified by size rank, against
    // their q95 bytes:
    //
    //   tolerance 5%    88.7%  (26 of 42 stay at full quality)
    //   tolerance 10%   75.9%  (15 of 42)
    //   tolerance 15%   70.5%  (13 of 42)
    //   tolerance 20%   68.8%  (12 of 42)
    //
    // Confirmed on an unbiased 112-texture random sample at 10%: 22.7% of the lossy bytes, with
    // 25 of 112 left at full quality, and no texture over budget (worst distortion ratio 1.100).
    //
    // 10% is the deliberate pick: it is where the curve turns over, and the textures it moves are
    // the ones whose q95 error is dominated by 4:2:0 chroma subsampling -- which quality does not
    // control, so the quality points were buying them a rounding difference on an error they
    // already carry. Past 10% the rule starts taking bits from clean colour textures, where they
    // buy real fidelity, for a few more points of size.
    //
    // The tolerance is RELATIVE, so a texture that q95 already encodes cleanly is held to a tight
    // budget and a distorted one to a loose one. `WebpDistortionCeiling` bounds the loose end in
    // absolute levels, so an already-damaged texture cannot be damaged without limit; at 10% it
    // binds only above an RMSE of 20, which in this corpus is the large paint-by-number masks.
    // Both are what to raise if a lossy texture looks soft, and `WebpQualityFloor` is what to
    // raise if one looks blocky.
    public const int WebpQualityFloor = 70;
    public const double WebpDistortionTolerance = 0.10;
    public const double WebpDistortionCeiling = 2.0;
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
