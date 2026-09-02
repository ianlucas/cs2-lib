/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

using System.Diagnostics;
using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using ItemGenerator.GameFiles;
using SharpGLTF.Schema2;
using SkiaSharp;
using static ItemGenerator.Logging;

namespace ItemGenerator;

public static partial class AssetProcessor
{
    [GeneratedRegex(@"resource(?:_name)?:|\.vtex|\.vmat(?!\.json)|\.vcompmat(?!\.json)")]
    private static partial Regex UnrewrittenRefRegex();

    // Assets are named `{base}_{contentHash8}` (see ContentVersion), so names are only known
    // after bytes exist. Generation is bottom-up: textures first, then materials (whose JSON
    // embeds texture filenames) in dependency order, then models (whose GLBs embed material
    // filename stems). Items reference provisional names until ApplyAssetRenames patches them.
    public static async Task ProcessAssets(ItemGeneratorContext ctx)
    {
        if (ctx.NeededVpkPaths.Count > 0)
        {
            var vpkPaths = ctx.NeededVpkPaths.ToList();
            Log($"Resolving {FormatCount(vpkPaths.Count, "VPK asset")}...");
            if (ctx.SourceMode == Cs2SourceMode.WorkspaceDepot)
                await EnsureAssetPackages(ctx, vpkPaths);
            ResourceDecompiler.DecompileAssets(ctx, vpkPaths);
        }

        await ProcessImages(ctx);

        if (ctx.Mode == ItemGeneratorMode.Full)
        {
            PreProcessCompositeMaterials(ctx);
            PrepareModels(ctx);
            PreProcessMaterials(ctx);
            ProcessMaterialTextures(ctx);
            WriteMaterialMetadata(ctx);
            await FinalizeModels(ctx);
        }

        ApplyAssetRenames(ctx);
    }

    private static async Task ProcessImages(ItemGeneratorContext ctx)
    {
        if (ctx.ImagesToProcess.Count == 0) return;
        Log($"Processing {FormatCount(ctx.ImagesToProcess.Count, "image task")}...");

        var stagingDir = Path.Combine(Config.ItemGeneratorBuildDir, "images");
        Directory.CreateDirectory(stagingDir);

        var semaphore = new SemaphoreSlim(Math.Max(2, Math.Min(8, ctx.ImagesToProcess.Count)));
        var tasks = new List<Task>();
        var renameLock = new object();
        var total = ctx.ImagesToProcess.Count;
        var processed = 0;
        var lastMilestone = 0;

        foreach (var task in ctx.ImagesToProcess.Values)
        {
            if (TryReuseImageTask(task, out var cached))
            {
                ctx.AssetRenames[task.Provisional] = cached;
                continue;
            }
            tasks.Add(Task.Run(async () =>
            {
                await semaphore.WaitAsync();
                try
                {
                    var final = ProcessImageTask(task, stagingDir);
                    if (final != null)
                        lock (renameLock) ctx.AssetRenames[task.Provisional] = final;
                }
                finally { semaphore.Release(); }
                LogProgress(ref processed, ref lastMilestone, total);
            }));
        }

        await Task.WhenAll(tasks);
        Log($"Processed {FormatCount(ctx.ImagesToProcess.Count, "image task")}.");
    }

    private static bool TryReuseImageTask(PendingImageTask task, out string final)
    {
        final = "";
        if (!Config.IsAssetReuseEnabled()) return false;

        var imagesDir = Path.Combine(Config.OutputDir, "images");
        if (!Directory.Exists(imagesDir)) return false;
        var baseName = Path.GetFileName(task.FinalBase);
        var suffix = task.FinalSuffix != null ? $"_{task.FinalSuffix}" : "";
        var matches = Directory.GetFiles(imagesDir, $"{baseName}_????????{suffix}.webp");
        if (matches.Length != 1) return false;

        if (task is PaintImageTask)
        {
            var stem = Path.GetFileNameWithoutExtension(matches[0]);
            if (!Config.PaintImageSuffixes.All(s =>
                File.Exists(Path.Combine(imagesDir, $"{stem}_{s}.webp"))))
                return false;
        }

        final = $"/images/{Path.GetFileName(matches[0])}";
        return true;
    }

    // Encodes one image task into the staging dir, hashes the output, and moves it to its final
    // content-addressed name. Returns the final name, or null when the source is unavailable.
    private static string? ProcessImageTask(PendingImageTask task, string stagingDir)
    {
        var stagedBase = Path.Combine(stagingDir, Path.GetFileNameWithoutExtension(task.Provisional));
        switch (task)
        {
            case RegularImageTask regular:
            {
                var staged = $"{stagedBase}.webp";
                return ConvertToWebp(regular.LocalPath, staged) ? PromoteImage(staged, task) : null;
            }
            case GraffitiImageTask graffiti:
            {
                var staged = $"{stagedBase}.webp";
                return ColorizeGraffitiImage(graffiti.LocalPath, graffiti.HexColor, staged)
                    ? PromoteImage(staged, task) : null;
            }
            case SvgImageTask svg:
            {
                var staged = $"{stagedBase}.webp";
                return ConvertSvgToWebp(svg.LocalPath, staged) ? PromoteImage(staged, task) : null;
            }
            case PaintImageTask paint:
            {
                var produced = new List<(string Suffix, string Staged, string Hash)>();
                foreach (var (src, suffix) in paint.LocalPaths)
                {
                    var staged = $"{stagedBase}_{suffix}.webp";
                    if (ConvertToWebp(src, staged))
                        produced.Add((suffix, staged, ContentVersion.HashFileFull(staged)));
                }
                if (produced.Count == 0) return null;

                // Consumers derive the _light/_medium/_heavy URLs from the base URL (see
                // economy.ts getImageUrl), so the whole wear set must share one version token.
                var token = ContentVersion.Combine(produced.Select(p => p.Hash));
                var baseFilename = $"{paint.FinalBase}_{token}.webp";
                // The base image has always been a re-encode of the first variant's source;
                // copying the staged variant is byte-identical and cheaper.
                CopyToOutput(produced[0].Staged, baseFilename, move: false);
                foreach (var (suffix, staged, _) in produced)
                    CopyToOutput(staged, $"{paint.FinalBase}_{token}_{suffix}.webp", move: true);
                return baseFilename;
            }
            default:
                return null;
        }
    }

    private static string PromoteImage(string staged, PendingImageTask task)
    {
        var suffix = task.FinalSuffix != null ? $"_{task.FinalSuffix}" : "";
        var final = $"{task.FinalBase}_{ContentVersion.HashFile(staged)}{suffix}.webp";
        CopyToOutput(staged, final, move: true);
        return final;
    }

    private static void CopyToOutput(string srcPath, string destFilename, bool move)
    {
        var outPath = Path.Combine(Config.OutputDir, destFilename.TrimStart('/'));
        Directory.CreateDirectory(Path.GetDirectoryName(outPath)!);
        if (move) File.Move(srcPath, outPath, true);
        else File.Copy(srcPath, outPath, true);
    }

    // Rewrites provisional asset references on items to their final content-addressed names.
    // ModelPath is patched separately by FinalizeModels (the .glb/.json pair move together).
    private static void ApplyAssetRenames(ItemGeneratorContext ctx)
    {
        if (ctx.AssetRenames.Count == 0) return;
        string? Map(string? value) =>
            value != null && ctx.AssetRenames.TryGetValue(value, out var final) ? final : value;

        foreach (var item in ctx.Items.Values)
        {
            item.ImagePath = Map(item.ImagePath);
            item.CollectionImagePath = Map(item.CollectionImagePath);
            item.SpecialsImagePath = Map(item.SpecialsImagePath);
            item.MaterialPath = Map(item.MaterialPath);
        }
    }

    private static void PrepareModels(ItemGeneratorContext ctx)
    {
        HydrateReusedModelData(ctx);
        if (ctx.ModelsToProcess.Count == 0) return;
        Log($"Preparing {FormatCount(ctx.ModelsToProcess.Count, "model")}...");
        ResourceDecompiler.DecompileModelAssets(ctx, ctx.ModelsToProcess.Keys);
        ExtractModelData(ctx);
    }

    // Runs after WriteMaterialMetadata: PatchGlbAssets renames GLB material slots to the final
    // content-hashed material filename stems, so models must be hashed after materials settle.
    private static async Task FinalizeModels(ItemGeneratorContext ctx)
    {
        if (ctx.ModelsToProcess.Count == 0) return;
        Log($"Finalizing {FormatCount(ctx.ModelsToProcess.Count, "model")}...");

        // Pass 1: patch + stub each model, collecting the GLBs to compress.
        var stubbed = new List<(string VpkPath, PendingModelTask Model, string GlbPath)>();
        foreach (var (vpkPath, model) in ctx.ModelsToProcess)
        {
            var modelDir = Path.Combine(Config.DecompiledDir, Path.GetDirectoryName(vpkPath)!);
            var baseName = Path.GetFileNameWithoutExtension(vpkPath).Replace(".vmdl", "");
            var glbPath = Path.Combine(modelDir, $"{baseName}.glb");

            if (!File.Exists(glbPath)) continue;

            EnsureGlbSatelliteTextures(glbPath);
            PatchGlbAssets(ctx, glbPath);
            StubModelTextures(glbPath);
            stubbed.Add((vpkPath, model, glbPath));
        }

        // Compress geometry with EXT_meshopt_compression before hashing, so the version hash
        // reflects the compressed bytes.
        await OptimizeGlbsMeshopt(stubbed.Select(s => s.GlbPath).ToList());

        // Pass 2: hash, version, and move each compressed GLB into the output tree. The .glb, the
        // .json and the .collider.json share one token over every file's bytes so the set stays in
        // sync. A model with no cloth collider contributes an empty hash, which Combine drops, so
        // adding the third member left every existing model URL where it was.
        foreach (var (vpkPath, model, glbPath) in stubbed)
        {
            var modelDataPath = Path.Combine(Config.OutputDir, model.ModelData.TrimStart('/'));
            var colliderPath = ClothColliderPathOf(modelDataPath);
            var dependencyHash = ContentVersion.Combine([
                ContentVersion.HashFileFull(glbPath),
                File.Exists(modelDataPath) ? ContentVersion.HashFileFull(modelDataPath) : "",
                File.Exists(colliderPath) ? ContentVersion.HashFileFull(colliderPath) : ""
            ]);

            var versionedBase = $"{model.Base}_{dependencyHash}";
            var versionedPlayerModel = $"/models/{versionedBase}.glb";
            var versionedModelData = $"/models/{versionedBase}.json";

            var destGlb = Path.Combine(Config.OutputDir, versionedPlayerModel.TrimStart('/'));
            var destData = Path.Combine(Config.OutputDir, versionedModelData.TrimStart('/'));
            Directory.CreateDirectory(Path.GetDirectoryName(destGlb)!);
            File.Move(glbPath, destGlb, true);
            if (File.Exists(modelDataPath))
                File.Move(modelDataPath, destData, true);
            if (File.Exists(colliderPath))
                File.Move(colliderPath, ClothColliderPathOf(destData), true);

            UpdateModelAssetReferences(ctx, model, versionedPlayerModel, versionedModelData);
        }

        Log($"Processed {FormatCount(ctx.ModelsToProcess.Count, "model")}.");
    }

    // A model's cloth collider sits beside its model data under the same stem, so a consumer
    // derives the URL the same way it derives the model data's (economy.ts getColliderDataUrl).
    private static string ClothColliderPathOf(string modelDataPath) =>
        Path.ChangeExtension(modelDataPath, null) + ".collider.json";

    private static void ExtractModelData(ItemGeneratorContext ctx)
    {
        var entries = ctx.ModelsToProcess.Select(kv =>
            (VpkPath: kv.Key, TargetFilename: kv.Value.PlayerModel)).ToList();
        var results = MetadataExtractor.ExtractModelMetadata(ctx, entries);

        for (int i = 0; i < results.Count; i++)
        {
            var result = results[i];
            var vpkPath = entries[i].VpkPath;
            if (!ctx.ModelsToProcess.TryGetValue(vpkPath, out var model)) continue;

            foreach (var material in result.Materials)
            {
                var normalized = MaterialPaths.NormalizeMaterialResourcePath(material);
                ctx.MaterialsToProcess.Add(normalized);
                model.DirectMaterials.Add(normalized);
            }

            if (result.Data != null)
            {
                var json = JsonSerializer.Serialize(result.Data);
                var outPath = Path.Combine(Config.OutputDir, "models", result.Filename);
                Directory.CreateDirectory(Path.GetDirectoryName(outPath)!);
                File.WriteAllText(outPath, json);

                var playerModelPath = $"/models/{Path.ChangeExtension(result.Filename, ".glb")}";
                if (result.Data is Dictionary<string, object?> dataDict)
                    ApplyModelMetadata(ctx, playerModelPath, dataDict);
            }

            if (result.ClothCollider != null)
            {
                var modelDataPath = Path.Combine(Config.OutputDir, "models", result.Filename);
                var colliderPath = ClothColliderPathOf(modelDataPath);
                Directory.CreateDirectory(Path.GetDirectoryName(colliderPath)!);
                File.WriteAllText(colliderPath, JsonSerializer.Serialize(result.ClothCollider));

                // Flagged on the item so a consumer knows the sibling file is there to fetch.
                // Most models have no collider — knives carry no FeModel at all — and a keychain
                // hangs uncollided on those rather than the fetch 404ing.
                var playerModelPath = $"/models/{Path.ChangeExtension(result.Filename, ".glb")}";
                ApplyColliderMetadata(ctx, playerModelPath);
            }
        }
    }

    private static void HydrateReusedModelData(ItemGeneratorContext ctx)
    {
        foreach (var playerModelPath in ctx.ReusedModelPaths)
        {
            var dataPath = Path.Combine(Config.OutputDir,
                Path.ChangeExtension(playerModelPath.TrimStart('/'), ".json"));
            if (!File.Exists(dataPath))
                throw new FileNotFoundException($"Cached model data not found: {dataPath}");

            using var document = JsonDocument.Parse(File.ReadAllText(dataPath));
            if (ConvertJsonElement(document.RootElement) is Dictionary<string, object?> data)
                ApplyModelMetadata(ctx, playerModelPath, data);

            var colliderPath = ClothColliderPathOf(dataPath);
            if (File.Exists(colliderPath)) ApplyColliderMetadata(ctx, playerModelPath);
        }
    }

    private static object? ConvertJsonElement(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Object => element.EnumerateObject().ToDictionary(
            property => property.Name, property => ConvertJsonElement(property.Value)),
        JsonValueKind.Array => element.EnumerateArray().Select(ConvertJsonElement).ToList(),
        JsonValueKind.String => element.GetString(),
        JsonValueKind.Number when element.TryGetInt64(out var integer) => integer,
        JsonValueKind.Number => element.GetDouble(),
        JsonValueKind.True => true,
        JsonValueKind.False => false,
        _ => null
    };

    private static void ApplyModelMetadata(
        ItemGeneratorContext ctx, string playerModelPath, Dictionary<string, object?> dataDict)
    {
        if (dataDict.TryGetValue("m_modelInfo", out var modelInfoObj) &&
            modelInfoObj is Dictionary<string, object?> modelInfo &&
            modelInfo.TryGetValue("m_keyValueText", out var kvTextObj) &&
            kvTextObj is Dictionary<string, object?> kvText)
        {
            if (kvText.TryGetValue("StickerMarkup", out var stickerMarkupObj) &&
                stickerMarkupObj is List<object?> stickerMarkup)
            {
                var stickerSchemaCount = stickerMarkup.Count(s =>
                    s is Dictionary<string, object?> d &&
                    d.TryGetValue("Mesh", out var mesh) &&
                    mesh?.ToString() == "body_hd");
                var legacyStickerSchemaCount = stickerMarkup.Count - stickerSchemaCount;
                var hdOffsetBounds = ComputeStickerOffsetBounds(stickerMarkup, hd: true);
                var legacyOffsetBounds = ComputeStickerOffsetBounds(stickerMarkup, hd: false);

                foreach (var item in ctx.Items.Values)
                {
                    if (item.ModelPath != playerModelPath) continue;
                    item.StickerSchemaCount = stickerSchemaCount > 0 ? stickerSchemaCount : null;
                    item.LegacyStickerSchemaCount = legacyStickerSchemaCount > 0 ? legacyStickerSchemaCount : null;
                    if (hdOffsetBounds is { } hd)
                    {
                        item.StickerOffsetXMin = hd.XMin;
                        item.StickerOffsetXMax = hd.XMax;
                        item.StickerOffsetYMin = hd.YMin;
                        item.StickerOffsetYMax = hd.YMax;
                    }
                    if (legacyOffsetBounds is { } legacy)
                    {
                        item.LegacyStickerOffsetXMin = legacy.XMin;
                        item.LegacyStickerOffsetXMax = legacy.XMax;
                        item.LegacyStickerOffsetYMin = legacy.YMin;
                        item.LegacyStickerOffsetYMax = legacy.YMax;
                    }
                }
            }

            if (kvText.TryGetValue("KeychainMarkup", out var keychainMarkupObj) &&
                keychainMarkupObj is List<object?> keychainMarkup)
            {
                var hdKeychainBounds = ComputeKeychainPositionBounds(keychainMarkup, legacyModel: false);
                var legacyKeychainBounds = ComputeKeychainPositionBounds(keychainMarkup, legacyModel: true);

                if (hdKeychainBounds == null && legacyKeychainBounds == null) return;
                foreach (var item in ctx.Items.Values)
                {
                    if (item.ModelPath != playerModelPath) continue;
                    if (hdKeychainBounds is { } hd)
                    {
                        item.KeychainPositionXMin = hd.XMin;
                        item.KeychainPositionXMax = hd.XMax;
                        item.KeychainPositionYMin = hd.YMin;
                        item.KeychainPositionYMax = hd.YMax;
                        item.KeychainPositionZMin = hd.ZMin;
                        item.KeychainPositionZMax = hd.ZMax;
                    }
                    if (legacyKeychainBounds is { } legacy)
                    {
                        item.LegacyKeychainPositionXMin = legacy.XMin;
                        item.LegacyKeychainPositionXMax = legacy.XMax;
                        item.LegacyKeychainPositionYMin = legacy.YMin;
                        item.LegacyKeychainPositionYMax = legacy.YMax;
                        item.LegacyKeychainPositionZMin = legacy.ZMin;
                        item.LegacyKeychainPositionZMax = legacy.ZMax;
                    }
                }
            }
        }
    }

    private static void ApplyColliderMetadata(ItemGeneratorContext ctx, string playerModelPath)
    {
        foreach (var item in ctx.Items.Values)
        {
            if (item.ModelPath == playerModelPath) item.HasColliderData = true;
        }
    }

    // Mirrors CS2_STICKER_OFFSET_FACTOR in src/economy-constants.ts: the quantization step for the
    // emitted sticker-offset bounds. 4 decimals matches the StickerMarkup offset authoring precision.
    private const double StickerOffsetFactor = 0.0001;

    // Mirrors CS2_KEYCHAIN_POSITION_FACTOR in src/economy-constants.ts: the quantization step for the
    // emitted keychain-position bounds.
    private const double KeychainPositionFactor = 0.0001;

    // Per-LOD bounds for how far a sticker's x/y can be nudged from its slot default and still land
    // on the body's stickerable surface. The stored x/y are deltas from each slot's StickerMarkup
    // `Offset`, and the engine bakes the placeable surface as `Polygons.Vertices` in the same
    // engine sticker-UV space (shared across a mesh's slots). The widest valid delta for any slot is
    // therefore the placeable bounding box shifted by the slot-offset extremes: an app rules out
    // anything outside [Min, Max]; inside, it may still miss the (non-rectangular) surface and simply
    // not render. Mins are floored and maxes ceiled outward so rounding never rejects a valid nudge.
    private static (double XMin, double XMax, double YMin, double YMax)? ComputeStickerOffsetBounds(
        List<object?> stickerMarkup, bool hd)
    {
        double polyXMin = double.PositiveInfinity, polyXMax = double.NegativeInfinity;
        double polyYMin = double.PositiveInfinity, polyYMax = double.NegativeInfinity;
        double offXMin = double.PositiveInfinity, offXMax = double.NegativeInfinity;
        double offYMin = double.PositiveInfinity, offYMax = double.NegativeInfinity;
        var hasPolygon = false;
        var hasOffset = false;

        foreach (var entry in stickerMarkup)
        {
            if (entry is not Dictionary<string, object?> markup) continue;
            var isHd = markup.TryGetValue("Mesh", out var mesh) && mesh?.ToString() == "body_hd";
            if (isHd != hd) continue;

            if (markup.TryGetValue("Offset", out var offsetObj) && offsetObj is List<object?> offset &&
                offset.Count >= 2 && TryParseDouble(offset[0], out var ox) && TryParseDouble(offset[1], out var oy))
            {
                offXMin = Math.Min(offXMin, ox);
                offXMax = Math.Max(offXMax, ox);
                offYMin = Math.Min(offYMin, oy);
                offYMax = Math.Max(offYMax, oy);
                hasOffset = true;
            }

            if (markup.TryGetValue("Polygons", out var polygonsObj) && polygonsObj is List<object?> polygons)
            {
                foreach (var polygonObj in polygons)
                {
                    if (polygonObj is not Dictionary<string, object?> polygon) continue;
                    if (!polygon.TryGetValue("Vertices", out var verticesObj) ||
                        verticesObj is not List<object?> vertices) continue;
                    for (var i = 0; i + 1 < vertices.Count; i += 2)
                    {
                        if (!TryParseDouble(vertices[i], out var vx) ||
                            !TryParseDouble(vertices[i + 1], out var vy)) continue;
                        polyXMin = Math.Min(polyXMin, vx);
                        polyXMax = Math.Max(polyXMax, vx);
                        polyYMin = Math.Min(polyYMin, vy);
                        polyYMax = Math.Max(polyYMax, vy);
                        hasPolygon = true;
                    }
                }
            }
        }

        if (!hasPolygon || !hasOffset) return null;
        return (
            QuantizeOutward(polyXMin - offXMax, up: false),
            QuantizeOutward(polyXMax - offXMin, up: true),
            QuantizeOutward(polyYMin - offYMax, up: false),
            QuantizeOutward(polyYMax - offYMin, up: true)
        );
    }

    // Per-LOD bounds for where a keychain can sit on the body. KeychainMarkup quads (Corners:
    // 4 corners x XYZ, bone space) are the placeable surfaces, and the stored keychain x/y/z are
    // absolute coordinates in that same space, so the bounds are the corners' axis-aligned
    // bounding box across every quad of the LOD (LegacyModel selects the legacy or HD set). An
    // app rules out anything outside [Min, Max]; inside, it may still miss a (non-rectangular)
    // surface and simply not render. Mins are floored and maxes ceiled outward so rounding never
    // rejects a valid placement.
    private static (double XMin, double XMax, double YMin, double YMax, double ZMin, double ZMax)?
        ComputeKeychainPositionBounds(List<object?> keychainMarkup, bool legacyModel)
    {
        double xMin = double.PositiveInfinity, xMax = double.NegativeInfinity;
        double yMin = double.PositiveInfinity, yMax = double.NegativeInfinity;
        double zMin = double.PositiveInfinity, zMax = double.NegativeInfinity;
        var hasCorner = false;

        foreach (var entry in keychainMarkup)
        {
            if (entry is not Dictionary<string, object?> markup) continue;
            var isLegacy = markup.TryGetValue("LegacyModel", out var legacyObj) &&
                legacyObj?.ToString() is { } legacyText &&
                (legacyText.Equals("true", StringComparison.OrdinalIgnoreCase) || legacyText == "1");
            if (isLegacy != legacyModel) continue;

            if (!markup.TryGetValue("Corners", out var cornersObj) ||
                cornersObj is not List<object?> corners) continue;
            for (var i = 0; i + 2 < corners.Count; i += 3)
            {
                if (!TryParseDouble(corners[i], out var x) ||
                    !TryParseDouble(corners[i + 1], out var y) ||
                    !TryParseDouble(corners[i + 2], out var z)) continue;
                xMin = Math.Min(xMin, x);
                xMax = Math.Max(xMax, x);
                yMin = Math.Min(yMin, y);
                yMax = Math.Max(yMax, y);
                zMin = Math.Min(zMin, z);
                zMax = Math.Max(zMax, z);
                hasCorner = true;
            }
        }

        if (!hasCorner) return null;
        return (
            QuantizeOutward(xMin, up: false, KeychainPositionFactor),
            QuantizeOutward(xMax, up: true, KeychainPositionFactor),
            QuantizeOutward(yMin, up: false, KeychainPositionFactor),
            QuantizeOutward(yMax, up: true, KeychainPositionFactor),
            QuantizeOutward(zMin, up: false, KeychainPositionFactor),
            QuantizeOutward(zMax, up: true, KeychainPositionFactor)
        );
    }

    private static bool TryParseDouble(object? value, out double result)
    {
        result = 0;
        return value is string s &&
            double.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out result);
    }

    private static double QuantizeOutward(double value, bool up, double factor = StickerOffsetFactor)
    {
        var steps = up ? Math.Ceiling(value / factor) : Math.Floor(value / factor);
        return Math.Round(steps * factor, 4);
    }

    private static void PreProcessCompositeMaterials(ItemGeneratorContext ctx)
    {
        var pending = ctx.CompositeMaterialsToProcess
            .Where(p => !ctx.CompositeMaterialDataByPath.ContainsKey(p)).ToList();
        if (pending.Count == 0) return;

        Log($"Extracting {FormatCount(pending.Count, "composite material")}...");
        var processed = new HashSet<string>(ctx.CompositeMaterialDataByPath.Keys);
        var queue = new HashSet<string>(pending);
        // BFS discovers more refs as it goes, so report progress against the initial pending
        // count (the bulk) and cap at it; the discovered tail finishes under the closing summary.
        var reportProgress = pending.Count >= 100;
        var reported = 0;
        var lastMilestone = 0;

        while (queue.Count > 0)
        {
            var batch = queue.ToList();
            queue.Clear();

            var results = MetadataExtractor.ExtractCompositeMaterialMetadata(ctx, batch);
            foreach (var result in results)
            {
                processed.Add(result.VcompmatPath);
                ctx.CompositeMaterialDataByPath[result.VcompmatPath] = result.Data;

                foreach (var vmat in result.VmatRefs)
                {
                    try
                    {
                        var resolved = MaterialPaths.ResolveMaterialResourcePath(ctx, vmat);
                        ctx.MaterialsToProcess.Add(resolved);
                    }
                    catch { }
                }
                foreach (var vtex in result.VtexRefs)
                    AddTextureToProcess(ctx, vtex);
                foreach (var child in result.CompositeMaterialRefs)
                {
                    try
                    {
                        var normalized = MaterialPaths.ResolveMaterialResourcePath(ctx, child);
                        ctx.CompositeMaterialsToProcess.Add(normalized);
                        if (!processed.Contains(normalized) && !queue.Contains(normalized))
                            queue.Add(normalized);
                    }
                    catch { }
                }

                if (reportProgress && reported < pending.Count)
                    LogProgress(ref reported, ref lastMilestone, pending.Count);
            }
        }

        Log($"Extracted {FormatCount(processed.Count, "composite material")} and found {FormatCount(ctx.MaterialsToProcess.Count, "material reference")}.");
    }

    private static void PreProcessMaterials(ItemGeneratorContext ctx)
    {
        var pending = ctx.MaterialsToProcess
            .Where(p => !ctx.MaterialDataByPath.ContainsKey(p)).ToList();
        if (pending.Count == 0) return;

        Log($"Extracting {FormatCount(pending.Count, "material")}...");
        var processed = new HashSet<string>(ctx.MaterialDataByPath.Keys);
        var queue = new HashSet<string>(pending);
        // BFS discovers more refs as it goes, so report progress against the initial pending
        // count (the bulk) and cap at it; the discovered tail finishes under the closing summary.
        var reportProgress = pending.Count >= 100;
        var reported = 0;
        var lastMilestone = 0;

        while (queue.Count > 0)
        {
            var batch = queue.ToList();
            queue.Clear();

            var results = MetadataExtractor.ExtractMaterialMetadata(ctx, batch);
            foreach (var result in results)
            {
                processed.Add(result.VmatPath);
                ctx.MaterialDataByPath[result.VmatPath] = result.Data;

                foreach (var vtex in result.VtexRefs)
                    AddTextureToProcess(ctx, vtex);
                foreach (var vmat in result.VmatRefs)
                {
                    try
                    {
                        var normalized = MaterialPaths.ResolveMaterialResourcePath(ctx, vmat);
                        ctx.MaterialsToProcess.Add(normalized);
                        if (!processed.Contains(normalized) && !queue.Contains(normalized))
                            queue.Add(normalized);
                    }
                    catch { }
                }

                if (reportProgress && reported < pending.Count)
                    LogProgress(ref reported, ref lastMilestone, pending.Count);
            }
        }

        Log($"Extracted {FormatCount(processed.Count, "material")} and found {FormatCount(ctx.TexturesToProcess.Count, "texture reference")}.");
    }

    // Texture paths bound to a *Normal* material param (g_tNormal, g_tGlitterNormal, ...) in any
    // parsed vmat, plus a filename fallback ("_normal" in the stem) for normals that reach
    // TexturesToProcess only through composite-material mutators or model materials. Membership
    // selects the near-lossless WebP path (see Config.WebpNearLosslessNormals).
    private static HashSet<string> CollectNormalMapTexturePaths(ItemGeneratorContext ctx)
    {
        var result = new HashSet<string>();
        foreach (var data in ctx.MaterialDataByPath.Values)
        {
            if (data is not Dictionary<string, object?> vmat ||
                !vmat.TryGetValue("m_textureParams", out var paramsObj) ||
                paramsObj is not List<object?> textureParams)
                continue;
            foreach (var entry in textureParams)
            {
                if (entry is not Dictionary<string, object?> param ||
                    param.GetValueOrDefault("m_name") is not string name ||
                    !name.Contains("Normal", StringComparison.OrdinalIgnoreCase) ||
                    param.GetValueOrDefault("m_pValue") is not string value)
                    continue;
                try
                {
                    var resolved = MaterialPaths.ResolveMaterialResourcePath(ctx, value);
                    result.Add(MaterialPaths.NormalizeMaterialResourcePath(resolved));
                }
                catch { }
            }
        }
        foreach (var vtexPath in ctx.TexturesToProcess)
        {
            if (Path.GetFileNameWithoutExtension(vtexPath)
                .Contains("_normal", StringComparison.OrdinalIgnoreCase))
                result.Add(vtexPath);
        }
        return result;
    }

    // Params a compositor reads as DATA, not color: paint zone/coverage masks (g_tMasks,
    // g_tPaintByNumberMasks), cavity/AO (g_tAmbientOcclusion, g_tFinalAmbientOcclusion) and the
    // glove compositor's ID maps (g_tLayerId, g_tTintId). Deliberately excludes sticker sfx
    // masks (g_tSfxMaskSticker*) and pearlescence masks — different pipelines, unmeasured
    // benefit.
    //
    // "Id" is matched case-sensitively. g_tLayerId and g_tTintId are the only texture params
    // game-wide ending in it; the all-caps F_TINT_ID is a feature flag that also reaches this
    // predicate through WalkLooseVariables, and only its missing texture path keeps it out.
    private static bool IsDataSelectorParamName(string name) =>
        name.EndsWith("Masks", StringComparison.OrdinalIgnoreCase) ||
        name.EndsWith("Id", StringComparison.Ordinal) ||
        name.Contains("AmbientOcclusion", StringComparison.OrdinalIgnoreCase);

    private static bool HasDataSelectorFilename(string vtexPath)
    {
        var stem = Path.GetFileNameWithoutExtension(vtexPath);
        return stem.Contains("_masks", StringComparison.OrdinalIgnoreCase) ||
            stem.Contains("paintmask", StringComparison.OrdinalIgnoreCase) ||
            stem.Contains("tintid", StringComparison.OrdinalIgnoreCase) ||
            stem.Contains("materialid", StringComparison.OrdinalIgnoreCase) ||
            stem.Contains("_ao_", StringComparison.OrdinalIgnoreCase) ||
            stem.EndsWith("_ao", StringComparison.OrdinalIgnoreCase) ||
            stem.Contains("paintao", StringComparison.OrdinalIgnoreCase) ||
            stem.Contains("ambient_occlusion", StringComparison.OrdinalIgnoreCase) ||
            stem.Contains("cavity", StringComparison.OrdinalIgnoreCase);
    }

    // Texture paths the customweapon and customglove compositors sample as data selectors —
    // masks, AO and ID maps — collected from vmat texture params, composite-material loose
    // variables (per-skin masks/AO bind through m_strName + m_strTextureRuntimeResourcePath,
    // not m_textureParams), plus a filename fallback for the ones that reach TexturesToProcess
    // through model materials only.
    // Membership selects fully-lossless WebP (see Config.WebpLosslessQuality): lossy VP8 (even
    // q95) dips flat macroblocks by 1-8/255 on a sparse 16px lattice and rings far deeper (to
    // ±238) along mask-zone borders. The shaders amplify that: (1 - g_tMasks.x) directly blends
    // bare-metal g_tColor into the paint, so each dipped block renders as a pixelated square on
    // dark skins (Desert Eagle | Blaze body), and AO error shifts wear chip edges inside the
    // 0.58..0.68 reveal band (AK-47 Asiimov). Near-binary masks also compress far BETTER
    // lossless (pist_deagle_masks: 16 KB lossy VP8 → 1.6 KB VP8L).
    //
    // The glove ID maps fail the same way but harder, because a classifier reads them instead
    // of a blend: g_tTintId decodes as ceil(r * 7) into eight buckets and g_tLayerId normalizes
    // into per-layer weights, so a dipped macroblock crosses a bucket edge WHOLESALE and the
    // whole block adopts a neighbouring layer's wear response. They are authored on discrete
    // levels sitting right under those edges — glove_slick_half_back_tintid is 57% level 0 and
    // 8% level 36, with 0 and 1 units of headroom — against a measured lossy error of up to
    // 7/255. That map alone lands 5,362 texels (0.51%) in the wrong bucket, which renders as
    // unworn squares on the ID maps' 16px lattice (Driver Gloves | Brocade Flowers past wear
    // 0.30). Lossless drops it to zero, and all 37 ID maps shrink: 2177 KB VP8 → 628 KB VP8L.
    private static HashSet<string> CollectDataSelectorTexturePaths(ItemGeneratorContext ctx)
    {
        var result = new HashSet<string>();

        void AddResolved(string value)
        {
            try
            {
                var resolved = MaterialPaths.ResolveMaterialResourcePath(ctx, value);
                result.Add(MaterialPaths.NormalizeMaterialResourcePath(resolved));
            }
            catch { }
        }

        foreach (var data in ctx.MaterialDataByPath.Values)
        {
            if (data is not Dictionary<string, object?> vmat ||
                !vmat.TryGetValue("m_textureParams", out var paramsObj) ||
                paramsObj is not List<object?> textureParams)
                continue;
            foreach (var entry in textureParams)
            {
                if (entry is not Dictionary<string, object?> param ||
                    param.GetValueOrDefault("m_name") is not string name ||
                    !IsDataSelectorParamName(name) ||
                    param.GetValueOrDefault("m_pValue") is not string value)
                    continue;
                AddResolved(value);
            }
        }

        void WalkLooseVariables(object? node)
        {
            if (node is Dictionary<string, object?> dict)
            {
                if (dict.GetValueOrDefault("m_strName") is string name &&
                    IsDataSelectorParamName(name) &&
                    dict.GetValueOrDefault("m_strTextureRuntimeResourcePath") is string path &&
                    path.Length > 0)
                    AddResolved(path);
                foreach (var value in dict.Values) WalkLooseVariables(value);
            }
            else if (node is List<object?> list)
            {
                foreach (var value in list) WalkLooseVariables(value);
            }
        }
        foreach (var data in ctx.CompositeMaterialDataByPath.Values) WalkLooseVariables(data);

        foreach (var vtexPath in ctx.TexturesToProcess)
        {
            if (HasDataSelectorFilename(vtexPath))
                result.Add(vtexPath);
        }
        return result;
    }

    private static void ProcessMaterialTextures(ItemGeneratorContext ctx)
    {
        if (Config.IsAssetReuseEnabled())
        {
            foreach (var vtexPath in ctx.TexturesToProcess)
                TryReuseMaterialTexture(ctx, vtexPath);
        }

        var pending = ctx.TexturesToProcess
            .Where(p => !ctx.TextureFilenameByPath.ContainsKey(p)).ToList();
        if (pending.Count == 0) return;

        Log($"Processing {FormatCount(pending.Count, "material texture")}...");
        var normalMapTextures = CollectNormalMapTexturePaths(ctx);
        var dataSelectorTextures = CollectDataSelectorTexturePaths(ctx);

        var compiledPaths = pending.Select(MaterialPaths.ToCompiledMaterialResourcePath).ToList();
        // Keyed on the RESOLVED vpk path, because that is what the encode loop below compares
        // against. ResolveMaterialResourcePath falls back to matching the filename anywhere in
        // the index, so the resolved path is not always the string we started from, and keying
        // on the unresolved one would silently drop the lossless flag for anything relocated.
        var resolvedCompiledPaths = new List<string>(pending.Count);
        foreach (var vtexPath in pending)
        {
            try
            {
                resolvedCompiledPaths.Add(MaterialPaths.ToCompiledMaterialResourcePath(
                    MaterialPaths.ResolveMaterialResourcePath(ctx, vtexPath)));
            }
            catch { }
        }
        var (rawFourChannelNormals, syntheticAlphaTextures) =
            TextureCodecPolicy.Collect(ctx, resolvedCompiledPaths);
        ResourceDecompiler.DecompileAssets(ctx, compiledPaths);

        var stagingDir = Path.Combine(Config.ItemGeneratorBuildDir, "textures");
        Directory.CreateDirectory(stagingDir);

        var encodeJobs = new List<(string ResolvedVtexPath, string StagedPath)>();
        var manifestLines = new List<string>();

        foreach (var vtexPath in pending)
        {
            var resolvedVtexPath = MaterialPaths.ResolveMaterialResourcePath(ctx, vtexPath);
            var vpkPath = MaterialPaths.ToCompiledMaterialResourcePath(resolvedVtexPath);
            if (!ctx.VpkIndex.ContainsKey(vpkPath)) continue;

            var basePath = Path.Combine(Config.DecompiledDir,
                Path.GetDirectoryName(resolvedVtexPath)!,
                Path.GetFileNameWithoutExtension(resolvedVtexPath).Replace(".vtex", ""));
            var pngPath = $"{basePath}.png";
            var exrPath = $"{basePath}.exr";

            if (File.Exists(pngPath))
            {
                var stagedPath = Path.Combine(stagingDir, $"{encodeJobs.Count}.webp");
                var normalizedResolved = MaterialPaths.NormalizeMaterialResourcePath(resolvedVtexPath);
                // Lossless (data selectors) wins over near-lossless (normals) when both match.
                // Raw four-channel normals are data too: their channels are a packed
                // hemi-octahedral pair and an anisotropic roughness pair, decoded non-linearly
                // downstream, so near-lossless preprocessing would perturb the decoded normal
                // rather than the stored value. See TextureCodecPolicy.
                var lossless = dataSelectorTextures.Contains(vtexPath) ||
                    dataSelectorTextures.Contains(normalizedResolved) ||
                    rawFourChannelNormals.Contains(vpkPath);
                var nearLossless = !lossless && (normalMapTextures.Contains(vtexPath) ||
                    normalMapTextures.Contains(normalizedResolved));
                // The game's format for this texture has no alpha channel, so whatever VRF put
                // in the exported one is its decoder's invention. See TextureCodecPolicy.
                var dropAlpha = syntheticAlphaTextures.Contains(vpkPath);
                manifestLines.Add(JsonSerializer.Serialize(new
                {
                    src = pngPath,
                    dest = stagedPath,
                    // For near-lossless encodes, quality is libwebp's near-lossless level; for
                    // lossless it's VP8L's compression effort (not a fidelity knob).
                    quality = lossless ? Config.WebpLosslessQuality
                        : nearLossless ? Config.WebpNearLosslessNormals
                        : Config.WebpQuality,
                    nearLossless,
                    lossless,
                    dropAlpha
                }));
                encodeJobs.Add((resolvedVtexPath, stagedPath));
            }
            else if (File.Exists(exrPath))
            {
                PromoteTexture(ctx, resolvedVtexPath, exrPath, ".exr");
            }
        }

        if (encodeJobs.Count > 0)
        {
            var manifestPath = Path.Combine(Config.ItemGeneratorBuildDir, "webp-jobs.jsonl");
            File.WriteAllLines(manifestPath, manifestLines);
            RunEncodeWebpBatch(manifestPath, encodeJobs.Count);

            Parallel.ForEach(encodeJobs,
                new ParallelOptions { MaxDegreeOfParallelism = Environment.ProcessorCount },
                job => PromoteTexture(ctx, job.ResolvedVtexPath, job.StagedPath, ".webp"));
        }

        Log($"Processed {FormatCount(pending.Count, "material texture")}.");
    }

    private static void TryReuseMaterialTexture(ItemGeneratorContext ctx, string vtexPath)
    {
        string resolved;
        try { resolved = MaterialPaths.ResolveMaterialResourcePath(ctx, vtexPath); }
        catch { return; }

        var dir = Path.Combine(Config.OutputDir, "textures");
        if (!Directory.Exists(dir)) return;
        var baseName = Path.GetFileNameWithoutExtension(resolved);
        if (baseName.EndsWith(".vtex")) baseName = baseName[..^5];
        var matches = Directory.GetFiles(dir, $"{baseName}_????????.*")
            .Where(path => Path.GetExtension(path) is ".webp" or ".exr")
            .ToArray();
        if (matches.Length != 1) return;
        ctx.TextureFilenameByPath[resolved] = $"/textures/{Path.GetFileName(matches[0])}";
    }

    private static void PromoteTexture(ItemGeneratorContext ctx, string resolvedVtexPath, string srcPath, string extension)
    {
        var filename = MaterialPaths.GetTextureFilename(resolvedVtexPath, ContentVersion.HashFile(srcPath), extension);
        var outPath = Path.Combine(Config.OutputDir, "textures", filename);
        Directory.CreateDirectory(Path.GetDirectoryName(outPath)!);
        File.Move(srcPath, outPath, true);
        lock (ctx.TextureFilenameByPath)
            ctx.TextureFilenameByPath[resolvedVtexPath] = $"/textures/{filename}";
    }

    // Texture PNGs are encoded by scripts/item-generator-webp.ts in one batch. sharp is pinned to an
    // exact version in package.json so texture bytes — and the content hashes embedded in their
    // filenames — are reproducible across machines (the former cwebp dependency came from apt
    // and drifted). The script passes `exact` to preserve RGB under fully-transparent pixels,
    // which shader logic reads.
    private static void RunEncodeWebpBatch(string manifestPath, int totalJobs)
    {
        if (!NodeAvailable.Value)
            throw new InvalidOperationException(
                "node not found. Textures are encoded via scripts/item-generator-webp.ts (sharp). " +
                "Install Node.js 20+ and run `npm install`.");

        var script = Path.Combine(Config.ScriptsDir, "item-generator-webp.ts");
        var info = new ProcessStartInfo("node")
        {
            ArgumentList = { "--import", "tsx", script, manifestPath },
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false
        };
        // sharp finishes encodes on the libuv pool; the default of 4 threads would bottleneck.
        info.Environment["UV_THREADPOOL_SIZE"] = Math.Max(4, Environment.ProcessorCount).ToString();

        using var p = Process.Start(info);
        var stderrTask = p!.StandardError.ReadToEndAsync();
        var processed = 0;
        var lastMilestone = 0;
        string? line;
        while ((line = p.StandardOutput.ReadLine()) != null)
        {
            if (line.StartsWith("done ", StringComparison.Ordinal))
                LogProgress(ref processed, ref lastMilestone, totalJobs);
        }
        p.WaitForExit();
        if (p.ExitCode != 0)
            throw new InvalidOperationException($"item-generator-webp.ts failed (exit {p.ExitCode}): {stderrTask.Result}");
    }

    private static void WriteMaterialMetadata(ItemGeneratorContext ctx)
    {
        // When cycleMembers is given (canonical pass over a cyclic group), references into the
        // group resolve to a stable placeholder derived from the source path instead of the final
        // filename, which doesn't exist yet. The placeholder never reaches an output file: it
        // only feeds the group's hash, and the final pass resolves every name for real.
        string? ResolveCompositeMaterial(string path, HashSet<string>? cycleMembers = null)
        {
            try
            {
                var resolved = MaterialPaths.ResolveMaterialResourcePath(ctx, path);
                if (cycleMembers != null && cycleMembers.Contains(resolved))
                    return $"cycle:{resolved}";
                return ctx.CompositeMaterialFilenameByPath.TryGetValue(resolved, out var filename)
                    ? $"/materials/{filename}" : null;
            }
            catch { return null; }
        }

        string? ResolveVmat(string path, HashSet<string>? cycleMembers = null)
        {
            try
            {
                var resolved = MaterialPaths.ResolveMaterialResourcePath(ctx, path);
                if (cycleMembers != null && cycleMembers.Contains(resolved))
                    return $"cycle:{resolved}";
                return ctx.MaterialFilenameByPath.TryGetValue(resolved, out var filename)
                    ? $"/materials/{filename}" : null;
            }
            catch { return null; }
        }

        string? ResolveTexture(string path)
        {
            try
            {
                var resolved = MaterialPaths.ResolveMaterialResourcePath(ctx, path);
                return ctx.TextureFilenameByPath.TryGetValue(resolved, out var value) ? value : null;
            }
            catch { return null; }
        }

        byte[] SerializeMaterial(object data, HashSet<string>? cycleMembers)
        {
            var patched = MaterialPaths.PatchMaterialResourceReferences(
                data,
                path => ResolveCompositeMaterial(path, cycleMembers),
                path => ResolveVmat(path, cycleMembers),
                ResolveTexture);
            return JsonSerializer.SerializeToUtf8Bytes(patched);
        }

        string GetMaterialFilename(string path, bool isComposite, string version) => isComposite
            ? MaterialPaths.GetCompositeMaterialFilename(path, version)
            : MaterialPaths.GetVmatFilename(path, version);

        void AssignFilename(string path, bool isComposite, string filename)
        {
            if (isComposite) ctx.CompositeMaterialFilenameByPath[path] = filename;
            else ctx.MaterialFilenameByPath[path] = filename;
            RecordMaterialRename(ctx, path, isComposite, filename);
        }

        void WriteMaterialFile(string filename, byte[] jsonBytes)
        {
            AssertMaterialReferencesRewritten(System.Text.Encoding.UTF8.GetString(jsonBytes), filename);
            var outPath = Path.Combine(Config.OutputDir, "materials", filename);
            Directory.CreateDirectory(Path.GetDirectoryName(outPath)!);
            File.WriteAllBytes(outPath, jsonBytes);
        }

        // Material JSONs embed the filenames of the materials they reference, so content-hashed
        // names must be assigned bottom-up: dependencies first, then their referrers.
        var dataByPath = new Dictionary<string, object?>();
        foreach (var (path, data) in ctx.CompositeMaterialDataByPath) dataByPath[path] = data;
        foreach (var (path, data) in ctx.MaterialDataByPath) dataByPath[path] = data;

        var dependencies = new Dictionary<string, List<string>>();
        foreach (var (path, data) in dataByPath)
        {
            var refs = new HashSet<string>();
            CollectMaterialResourceRefs(data, refs);
            var resolved = new List<string>();
            foreach (var reference in refs)
            {
                try
                {
                    var resolvedRef = MaterialPaths.ResolveMaterialResourcePath(ctx, reference);
                    if (dataByPath.ContainsKey(resolvedRef))
                        resolved.Add(resolvedRef);
                }
                catch { }
            }
            dependencies[path] = resolved;
        }

        foreach (var component in StronglyConnectedComponents(dataByPath.Keys.ToList(), dependencies))
        {
            if (component.Count == 1 && !dependencies[component[0]].Contains(component[0]))
            {
                var path = component[0];
                var isComposite = ctx.CompositeMaterialDataByPath.ContainsKey(path);
                var data = dataByPath[path];

                if (data == null)
                {
                    // No extractable content (missing or unparseable VPK entry): keep a
                    // deterministic sentinel name so references remain rewritable; no file is
                    // written (same dangling-reference behavior as the CRC-named pipeline).
                    AssignFilename(path, isComposite, GetMaterialFilename(path, isComposite, "00000000"));
                    continue;
                }

                var jsonBytes = SerializeMaterial(data, null);
                var filename = GetMaterialFilename(path, isComposite, ContentVersion.HashBytes(jsonBytes));
                AssignFilename(path, isComposite, filename);
                WriteMaterialFile(filename, jsonBytes);
                continue;
            }

            // Cyclic group (e.g. smg_mp9.vmat <-> smg_mp9_composite_inputs.vmat in CS2 data):
            // members embed each other's filenames, so no member can be named from its final
            // bytes. Instead the group shares one token — like paint wear sets and model pairs —
            // hashed from each member's canonical form. Any change to any member (or to an
            // external dependency's name) changes the token and renames the whole group.
            var members = new HashSet<string>(component);
            var token = ContentVersion.Combine(component.Select(path =>
                ContentVersion.HashBytesFull(SerializeMaterial(dataByPath[path]!, members))));

            var assigned = new HashSet<string>();
            foreach (var path in component)
            {
                var isComposite = ctx.CompositeMaterialDataByPath.ContainsKey(path);
                var filename = GetMaterialFilename(path, isComposite, token);
                if (!assigned.Add(filename))
                    throw new InvalidOperationException(
                        $"Filename collision inside material cycle: '{filename}' ({string.Join(", ", component)})");
                AssignFilename(path, isComposite, filename);
            }

            foreach (var path in component)
            {
                var isComposite = ctx.CompositeMaterialDataByPath.ContainsKey(path);
                var filename = isComposite
                    ? ctx.CompositeMaterialFilenameByPath[path]
                    : ctx.MaterialFilenameByPath[path];
                WriteMaterialFile(filename, SerializeMaterial(dataByPath[path]!, null));
            }
        }
    }

    // Items reference materials by their provisional CRC-based names (see
    // MaterialPaths.GetIndexed*Filename); record the mapping to the final content-hashed name.
    private static void RecordMaterialRename(ItemGeneratorContext ctx, string path, bool isComposite, string filename)
    {
        try
        {
            var provisional = isComposite
                ? MaterialPaths.GetIndexedCompositeMaterialFilename(ctx, path)
                : MaterialPaths.GetIndexedVmatFilename(ctx, path);
            if (provisional != filename)
                ctx.AssetRenames[$"/materials/{provisional}"] = $"/materials/{filename}";
        }
        catch { }
    }

    private static void CollectMaterialResourceRefs(object? value, HashSet<string> refs)
    {
        if (value is string str)
        {
            var normalized = MaterialPaths.NormalizeMaterialResourcePath(str);
            if (normalized.EndsWith(".vcompmat") || normalized.EndsWith(".vmat"))
                refs.Add(normalized);
        }
        else if (value is List<object?> list)
        {
            foreach (var entry in list)
                CollectMaterialResourceRefs(entry, refs);
        }
        else if (value is Dictionary<string, object?> dict)
        {
            foreach (var entry in dict.Values)
                CollectMaterialResourceRefs(entry, refs);
        }
    }

    // Tarjan's algorithm. Emits strongly connected components dependencies-first (each component
    // is emitted only after every component it depends on), which is exactly the order
    // WriteMaterialMetadata needs to assign names bottom-up.
    private static List<List<string>> StronglyConnectedComponents(
        IReadOnlyCollection<string> nodes, Dictionary<string, List<string>> dependencies)
    {
        var index = 0;
        var indices = new Dictionary<string, int>();
        var lowlinks = new Dictionary<string, int>();
        var onStack = new HashSet<string>();
        var stack = new Stack<string>();
        var result = new List<List<string>>();

        void StrongConnect(string node)
        {
            indices[node] = lowlinks[node] = index++;
            stack.Push(node);
            onStack.Add(node);

            foreach (var dep in dependencies[node])
            {
                if (!indices.ContainsKey(dep))
                {
                    StrongConnect(dep);
                    lowlinks[node] = Math.Min(lowlinks[node], lowlinks[dep]);
                }
                else if (onStack.Contains(dep))
                {
                    lowlinks[node] = Math.Min(lowlinks[node], indices[dep]);
                }
            }

            if (lowlinks[node] == indices[node])
            {
                var component = new List<string>();
                string member;
                do
                {
                    member = stack.Pop();
                    onStack.Remove(member);
                    component.Add(member);
                } while (member != node);
                result.Add(component);
            }
        }

        foreach (var node in nodes)
            if (!indices.ContainsKey(node))
                StrongConnect(node);

        return result;
    }

    private static void AddTextureToProcess(ItemGeneratorContext ctx, string vtexPath)
    {
        try
        {
            var resolved = MaterialPaths.ResolveMaterialResourcePath(ctx, vtexPath);
            ctx.TexturesToProcess.Add(MaterialPaths.NormalizeMaterialResourcePath(resolved));
        }
        catch { }
    }

    private static void UpdateModelAssetReferences(ItemGeneratorContext ctx,
        PendingModelTask model, string playerModel, string modelData)
    {
        foreach (var item in ctx.Items.Values)
        {
            if (item.ModelPath == model.PlayerModel)
                item.ModelPath = playerModel;
        }
        model.PlayerModel = playerModel;
        model.ModelData = modelData;
    }

    private static async Task EnsureAssetPackages(ItemGeneratorContext ctx, List<string> vpkPaths)
    {
        var vpks = new HashSet<string>();
        foreach (var vpkPath in vpkPaths)
        {
            // 0x7FFF marks entries inlined in pak01_dir.vpk; there is no archive to fetch.
            if (ctx.VpkIndex.TryGetValue(vpkPath, out var entry)
                && int.TryParse(entry.Fnumber, out var fnumber) && fnumber != 0x7FFF)
                vpks.Add(Config.GetArchiveDepotPath(fnumber));
        }
        if (vpks.Count == 0) return;
        await Depot.DepotDownloaderService.DownloadFiles([.. vpks], Config.WorkdirDir);
    }

    // Geometry is exported uncompressed. We shell out to scripts/item-generator-glb.ts (gltf-transform
    // + the meshoptimizer codec) to add EXT_meshopt_compression. The codec is fully reversible, so
    // this only shrinks the file — meshes, nodes, skins, accessors, and float precision are left
    // bit-identical. One tsx process handles each model; they run in parallel.
    private static readonly Lazy<bool> NodeAvailable = new(() =>
    {
        try
        {
            using var p = Process.Start(new ProcessStartInfo("node")
            {
                ArgumentList = { "--version" },
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false
            });
            p!.WaitForExit();
            return p.ExitCode == 0;
        }
        catch { return false; }
    });

    private static async Task OptimizeGlbsMeshopt(IReadOnlyList<string> glbPaths)
    {
        if (glbPaths.Count == 0) return;
        if (!NodeAvailable.Value)
            throw new InvalidOperationException(
                "node not found. GLB geometry is compressed with EXT_meshopt_compression via " +
                "scripts/item-generator-glb.ts (gltf-transform + meshoptimizer). Install Node.js 20+ " +
                "and run `npm install`.");

        Log($"Compressing {FormatCount(glbPaths.Count, "model")} with EXT_meshopt_compression...");
        var script = Path.Combine(Config.ScriptsDir, "item-generator-glb.ts");
        var semaphore = new SemaphoreSlim(Config.ExternalConcurrency);
        var compressed = 0;
        var lastMilestone = 0;
        await Task.WhenAll(glbPaths.Select(async glbPath =>
        {
            await semaphore.WaitAsync();
            try { await OptimizeGlbMeshopt(script, glbPath); }
            finally
            {
                semaphore.Release();
                LogProgress(ref compressed, ref lastMilestone, glbPaths.Count);
            }
        }));
    }

    private static async Task OptimizeGlbMeshopt(string script, string glbPath)
    {
        using var p = Process.Start(new ProcessStartInfo("node")
        {
            ArgumentList = { "--import", "tsx", script, glbPath },
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false
        });
        var err = await p!.StandardError.ReadToEndAsync();
        await p.WaitForExitAsync();
        if (p.ExitCode != 0)
            throw new InvalidOperationException($"item-generator-glb.ts failed for {glbPath} (exit {p.ExitCode}): {err}");
    }

    private static bool ConvertToWebp(string srcPath, string outPath)
    {
        if (!File.Exists(srcPath)) return false;
        using var bitmap = SKBitmap.Decode(srcPath);
        if (bitmap == null) return false;
        using var image = SKImage.FromBitmap(bitmap);
        using var data = image.Encode(SKEncodedImageFormat.Webp, Config.WebpQuality);
        Directory.CreateDirectory(Path.GetDirectoryName(outPath)!);
        using var stream = File.Create(outPath);
        data.SaveTo(stream);
        return true;
    }

    private static bool ConvertSvgToWebp(string srcPath, string outPath)
    {
        if (!File.Exists(srcPath)) return false;
        // SVG rendering requires Svg.Skia package. For collection icons that are SVG,
        // we use VRF's built-in SVG decompilation which already outputs PNG.
        // If the decompiled output is a PNG next to the SVG, use that instead.
        var pngPath = Path.ChangeExtension(srcPath, ".png");
        if (File.Exists(pngPath))
            return ConvertToWebp(pngPath, outPath);

        // Fallback: copy SVG as-is (won't be webp, but preserves the asset)
        Directory.CreateDirectory(Path.GetDirectoryName(outPath)!);
        File.Copy(srcPath, outPath, true);
        return true;
    }

    // Exported models must not carry real textures. Downscale every embedded image to a tiny
    // 4x4 WebP stub while leaving geometry, the material graph, and all texture/sampler wiring
    // intact. Each stub keeps its source's representative color, so material slots still point
    // at a plausible placeholder. This drops a weapon model from ~77 MB to ~1 MB.
    private static void StubModelTextures(string glbPath)
    {
        var model = ModelRoot.Load(glbPath);
        if (model.LogicalImages.Count == 0) return;

        foreach (var image in model.LogicalImages)
        {
            var stub = DownscaleToPlaceholderWebp(image.Content.Content.ToArray());
            if (stub != null)
                image.Content = new SharpGLTF.Memory.MemoryImage(stub);
        }

        model.SaveGLB(glbPath);
    }

    private static byte[]? DownscaleToPlaceholderWebp(byte[] source)
    {
        using var bitmap = SKBitmap.Decode(source);
        if (bitmap == null) return null;

        // Opaque target so the encoder emits a plain RGB (lossy VP8) WebP, like the reference.
        var info = new SKImageInfo(4, 4, SKColorType.Rgba8888, SKAlphaType.Opaque);
        using var resized = new SKBitmap(info);
        if (!bitmap.ScalePixels(resized, new SKSamplingOptions(SKFilterMode.Linear, SKMipmapMode.None)))
            return null;

        using var image = SKImage.FromBitmap(resized);
        using var data = image.Encode(SKEncodedImageFormat.Webp, Config.WebpQuality);
        return data?.ToArray();
    }

    private static readonly Lazy<byte[]> PlaceholderTexturePng = new(() =>
    {
        using var bitmap = new SKBitmap(4, 4, SKColorType.Rgba8888, SKAlphaType.Premul);
        using var image = SKImage.FromBitmap(bitmap);
        using var data = image.Encode(SKEncodedImageFormat.Png, 100);
        return data.ToArray();
    });

    // VRF's GltfModelExporter occasionally references a satellite texture in the exported GLB JSON
    // (seen with TGA-sourced ORM packs) without writing the .png file. Those images are downscaled
    // to 4x4 stubs in StubModelTextures anyway — the real textures ship via the material pipeline —
    // so a missing one must not abort ModelRoot.Load. Write a placeholder for any referenced-but-
    // missing satellite so the GLB resolves; it gets stubbed like every other embedded image.
    private static void EnsureGlbSatelliteTextures(string glbPath)
    {
        var dir = Path.GetDirectoryName(glbPath)!;
        var bytes = File.ReadAllBytes(glbPath);
        // GLB: 12-byte header, then chunks [length u32][type u32][data]; the first chunk is JSON.
        if (bytes.Length < 20) return;
        var jsonLength = (int)BitConverter.ToUInt32(bytes, 12);
        if (20 + jsonLength > bytes.Length) return;

        var json = System.Text.Encoding.UTF8.GetString(bytes, 20, jsonLength);
        using var doc = JsonDocument.Parse(json);
        if (!doc.RootElement.TryGetProperty("images", out var images)) return;

        foreach (var image in images.EnumerateArray())
        {
            if (!image.TryGetProperty("uri", out var uriProp)) continue;
            var uri = uriProp.GetString();
            if (string.IsNullOrEmpty(uri) || uri.StartsWith("data:", StringComparison.Ordinal)) continue;

            var path = Path.Combine(dir, Uri.UnescapeDataString(uri));
            if (File.Exists(path)) continue;
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            File.WriteAllBytes(path, PlaceholderTexturePng.Value);
            Log($"  wrote placeholder for missing satellite texture {uri}");
        }
    }

    private static void PatchGlbAssets(ItemGeneratorContext ctx, string glbPath)
    {
        var model = ModelRoot.Load(glbPath);
        var patched = false;
        foreach (var material in model.LogicalMaterials)
        {
            if (material.Extras is not JsonObject extrasObj) continue;
            if (!extrasObj.TryGetPropertyValue("vmat", out var vmatNode) || vmatNode is not JsonObject vmatObj) continue;
            if (!vmatObj.TryGetPropertyValue("Name", out var nameNode) || nameNode == null) continue;
            var vmatPath = nameNode.GetValue<string>().Replace('\\', '/');
            if (!ctx.MaterialFilenameByPath.TryGetValue(vmatPath, out var filename)) continue;
            var matName = Path.GetFileNameWithoutExtension(Path.GetFileNameWithoutExtension(filename));
            material.Name = matName;
            patched = true;
        }
        if (patched) model.SaveGLB(glbPath);
    }

    private static void AssertMaterialReferencesRewritten(string json, string filename)
    {
        var match = UnrewrittenRefRegex().Match(json);
        if (match.Success)
            throw new InvalidOperationException($"Unrewritten material reference '{match.Value}' found in '{filename}'.");
    }

    private static bool ColorizeGraffitiImage(string srcPath, string hexColor, string outPath)
    {
        if (!File.Exists(srcPath)) return false;

        var colorR = Convert.ToByte(hexColor.Substring(1, 2), 16) / 255.0f;
        var colorG = Convert.ToByte(hexColor.Substring(3, 2), 16) / 255.0f;
        var colorB = Convert.ToByte(hexColor.Substring(5, 2), 16) / 255.0f;

        using var bitmap = SKBitmap.Decode(srcPath);
        if (bitmap == null) return false;

        var output = new SKBitmap(bitmap.Width, bitmap.Height, SKColorType.Rgba8888, SKAlphaType.Premul);
        for (int y = 0; y < bitmap.Height; y++)
        {
            for (int x = 0; x < bitmap.Width; x++)
            {
                var pixel = bitmap.GetPixel(x, y);
                var gray = 0.2126f * (pixel.Red / 255f) + 0.7152f * (pixel.Green / 255f) + 0.0722f * (pixel.Blue / 255f);
                output.SetPixel(x, y, new SKColor(
                    (byte)(gray * colorR * 255),
                    (byte)(gray * colorG * 255),
                    (byte)(gray * colorB * 255),
                    pixel.Alpha));
            }
        }

        using var image = SKImage.FromBitmap(output);
        using var data = image.Encode(SKEncodedImageFormat.Webp, Config.WebpQuality);
        Directory.CreateDirectory(Path.GetDirectoryName(outPath)!);
        using var stream = File.Create(outPath);
        data.SaveTo(stream);
        output.Dispose();
        return true;
    }
}
