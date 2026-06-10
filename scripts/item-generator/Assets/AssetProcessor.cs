using System.Diagnostics;
using System.Security.Cryptography;
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

    public static async Task ProcessAssets(ItemGeneratorContext ctx)
    {
        if (ctx.NeededVpkPaths.Count > 0)
        {
            var vpkPaths = ctx.NeededVpkPaths.ToList();
            Log($"Resolving {FormatCount(vpkPaths.Count, "VPK asset")}...");
            if (ctx.Mode == ItemGeneratorMode.Limited)
                await EnsureAssetPackages(ctx, vpkPaths);
            ResourceDecompiler.DecompileAssets(ctx, vpkPaths);
        }

        await ProcessImages(ctx);

        if (ctx.Mode == ItemGeneratorMode.Full)
        {
            PreProcessCompositeMaterials(ctx);
            await ProcessModels(ctx);
            PreProcessMaterials(ctx);
            ProcessMaterialTextures(ctx);
            WriteMaterialMetadata(ctx);
        }
    }

    private static async Task ProcessImages(ItemGeneratorContext ctx)
    {
        if (ctx.ImagesToProcess.Count == 0) return;
        Log($"Processing {FormatCount(ctx.ImagesToProcess.Count, "image task")}...");

        var semaphore = new SemaphoreSlim(Math.Max(2, Math.Min(8, ctx.ImagesToProcess.Count)));
        var tasks = new List<Task>();

        foreach (var task in ctx.ImagesToProcess.Values)
        {
            tasks.Add(Task.Run(async () =>
            {
                await semaphore.WaitAsync();
                try
                {
                    switch (task)
                    {
                        case RegularImageTask regular:
                            await ConvertToWebp(regular.LocalPath, regular.Filename);
                            break;
                        case PaintImageTask paint:
                            foreach (var (src, suffix) in paint.LocalPaths)
                                await ConvertToWebp(src, $"/images/{paint.BaseName}_{suffix}.webp");
                            if (paint.LocalPaths.Count > 0)
                                await ConvertToWebp(paint.LocalPaths[0].Src, paint.BaseFilename);
                            break;
                        case GraffitiImageTask graffiti:
                            await ColorizeGraffitiImage(graffiti.LocalPath, graffiti.HexColor, graffiti.Filename);
                            break;
                        case SvgImageTask svg:
                            await ConvertSvgToWebp(svg.LocalPath, svg.Filename);
                            break;
                    }
                }
                finally { semaphore.Release(); }
            }));
        }

        await Task.WhenAll(tasks);
        Log($"Processed {FormatCount(ctx.ImagesToProcess.Count, "image task")}.");
    }

    private static async Task ProcessModels(ItemGeneratorContext ctx)
    {
        if (ctx.ModelsToProcess.Count == 0) return;
        Log($"Processing {FormatCount(ctx.ModelsToProcess.Count, "model")}...");
        ResourceDecompiler.DecompileModelAssets(ctx, ctx.ModelsToProcess.Keys);
        ExtractModelData(ctx);
        PreProcessMaterials(ctx);

        // Pass 1: patch + stub each model, collecting the GLBs to compress.
        var stubbed = new List<(string VpkPath, PendingModelTask Model, string GlbPath)>();
        foreach (var (vpkPath, model) in ctx.ModelsToProcess)
        {
            var modelDir = Path.Combine(Config.DecompiledDir, Path.GetDirectoryName(vpkPath)!);
            var baseName = Path.GetFileNameWithoutExtension(vpkPath).Replace(".vmdl", "");
            var glbPath = Path.Combine(modelDir, $"{baseName}.glb");

            if (!File.Exists(glbPath)) continue;

            PatchGlbAssets(ctx, glbPath);
            StubModelTextures(glbPath);
            stubbed.Add((vpkPath, model, glbPath));
        }

        // Compress geometry with EXT_meshopt_compression before hashing, so the version hash
        // reflects the compressed bytes.
        await OptimizeGlbsMeshopt(stubbed.Select(s => s.GlbPath).ToList());

        // Pass 2: hash, version, and move each compressed GLB into the output tree.
        foreach (var (vpkPath, model, glbPath) in stubbed)
        {
            var modelDataPath = Path.Combine(Config.OutputDir, model.ModelData.TrimStart('/'));
            var dependencyHash = GetDependencyHash([
                await GetFileSha256(glbPath),
                File.Exists(modelDataPath) ? await GetFileSha256(modelDataPath) : ""
            ]);

            var versionedBase = $"{model.Base}_{model.Crc}_{dependencyHash}";
            var versionedModelPlayer = $"/models/{versionedBase}.glb";
            var versionedModelData = $"/models/{versionedBase}.json";

            var destGlb = Path.Combine(Config.OutputDir, versionedModelPlayer.TrimStart('/'));
            var destData = Path.Combine(Config.OutputDir, versionedModelData.TrimStart('/'));
            Directory.CreateDirectory(Path.GetDirectoryName(destGlb)!);
            File.Move(glbPath, destGlb, true);
            if (File.Exists(modelDataPath))
                File.Move(modelDataPath, destData, true);

            UpdateModelAssetReferences(ctx, model, versionedModelPlayer, versionedModelData);
        }

        Log($"Processed {FormatCount(ctx.ModelsToProcess.Count, "model")}.");
    }

    private static void ExtractModelData(ItemGeneratorContext ctx)
    {
        var entries = ctx.ModelsToProcess.Select(kv =>
            (VpkPath: kv.Key, TargetFilename: kv.Value.ModelPlayer)).ToList();
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

                var modelPlayerPath = $"/models/{Path.ChangeExtension(result.Filename, ".glb")}";
                if (result.Data is Dictionary<string, object?> dataDict &&
                    dataDict.TryGetValue("m_modelInfo", out var modelInfoObj) &&
                    modelInfoObj is Dictionary<string, object?> modelInfo &&
                    modelInfo.TryGetValue("m_keyValueText", out var kvTextObj) &&
                    kvTextObj is Dictionary<string, object?> kvText &&
                    kvText.TryGetValue("StickerMarkup", out var stickerMarkupObj) &&
                    stickerMarkupObj is List<object?> stickerMarkup)
                {
                    var stickerMax = stickerMarkup.Count(s =>
                        s is Dictionary<string, object?> d &&
                        d.TryGetValue("Mesh", out var mesh) &&
                        mesh?.ToString() == "body_hd");
                    var stickerMaxForLegacy = stickerMarkup.Count - stickerMax;

                    foreach (var item in ctx.Items.Values)
                    {
                        if (item.ModelPlayer == modelPlayerPath)
                        {
                            item.StickerMax = stickerMax > 0 ? stickerMax : null;
                            item.StickerMaxForLegacy = stickerMaxForLegacy > 0 ? stickerMaxForLegacy : null;
                        }
                    }
                }
            }
        }
    }

    private static void PreProcessCompositeMaterials(ItemGeneratorContext ctx)
    {
        var pending = ctx.CompositeMaterialsToProcess
            .Where(p => !ctx.CompositeMaterialDataByPath.ContainsKey(p)).ToList();
        if (pending.Count == 0) return;

        Log($"Extracting {FormatCount(pending.Count, "composite material")}...");
        var processed = new HashSet<string>(ctx.CompositeMaterialDataByPath.Keys);
        var queue = new HashSet<string>(pending);

        while (queue.Count > 0)
        {
            var batch = queue.ToList();
            queue.Clear();

            var results = MetadataExtractor.ExtractCompositeMaterialMetadata(ctx, batch);
            foreach (var result in results)
            {
                processed.Add(result.VcompmatPath);
                ctx.CompositeMaterialDataByPath[result.VcompmatPath] = result.Data;
                ctx.CompositeMaterialFilenameByPath[result.VcompmatPath] = result.Filename;
                ctx.CompositeMaterialRefsByPath[result.VcompmatPath] = result.CompositeMaterialRefs;

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

        while (queue.Count > 0)
        {
            var batch = queue.ToList();
            queue.Clear();

            var results = MetadataExtractor.ExtractMaterialMetadata(ctx, batch);
            foreach (var result in results)
            {
                processed.Add(result.VmatPath);
                ctx.MaterialFilenameByPath[result.VmatPath] = result.Filename;
                ctx.MaterialRefsByPath[result.VmatPath] = result.VmatRefs;
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

    private static void ProcessMaterialTextures(ItemGeneratorContext ctx)
    {
        var pending = ctx.TexturesToProcess
            .Where(p => !ctx.TextureFilenameByPath.ContainsKey(p)).ToList();
        if (pending.Count == 0) return;

        Log($"Processing {FormatCount(pending.Count, "material texture")}...");
        var normalMapTextures = CollectNormalMapTexturePaths(ctx);

        var compiledPaths = pending.Select(MaterialPaths.ToCompiledMaterialResourcePath).ToList();
        ResourceDecompiler.DecompileAssets(ctx, compiledPaths);

        var total = pending.Count;
        var processed = 0;
        var lastMilestone = 0;
        var resultLock = new object();

        Parallel.ForEach(pending, new ParallelOptions { MaxDegreeOfParallelism = Environment.ProcessorCount }, vtexPath =>
        {
            var resolvedVtexPath = MaterialPaths.ResolveMaterialResourcePath(ctx, vtexPath);
            var vpkPath = MaterialPaths.ToCompiledMaterialResourcePath(resolvedVtexPath);
            if (!ctx.VpkIndex.TryGetValue(vpkPath, out var vpkEntry)) return;

            var basePath = Path.Combine(Config.DecompiledDir,
                Path.GetDirectoryName(resolvedVtexPath)!,
                Path.GetFileNameWithoutExtension(resolvedVtexPath).Replace(".vtex", ""));
            var pngPath = $"{basePath}.png";
            var exrPath = $"{basePath}.exr";

            string? textureFilename = null;

            if (File.Exists(pngPath))
            {
                var filename = MaterialPaths.GetTextureFilename(resolvedVtexPath, vpkEntry.Crc, ".webp");
                var outPath = Path.Combine(Config.OutputDir, "textures", filename);
                Directory.CreateDirectory(Path.GetDirectoryName(outPath)!);
                EncodeTextureWebpExact(pngPath, outPath,
                    nearLossless: normalMapTextures.Contains(vtexPath) ||
                        normalMapTextures.Contains(MaterialPaths.NormalizeMaterialResourcePath(resolvedVtexPath)));
                textureFilename = $"/textures/{filename}";
            }
            else if (File.Exists(exrPath))
            {
                var filename = MaterialPaths.GetTextureFilename(resolvedVtexPath, vpkEntry.Crc, ".exr");
                var outPath = Path.Combine(Config.OutputDir, "textures", filename);
                Directory.CreateDirectory(Path.GetDirectoryName(outPath)!);
                File.Move(exrPath, outPath, true);
                textureFilename = $"/textures/{filename}";
            }

            if (textureFilename != null)
                lock (resultLock) ctx.TextureFilenameByPath[resolvedVtexPath] = textureFilename;

            var current = Interlocked.Increment(ref processed);
            var pct = current * 100 / total;
            var milestone = pct / 5 * 5;
            if (milestone > 0 && milestone > Volatile.Read(ref lastMilestone) &&
                Interlocked.Exchange(ref lastMilestone, milestone) < milestone)
                Log($"  {milestone}% ({current}/{total})");
        });

        Log($"Processed {FormatCount(pending.Count, "material texture")}.");
    }

    private static void WriteMaterialMetadata(ItemGeneratorContext ctx)
    {
        string? ResolveCompositeMaterial(string path)
        {
            try
            {
                var resolved = MaterialPaths.ResolveMaterialResourcePath(ctx, path);
                return ctx.CompositeMaterialFilenameByPath.TryGetValue(resolved, out var filename)
                    ? $"/materials/{filename}" : null;
            }
            catch { return null; }
        }

        string? ResolveVmat(string path)
        {
            try
            {
                var resolved = MaterialPaths.ResolveMaterialResourcePath(ctx, path);
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

        foreach (var (vcompmatPath, data) in ctx.CompositeMaterialDataByPath)
        {
            if (data == null) continue;
            if (!ctx.CompositeMaterialFilenameByPath.TryGetValue(vcompmatPath, out var filename)) continue;
            var patched = MaterialPaths.PatchMaterialResourceReferences(data, ResolveCompositeMaterial, ResolveVmat, ResolveTexture);
            var json = JsonSerializer.Serialize(patched);
            AssertMaterialReferencesRewritten(json, filename);
            var outPath = Path.Combine(Config.OutputDir, "materials", filename);
            Directory.CreateDirectory(Path.GetDirectoryName(outPath)!);
            File.WriteAllText(outPath, json);
        }

        foreach (var (vmatPath, data) in ctx.MaterialDataByPath)
        {
            if (data == null) continue;
            if (!ctx.MaterialFilenameByPath.TryGetValue(vmatPath, out var filename)) continue;
            var patched = MaterialPaths.PatchMaterialResourceReferences(data, ResolveCompositeMaterial, ResolveVmat, ResolveTexture);
            var json = JsonSerializer.Serialize(patched);
            AssertMaterialReferencesRewritten(json, filename);
            var outPath = Path.Combine(Config.OutputDir, "materials", filename);
            Directory.CreateDirectory(Path.GetDirectoryName(outPath)!);
            File.WriteAllText(outPath, json);
        }
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
        PendingModelTask model, string modelPlayer, string modelData)
    {
        foreach (var item in ctx.Items.Values)
        {
            if (item.ModelPlayer == model.ModelPlayer)
                item.ModelPlayer = modelPlayer;
        }
        model.ModelPlayer = modelPlayer;
        model.ModelData = modelData;
    }

    private static async Task<string> GetFileSha256(string path)
    {
        await using var fs = File.OpenRead(path);
        var hash = await SHA256.HashDataAsync(fs);
        return Convert.ToHexStringLower(hash);
    }

    private static string GetDependencyHash(IEnumerable<string> dependencies)
    {
        var sorted = dependencies.Where(d => d.Length > 0).Distinct().Order().ToList();
        var bytes = SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(string.Join("\n", sorted)));
        return Convert.ToHexStringLower(bytes)[..8];
    }

    private static async Task EnsureAssetPackages(ItemGeneratorContext ctx, List<string> vpkPaths)
    {
        var vpks = new HashSet<string>();
        foreach (var vpkPath in vpkPaths)
        {
            if (ctx.VpkIndex.TryGetValue(vpkPath, out var entry))
                vpks.Add($"game/csgo/pak01_{entry.Fnumber.PadLeft(3, '0')}.vpk");
        }
        if (vpks.Count == 0) return;
        await Depot.DepotDownloaderService.DownloadFiles([.. vpks], Config.WorkdirDir);
    }

    // Material textures can carry meaningful RGB under fully-transparent (alpha=0) pixels,
    // which shader logic reads. SkiaSharp's WebP encoder doesn't expose libwebp's `exact`
    // flag, so it discards that hidden RGB. We shell out to cwebp -exact for textures to
    // preserve it, mirroring the legacy sharp pipeline's { quality: 95, exact: true }.
    private static readonly Lazy<bool> CwebpAvailable = new(() =>
    {
        try
        {
            using var p = Process.Start(new ProcessStartInfo("cwebp")
            {
                ArgumentList = { "-version" },
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false
            });
            p!.WaitForExit();
            return p.ExitCode == 0;
        }
        catch { return false; }
    });

    private static void EncodeTextureWebpExact(string srcPng, string outPath, bool nearLossless = false)
    {
        if (!CwebpAvailable.Value)
            throw new InvalidOperationException(
                "cwebp not found. Texture WebP encoding needs libwebp's `exact` flag to " +
                "preserve RGB under transparent pixels (read by shader logic); SkiaSharp " +
                "cannot. Install it locally with `sudo apt install webp`.");

        var info = new ProcessStartInfo("cwebp")
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false
        };
        info.ArgumentList.Add("-quiet");
        if (nearLossless)
        {
            // Normal maps: see Config.WebpNearLosslessNormals for why these never go lossy.
            info.ArgumentList.Add("-near_lossless");
            info.ArgumentList.Add(Config.WebpNearLosslessNormals.ToString());
        }
        else
        {
            info.ArgumentList.Add("-q");
            info.ArgumentList.Add(Config.WebpQuality.ToString());
        }
        info.ArgumentList.Add("-exact");
        info.ArgumentList.Add(srcPng);
        info.ArgumentList.Add("-o");
        info.ArgumentList.Add(outPath);

        using var p = Process.Start(info);
        var err = p!.StandardError.ReadToEnd();
        p.WaitForExit();
        if (p.ExitCode != 0)
            throw new InvalidOperationException($"cwebp failed for {srcPng} (exit {p.ExitCode}): {err}");
    }

    // Geometry is exported uncompressed. We shell out to scripts/optimize-glb.ts (gltf-transform
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
                "scripts/optimize-glb.ts (gltf-transform + meshoptimizer). Install Node.js 20+ " +
                "and run `npm install`.");

        Log($"Compressing {FormatCount(glbPaths.Count, "model")} with EXT_meshopt_compression...");
        var script = Path.Combine(Config.ScriptsDir, "optimize-glb.ts");
        var semaphore = new SemaphoreSlim(Config.ExternalConcurrency);
        await Task.WhenAll(glbPaths.Select(async glbPath =>
        {
            await semaphore.WaitAsync();
            try { await OptimizeGlbMeshopt(script, glbPath); }
            finally { semaphore.Release(); }
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
            throw new InvalidOperationException($"optimize-glb.ts failed for {glbPath} (exit {p.ExitCode}): {err}");
    }

    private static Task ConvertToWebp(string srcPath, string destFilename)
    {
        if (!File.Exists(srcPath)) return Task.CompletedTask;
        using var bitmap = SKBitmap.Decode(srcPath);
        if (bitmap == null) return Task.CompletedTask;
        using var image = SKImage.FromBitmap(bitmap);
        using var data = image.Encode(SKEncodedImageFormat.Webp, Config.WebpQuality);
        var outPath = Path.Combine(Config.OutputDir, destFilename.TrimStart('/'));
        Directory.CreateDirectory(Path.GetDirectoryName(outPath)!);
        using var stream = File.Create(outPath);
        data.SaveTo(stream);
        return Task.CompletedTask;
    }

    private static Task ConvertSvgToWebp(string srcPath, string destFilename)
    {
        if (!File.Exists(srcPath)) return Task.CompletedTask;
        // SVG rendering requires Svg.Skia package. For collection icons that are SVG,
        // we use VRF's built-in SVG decompilation which already outputs PNG.
        // If the decompiled output is a PNG next to the SVG, use that instead.
        var pngPath = Path.ChangeExtension(srcPath, ".png");
        if (File.Exists(pngPath))
            return ConvertToWebp(pngPath, destFilename);

        // Fallback: copy SVG as-is (won't be webp, but preserves the asset)
        var outPath = Path.Combine(Config.OutputDir, destFilename.TrimStart('/'));
        Directory.CreateDirectory(Path.GetDirectoryName(outPath)!);
        File.Copy(srcPath, outPath, true);
        return Task.CompletedTask;
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

    private static Task ColorizeGraffitiImage(string srcPath, string hexColor, string destFilename)
    {
        if (!File.Exists(srcPath)) return Task.CompletedTask;

        var colorR = Convert.ToByte(hexColor.Substring(1, 2), 16) / 255.0f;
        var colorG = Convert.ToByte(hexColor.Substring(3, 2), 16) / 255.0f;
        var colorB = Convert.ToByte(hexColor.Substring(5, 2), 16) / 255.0f;

        using var bitmap = SKBitmap.Decode(srcPath);
        if (bitmap == null) return Task.CompletedTask;

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
        var outPath = Path.Combine(Config.OutputDir, destFilename.TrimStart('/'));
        Directory.CreateDirectory(Path.GetDirectoryName(outPath)!);
        using var stream = File.Create(outPath);
        data.SaveTo(stream);
        output.Dispose();
        return Task.CompletedTask;
    }
}
