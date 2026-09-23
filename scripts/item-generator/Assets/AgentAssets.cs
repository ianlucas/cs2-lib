/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

using System.Diagnostics;
using System.Text.Json;
using ItemGenerator.GameFiles;
using SkiaSharp;
using static ItemGenerator.Logging;

namespace ItemGenerator;

// The agent-only half of the asset pass. Two jobs that no other item type needs:
//
//   1. FinalizeAgentModel — encode the agent's own textures and embed them in its .glb, instead of
//      stubbing them and publishing them separately, including the patch backings and eye
//      textures VRF never exports, and the roughness VRF leaves out of an anisotropic material's
//      ORM pack. See item-generator-agent-glb.ts.
//   2. ResolveAgentPatchSlots — turn the model's patch key-values and its materials' shader
//      parameters into the ordered three-slot array a consumer can actually place a patch with.
//      See docs/patches.md.
public static partial class AssetProcessor
{
    // Shader parameters holding the placeholder patch artwork. The game always overwrites these with
    // the applied patch's texture, so the shipped value never renders.
    private static readonly string[] PatchArtworkProperties = ["g_tPatch0", "g_tPatch1", "g_tPatch2"];

    /// <summary>
    /// One csgo_character.vfx material as the exported .glb carries it, read back out of
    /// `extras.vmat`. VRF preserves the whole vmat there, which is the only place the shader
    /// parameter a texture is bound to survives the glTF conversion. `GltfSlots` is the other half:
    /// glTF PBR slot name -> image name, the only binding the ORM pack VRF synthesises has.
    /// </summary>
    private sealed record GlbMaterial(
        string Path, string ShaderName, Dictionary<string, string> TextureParams,
        Dictionary<string, double> FloatParams, Dictionary<string, double[]> VectorParams,
        Dictionary<string, long> IntParams, Dictionary<string, string> GltfSlots);

    private static async Task FinalizeAgentModel(
        ItemGeneratorContext ctx, string vpkPath, PendingModelTask model, string glbPath)
    {
        if (!ctx.AgentModelExports.TryGetValue(vpkPath, out var export)) return;

        var materials = ReadGlbMaterials(glbPath);
        var images = ReadGlbImages(glbPath);

        // The placeholder artwork is stubbed rather than encoded — but only when nothing else binds
        // it, so a texture that doubles as a real input is never blanked.
        var stubs = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var otherwiseBound = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var material in materials)
            foreach (var (property, texture) in material.TextureParams)
            {
                if (PatchArtworkProperties.Contains(property, StringComparer.OrdinalIgnoreCase))
                    stubs.Add(texture);
                else
                    otherwiseBound.Add(texture);
            }
        stubs.ExceptWith(otherwiseBound);

        var tiers = Config.IsTextureOptimizationSkipped()
            ? []
            : CharacterTextureOptimization.ResolveTextureTiers(materials.Select(
                m => (m.Path, m.ShaderName, (IReadOnlyDictionary<string, string>)m.TextureParams,
                    (IReadOnlyDictionary<string, string>)m.GltfSlots)));

        var stagingDir = Path.Combine(Config.ItemGeneratorBuildDir, "agent-textures", model.Base);
        Directory.CreateDirectory(stagingDir);

        var glbDir = Path.GetDirectoryName(glbPath)!;
        var manifestJsonOptions = new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull
        };
        var manifestLines = new List<string>();
        var textures = new Dictionary<string, string>(StringComparer.Ordinal);

        var rebuiltOrms = await RebuildAnisotropicRoughness(ctx, glbPath, model, materials, images, stagingDir);

        // Resolved through the uri, not the name: a plain texture is named for its .vtex, but an
        // ORM pack VRF synthesises is named for its own .png, so no one stem rule covers both.
        var sources = images
            .Where(image => !stubs.Contains(image.Name))
            .Select(image => (image.Name, PngPath: rebuiltOrms.GetValueOrDefault(image.Name)
                ?? Path.Combine(glbDir, Uri.UnescapeDataString(image.Uri))))
            .Concat(await DecompileLooseTextures(ctx, glbPath, model, images,
                [.. ReadDrawnPatchBackings(model), .. ReadEyeTextures(materials)]));

        foreach (var (imageName, pngPath) in sources)
        {
            if (!File.Exists(pngPath)) continue;

            var stagedPath = Path.Combine(stagingDir, $"{manifestLines.Count}.webp");
            tiers.TryGetValue(imageName, out var tier);
            manifestLines.Add(JsonSerializer.Serialize(new
            {
                src = pngPath,
                dest = stagedPath,
                encode = (object?)tier
            }, manifestJsonOptions));
            textures[imageName] = stagedPath;
        }

        if (manifestLines.Count > 0)
        {
            var manifestPath = Path.Combine(stagingDir, "webp-jobs.jsonl");
            File.WriteAllLines(manifestPath, manifestLines);
            RunEncodeWebpBatch(manifestPath, manifestLines.Count);
        }

        var specPath = Path.Combine(stagingDir, "agent-glb.json");
        File.WriteAllText(specPath, JsonSerializer.Serialize(new
        {
            glb = glbPath,
            keepMeshes = export.KeepMeshes,
            pose = export.Pose,
            textures,
            stubTextures = stubs.ToList()
        }));

        await RunAgentGlbScript(specPath, glbPath);
        Directory.Delete(stagingDir, recursive: true);
    }

    // Shader parameters of a csgo_character.vfx F_EYEBALLS material that draw its eyes.
    private static readonly string[] EyeTextureProperties = ["g_tEyeMask1", "g_tEyeAlbedo1"];

    /// <summary>
    /// The backing of every patch slot that draws one.
    /// </summary>
    /// <remarks>
    /// Only slots with a non-zero `backingScale` draw one; the rest of a material's backing
    /// bindings are shader defaults the game never samples. Each is named by its `.vtex` stem,
    /// which is what `patchSlots.backing` carries, so it is looked up in the .glb by name. Runs
    /// after ResolveAgentPatchSlots, whose model data it reads. See docs/patches.md.
    /// </remarks>
    private static List<string> ReadDrawnPatchBackings(PendingModelTask model)
    {
        var modelDataPath = Path.Combine(Config.OutputDir, model.ModelData.TrimStart('/'));
        if (!File.Exists(modelDataPath)) return [];
        using var document = JsonDocument.Parse(File.ReadAllText(modelDataPath));
        if (!document.RootElement.TryGetProperty("patchSlots", out var slots)) return [];
        var drawn = new List<string>();
        foreach (var slot in slots.EnumerateArray())
            if (slot.TryGetProperty("backingScale", out var scale) && scale.GetDouble() != 0 &&
                slot.TryGetProperty("backing", out var backing) && backing.GetString() is { Length: > 0 } name)
                drawn.Add(name);
        return drawn;
    }

    /// <summary>
    /// The eye mask and iris of every material that draws eyeballs (F_EYEBALLS), by `.vtex` stem.
    /// </summary>
    /// <remarks>
    /// csgo_character.vfx ray-traces each eyeball inside the head's eye mask and projects the iris
    /// onto it; neither texture has a glTF slot. The consumer finds them through the material's
    /// `extras.vmat.TextureParams`, which names them by the same stem.
    /// </remarks>
    private static IEnumerable<string> ReadEyeTextures(List<GlbMaterial> materials) =>
        materials
            .Where(material => material.IntParams.GetValueOrDefault("F_EYEBALLS") != 0)
            .SelectMany(material => EyeTextureProperties.Select(property =>
                material.TextureParams.TryGetValue(property, out var name)
                    ? name
                    : throw new InvalidOperationException(
                        $"Eyeball material '{material.Path}' binds no {property}.")));

    /// <summary>
    /// Decompiles textures the agent's shaders sample outside any glTF slot, for embedding beside
    /// its own textures.
    /// </summary>
    /// <remarks>
    /// VRF's exporter only writes the textures a glTF slot (or the ORM pack it synthesises) points
    /// at, so a patch backing or an eye texture never reaches the export at all. Each is embedded
    /// as an image no texture references, named by its `.vtex` stem.
    /// </remarks>
    private static async Task<List<(string Name, string PngPath)>> DecompileLooseTextures(
        ItemGeneratorContext ctx, string glbPath, PendingModelTask model,
        List<(string Name, string Uri)> images, IEnumerable<string> names)
    {
        var loose = new HashSet<string>(names, StringComparer.OrdinalIgnoreCase);
        loose.ExceptWith(images.Select(image => image.Name));
        return await DecompileBoundTextures(ctx, glbPath, model, loose);
    }

    /// Decompiles textures the agent's materials bind in `extras.vmat`, named by `.vtex` stem.
    private static async Task<List<(string Name, string PngPath)>> DecompileBoundTextures(
        ItemGeneratorContext ctx, string glbPath, PendingModelTask model, IReadOnlyCollection<string> names)
    {
        if (names.Count == 0) return [];

        var resources = ReadTextureResources(glbPath);
        var textures = names.Select(name => resources.TryGetValue(name, out var resource)
            ? (Name: name, VpkPath: $"{resource}_c")
            : throw new InvalidOperationException(
                $"Agent '{model.Base}' samples '{name}', but no material binds it."))
            .ToList();

        var vpkPaths = textures.Select(texture => texture.VpkPath).ToList();
        if (ctx.SourceMode == Cs2SourceMode.WorkspaceDepot)
            await EnsureAssetPackages(ctx, vpkPaths);
        ResourceDecompiler.DecompileAssets(ctx, vpkPaths);

        return [.. textures.Select(texture =>
        {
            var pngPath = Path.Combine(Config.DecompiledDir, texture.VpkPath[..^"vtex_c".Length] + "png");
            return File.Exists(pngPath)
                ? (texture.Name, pngPath)
                : throw new InvalidOperationException(
                    $"Agent '{model.Base}' texture '{texture.VpkPath}' did not decompile to {pngPath}.");
        })];
    }

    /// <summary>
    /// Rewrites the roughness plane of every ORM pack an F_ANISOTROPIC_GLOSS material samples, and
    /// returns ORM image name -> rebuilt PNG.
    /// </summary>
    /// <remarks>
    /// <para>
    /// VRF fills an ORM's roughness from the roughness csgo_character.vfx packs beside g_tNormal.
    /// An anisotropic material packs none there: its g_tNormal is a two-channel ATI2N, and its
    /// roughness is compiled separately (Mip AnisoRoughness_RG, from the same TextureNormal and
    /// TextureRoughness inputs) into g_tAnisoGloss, a pair along the two anisotropy axes. VRF never
    /// reads that texture, so the pack ships a roughness of exactly 0 and a glTF viewer draws the
    /// material as a mirror. Measured across every agent: all 50 anisotropic materials, and none
    /// of the 408 others.
    /// </para>
    /// <para>
    /// glTF roughness is isotropic, so the pair collapses to its mean. The two agree to within
    /// ~0.1 on average, and the values sit in the same space as the isotropic packs beside them
    /// (Ava's jacket at 0.89, her head at 0.53, against 0.65 for bare-arm skin).
    /// </para>
    /// </remarks>
    private static async Task<Dictionary<string, string>> RebuildAnisotropicRoughness(
        ItemGeneratorContext ctx, string glbPath, PendingModelTask model, List<GlbMaterial> materials,
        List<(string Name, string Uri)> images, string stagingDir)
    {
        // ORM image name -> the g_tAnisoGloss its roughness comes from, or "" for an isotropic one.
        var roughnessSources = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var material in materials)
        {
            if (!material.GltfSlots.TryGetValue("metallicRoughnessTexture", out var orm)) continue;
            var source = "";
            if (material.IntParams.GetValueOrDefault("F_ANISOTROPIC_GLOSS") != 0)
                source = material.TextureParams.GetValueOrDefault("g_tAnisoGloss")
                    ?? throw new InvalidOperationException(
                        $"Anisotropic material '{material.Path}' binds no g_tAnisoGloss.");
            if (roughnessSources.TryGetValue(orm, out var existing) && existing != source)
                throw new InvalidOperationException(
                    $"Agent '{model.Base}' shares ORM pack '{orm}' between materials whose roughness " +
                    "comes from different textures, so no single rebuild is right for both.");
            roughnessSources[orm] = source;
        }

        var rebuilds = roughnessSources.Where(entry => entry.Value.Length > 0).ToList();
        if (rebuilds.Count == 0) return [];

        var glossPaths = (await DecompileBoundTextures(ctx, glbPath, model,
                [.. rebuilds.Select(entry => entry.Value).Distinct(StringComparer.OrdinalIgnoreCase)]))
            .ToDictionary(texture => texture.Name, texture => texture.PngPath, StringComparer.OrdinalIgnoreCase);
        var glbDir = Path.GetDirectoryName(glbPath)!;
        var rebuilt = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var (orm, gloss) in rebuilds)
        {
            var image = images.FirstOrDefault(image => image.Name == orm);
            var ormPath = image.Uri == null ? null : Path.Combine(glbDir, Uri.UnescapeDataString(image.Uri));
            if (ormPath == null || !File.Exists(ormPath)) continue;

            var outPath = Path.Combine(stagingDir, $"orm-{rebuilt.Count}.png");
            WriteAnisotropicRoughness(ormPath, glossPaths[gloss], outPath);
            rebuilt[orm] = outPath;
        }
        return rebuilt;
    }

    /// Writes `ormPath` with its roughness (G) replaced by the mean of the anisotropic pair.
    private static void WriteAnisotropicRoughness(string ormPath, string glossPath, string outPath)
    {
        using var orm = DecodeRgba(ormPath, null);
        using var gloss = DecodeRgba(glossPath, new SKSizeI(orm.Width, orm.Height));
        var ormPixels = orm.GetPixelSpan();
        var glossPixels = gloss.GetPixelSpan();
        for (var i = 0; i < ormPixels.Length; i += 4)
            ormPixels[i + 1] = (byte)((glossPixels[i] + glossPixels[i + 1] + 1) / 2);

        using var image = SKImage.FromBitmap(orm);
        using var data = image.Encode(SKEncodedImageFormat.Png, 100);
        File.WriteAllBytes(outPath, data.ToArray());
    }

    /// <summary>
    /// Decodes a PNG to straight RGBA8888, resampled to `size` when given.
    /// </summary>
    /// <remarks>
    /// Both inputs are data, not colour, so the targets carry no colour space: Skia converts only
    /// between two known spaces, and every channel must come through as the bytes on disk.
    /// </remarks>
    private static SKBitmap DecodeRgba(string path, SKSizeI? size)
    {
        using var decoded = SKBitmap.Decode(path)
            ?? throw new InvalidOperationException($"Could not decode {path}.");
        var (width, height) = size is { } s ? (s.Width, s.Height) : (decoded.Width, decoded.Height);
        var bitmap = new SKBitmap(new SKImageInfo(width, height, SKColorType.Rgba8888, SKAlphaType.Unpremul));
        if (!decoded.ScalePixels(bitmap, new SKSamplingOptions(SKFilterMode.Linear, SKMipmapMode.None)))
        {
            bitmap.Dispose();
            throw new InvalidOperationException($"Could not resample {path} to {width}x{height}.");
        }
        return bitmap;
    }

    private static async Task RunAgentGlbScript(string specPath, string glbPath)
    {
        if (!NodeAvailable.Value)
            throw new InvalidOperationException(
                "node not found. Agent models are finished with scripts/item-generator-agent-glb.ts " +
                "(gltf-transform + sharp). Install Node.js 20+ and run `npm install`.");

        var script = Path.Combine(Config.ScriptsDir, "item-generator-agent-glb.ts");
        using var p = Process.Start(new ProcessStartInfo("node")
        {
            ArgumentList = { "--import", "tsx", script, specPath },
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false
        });
        var err = await p!.StandardError.ReadToEndAsync();
        await p.WaitForExitAsync();
        if (p.ExitCode != 0)
            throw new InvalidOperationException(
                $"item-generator-agent-glb.ts failed for {glbPath} (exit {p.ExitCode}): {err}");
    }

    // ---------------------------------------------------------------------------------------------
    // PATCH SLOTS
    // ---------------------------------------------------------------------------------------------

    /// <summary>
    /// Resolves each agent's three patch slots and writes them into its model-data JSON.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Runs after WriteMaterialMetadata and before FinalizeModels, which is the only window where
    /// both halves of the answer exist: the model's key-values name the slots
    /// (`patch_camera_preset_list`) and order the hosting materials (`composite_material_order`),
    /// while the placement lives in the materials' shader parameters, and materials are parsed after
    /// models. The model-data JSON has been written by then but not yet hashed, so amending it here
    /// still lands inside the content hash.
    /// </para>
    /// <para>
    /// THE RULE. Global slots 0..2 are named by `patch_camera_preset_list`. Each hosting material
    /// carries parameters for the slots it owns, numbered LOCALLY from 0. Materials are consumed in
    /// `composite_material_order`, each taking as many global slots as it has live local slots; any
    /// remaining csgo_character.vfx material with F_PATCHES follows, and consumption STOPS at three.
    /// </para>
    /// <para>
    /// Stopping matters in both directions, and the two agents that prove it pull opposite ways:
    /// ctm_diver_variantc lists two materials that fill all three slots while a third host
    /// (ctm_diver_wetsuit) carries two more sets of stale parameters that must not be read, and
    /// tm_jungle_raider_variantc lists one material with only two live slots, so its unlisted
    /// `_lower` has to be consumed to reach three. Verified against all 63 catalogued agents: every
    /// one resolves to exactly three, and ten of them need an unlisted host to get there.
    /// </para>
    /// <para>
    /// The rule is inferred from the shipped data rather than confirmed against the running game,
    /// which is why the total is asserted: if a model ever stops resolving to three, the build fails
    /// instead of publishing a placement that is quietly wrong. See docs/patches.md.
    /// </para>
    /// </remarks>
    private static void ResolveAgentPatchSlots(ItemGeneratorContext ctx)
    {
        var agents = ctx.ModelsToProcess.Where(kv => kv.Value.Agent != null).ToList();
        if (agents.Count == 0) return;
        Log($"Resolving patch slots for {FormatCount(agents.Count, "agent")}...");

        foreach (var (vpkPath, model) in agents)
        {
            var modelDataPath = Path.Combine(Config.OutputDir, model.ModelData.TrimStart('/'));
            if (!File.Exists(modelDataPath)) continue;

            var modelDir = Path.Combine(Config.DecompiledDir, Path.GetDirectoryName(vpkPath)!);
            var baseName = Path.GetFileNameWithoutExtension(vpkPath).Replace(".vmdl", "");
            var glbPath = Path.Combine(modelDir, $"{baseName}.glb");
            if (!File.Exists(glbPath)) continue;

            using var document = JsonDocument.Parse(File.ReadAllText(modelDataPath));
            if (ConvertJsonElement(document.RootElement) is not Dictionary<string, object?> data) continue;

            var slots = BuildPatchSlots(data, ReadGlbMaterials(glbPath), model.Base);
            if (slots == null) continue;
            data["patchSlots"] = slots;
            File.WriteAllText(modelDataPath, JsonSerializer.Serialize(data));
        }
    }

    private static List<object?>? BuildPatchSlots(
        Dictionary<string, object?> modelData, List<GlbMaterial> materials, string modelName)
    {
        var hosts = materials
            .Where(m => string.Equals(m.ShaderName, CharacterTextureOptimization.CharacterShader,
                StringComparison.OrdinalIgnoreCase))
            .Where(m => m.IntParams.TryGetValue("F_PATCHES", out var enabled) && enabled != 0)
            .ToList();
        if (hosts.Count == 0) return null;

        var keyValues = ModelKeyValues(modelData);
        var order = OrderedStrings(keyValues, "composite_material_order");
        var presets = OrderedStrings(keyValues, "patch_camera_preset_list");

        // `composite_material_order` names its materials by resource path; everything it does not
        // name follows in the order the .glb lists it.
        var ordered = new List<GlbMaterial>();
        foreach (var path in order)
        {
            var host = hosts.FirstOrDefault(m =>
                string.Equals(MaterialPaths.NormalizeMaterialResourcePath(m.Path),
                    MaterialPaths.NormalizeMaterialResourcePath(path), StringComparison.OrdinalIgnoreCase));
            if (host != null && !ordered.Contains(host)) ordered.Add(host);
        }
        ordered.AddRange(hosts.Where(m => !ordered.Contains(m)));

        var slots = new List<object?>();
        foreach (var material in ordered)
        {
            if (slots.Count >= CharacterPatchSlots) break;
            for (var local = 0; local < CharacterPatchSlots; local++)
            {
                if (slots.Count >= CharacterPatchSlots) break;
                if (!IsLiveSlot(material, local)) continue;
                var index = slots.Count;
                slots.Add(new Dictionary<string, object?>
                {
                    // Absent on nine catalogued agents (the SAS and SWAT variants), which publish no
                    // patch_camera_preset_list at all while still carrying three live slots.
                    ["camera"] = index < presets.Count ? presets[index] : null,
                    ["material"] = material.Path,
                    ["offset"] = Vector2(material.VectorParams.GetValueOrDefault($"g_vPatch{local}Offset")),
                    ["scale"] = material.FloatParams.GetValueOrDefault($"g_flPatch{local}Scale", 0),
                    ["rotation"] = material.FloatParams.GetValueOrDefault($"g_flPatch{local}Rotation", 0),
                    ["squash"] = material.FloatParams.GetValueOrDefault($"g_flPatch{local}Squash", 1),
                    ["backingScale"] = material.FloatParams.GetValueOrDefault($"g_flPatch{local}BackingScale", 0),
                    ["backing"] = material.TextureParams.GetValueOrDefault($"g_tPatch{local}Backing"),
                    // Shipped enabled means a permanent decorative badge the material was authored
                    // with (ctm_swat_generic_upperbody ships two), not an empty slot.
                    ["enabled"] = material.IntParams.GetValueOrDefault($"g_bEnablePatch{local}", 0) != 0
                });
            }
        }

        if (slots.Count != CharacterPatchSlots)
            throw new InvalidOperationException(
                $"Agent '{modelName}' resolved {slots.Count} patch slots across " +
                $"{ordered.Count} hosting material(s); every patchable agent has exactly " +
                $"{CharacterPatchSlots}. The slot-liveness rule or the game data has changed — see docs/patches.md.");

        return slots;
    }

    private const int CharacterPatchSlots = 3;

    /// <summary>
    /// Whether a material actually hosts its local slot N.
    /// </summary>
    /// <remarks>
    /// A non-hosting material still carries patch parameters — `medic_pant` and `leader_pant` ship
    /// byte-identical ones on four Gendarmerie agents that never use them — so liveness is read off
    /// the values. A live slot has a non-zero scale, or, on the materials that ship no scale
    /// parameters at all (the Jungle Raider set authors offsets only), a non-zero offset.
    /// </remarks>
    private static bool IsLiveSlot(GlbMaterial material, int local)
    {
        if (material.FloatParams.TryGetValue($"g_flPatch{local}Scale", out var scale))
            return scale != 0;
        var offset = material.VectorParams.GetValueOrDefault($"g_vPatch{local}Offset");
        return offset != null && (offset[0] != 0 || offset.Length > 1 && offset[1] != 0);
    }

    private static Dictionary<string, object?> ModelKeyValues(Dictionary<string, object?> modelData) =>
        modelData.GetValueOrDefault("m_modelInfo") is Dictionary<string, object?> modelInfo &&
        modelInfo.GetValueOrDefault("m_keyValueText") is Dictionary<string, object?> keyValues
            ? keyValues
            : [];

    /// Reads a `{ key_0 = "a", key_1 = "b", ... }` KV block as an ordered list, dropping empties.
    private static List<string> OrderedStrings(Dictionary<string, object?> keyValues, string key)
    {
        if (keyValues.GetValueOrDefault(key) is not Dictionary<string, object?> block) return [];
        return [.. block
            .OrderBy(entry => entry.Key, StringComparer.Ordinal)
            .Select(entry => entry.Value?.ToString() ?? "")
            .Where(value => value.Length > 0)];
    }

    private static List<object?>? Vector2(double[]? value) =>
        value == null ? null : [value.ElementAtOrDefault(0), value.ElementAtOrDefault(1)];

    // ---------------------------------------------------------------------------------------------
    // GLB READING
    //
    // The .glb JSON chunk is parsed directly rather than through SharpGLTF: an agent's export still
    // has its full-size satellite PNGs beside it at this point, and ModelRoot.Load would pull every
    // one of them into memory to answer a question about names and shader parameters.
    // ---------------------------------------------------------------------------------------------

    private static JsonDocument ReadGlbJson(string glbPath)
    {
        var bytes = File.ReadAllBytes(glbPath);
        var jsonLength = (int)BitConverter.ToUInt32(bytes, 12);
        return JsonDocument.Parse(System.Text.Encoding.UTF8.GetString(bytes, 20, jsonLength));
    }

    /// Each image's name paired with the satellite file VRF wrote for it; embedded images are skipped.
    private static List<(string Name, string Uri)> ReadGlbImages(string glbPath)
    {
        using var doc = ReadGlbJson(glbPath);
        if (!doc.RootElement.TryGetProperty("images", out var images)) return [];
        var result = new List<(string, string)>();
        foreach (var image in images.EnumerateArray())
        {
            var name = image.TryGetProperty("name", out var n) ? n.GetString() : null;
            var uri = image.TryGetProperty("uri", out var u) ? u.GetString() : null;
            if (string.IsNullOrEmpty(name) || string.IsNullOrEmpty(uri) ||
                uri.StartsWith("data:", StringComparison.Ordinal)) continue;
            result.Add((name, uri));
        }
        return result;
    }

    private static List<GlbMaterial> ReadGlbMaterials(string glbPath)
    {
        using var doc = ReadGlbJson(glbPath);
        var materials = new List<GlbMaterial>();
        if (!doc.RootElement.TryGetProperty("materials", out var array)) return materials;
        var imageNames = ReadTextureImageNames(doc.RootElement);

        foreach (var material in array.EnumerateArray())
        {
            if (!material.TryGetProperty("extras", out var extras) ||
                !extras.TryGetProperty("vmat", out var vmat)) continue;

            var path = vmat.TryGetProperty("Name", out var name) ? name.GetString() ?? "" : "";
            var shader = vmat.TryGetProperty("ShaderName", out var s) ? s.GetString() ?? "" : "";
            materials.Add(new GlbMaterial(
                path.Replace('\\', '/'),
                shader,
                ReadStringMap(vmat, "TextureParams"),
                ReadDoubleMap(vmat, "FloatParams"),
                ReadVectorMap(vmat, "VectorParams"),
                ReadLongMap(vmat, "IntParams"),
                ReadGltfSlots(material, imageNames)));
        }
        return materials;
    }

    /// glTF texture index -> the name of the image it samples.
    private static List<string?> ReadTextureImageNames(JsonElement root)
    {
        if (!root.TryGetProperty("textures", out var textures)) return [];
        var images = root.TryGetProperty("images", out var i) ? [.. i.EnumerateArray()] : new List<JsonElement>();
        return [.. textures.EnumerateArray().Select(texture =>
            texture.TryGetProperty("source", out var source) && source.GetInt32() < images.Count &&
            images[source.GetInt32()].TryGetProperty("name", out var name)
                ? name.GetString()
                : null)];
    }

    /// <summary>
    /// The PBR slots that carry the ORM pack. Only these: the base-colour and normal slots mirror a
    /// vmat binding already read from `extras.vmat`, and reading them as bindings of their own would
    /// make every colour and normal map look doubly bound under agree-or-drop.
    /// </summary>
    private static Dictionary<string, string> ReadGltfSlots(JsonElement material, List<string?> imageNames)
    {
        var slots = new Dictionary<string, string>(StringComparer.Ordinal);
        void Read(JsonElement owner, string slot)
        {
            if (owner.TryGetProperty(slot, out var info) && info.TryGetProperty("index", out var index) &&
                index.GetInt32() < imageNames.Count && imageNames[index.GetInt32()] is { Length: > 0 } image)
                slots[slot] = image;
        }
        Read(material, "occlusionTexture");
        if (material.TryGetProperty("pbrMetallicRoughness", out var pbr))
            Read(pbr, "metallicRoughnessTexture");
        return slots;
    }

    /// Every texture the .glb's materials bind in `extras.vmat`: `.vtex` stem -> resource path.
    private static Dictionary<string, string> ReadTextureResources(string glbPath)
    {
        using var doc = ReadGlbJson(glbPath);
        var resources = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (!doc.RootElement.TryGetProperty("materials", out var array)) return resources;
        foreach (var material in array.EnumerateArray())
        {
            if (!material.TryGetProperty("extras", out var extras) ||
                !extras.TryGetProperty("vmat", out var vmat) ||
                !vmat.TryGetProperty("TextureParams", out var textures)) continue;
            foreach (var property in textures.EnumerateObject())
                if (property.Value.ValueKind == JsonValueKind.String)
                {
                    var resource = property.Value.GetString()!.Replace('\\', '/');
                    resources[Path.GetFileName(resource)] = resource;
                }
        }
        return resources;
    }

    private static Dictionary<string, string> ReadStringMap(JsonElement vmat, string key)
    {
        var map = new Dictionary<string, string>(StringComparer.Ordinal);
        if (!vmat.TryGetProperty(key, out var element)) return map;
        foreach (var property in element.EnumerateObject())
            if (property.Value.ValueKind == JsonValueKind.String)
                // Values are ".vtex" resource references; the .glb names its images by the same stem.
                map[property.Name] = Path.GetFileName(property.Value.GetString()!.Replace('\\', '/'));
        return map;
    }

    private static Dictionary<string, double> ReadDoubleMap(JsonElement vmat, string key)
    {
        var map = new Dictionary<string, double>(StringComparer.Ordinal);
        if (!vmat.TryGetProperty(key, out var element)) return map;
        foreach (var property in element.EnumerateObject())
            if (property.Value.TryGetDouble(out var value)) map[property.Name] = value;
        return map;
    }

    private static Dictionary<string, long> ReadLongMap(JsonElement vmat, string key)
    {
        var map = new Dictionary<string, long>(StringComparer.Ordinal);
        if (!vmat.TryGetProperty(key, out var element)) return map;
        foreach (var property in element.EnumerateObject())
            if (property.Value.TryGetInt64(out var value)) map[property.Name] = value;
        return map;
    }

    private static Dictionary<string, double[]> ReadVectorMap(JsonElement vmat, string key)
    {
        var map = new Dictionary<string, double[]>(StringComparer.Ordinal);
        if (!vmat.TryGetProperty(key, out var element)) return map;
        foreach (var property in element.EnumerateObject())
            if (property.Value.ValueKind == JsonValueKind.Array)
                map[property.Name] = [.. property.Value.EnumerateArray()
                    .Select(v => v.TryGetDouble(out var value) ? value : 0)];
        return map;
    }
}
