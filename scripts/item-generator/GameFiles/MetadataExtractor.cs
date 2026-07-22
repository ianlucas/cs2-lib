using System.Text.Json;
using System.Text.RegularExpressions;
using ValveKeyValue;
using ValveResourceFormat;
using ValveResourceFormat.ResourceTypes;

namespace ItemGenerator.GameFiles;

public record ModelMetadataResult(object? Data, string Filename, List<string> Materials);
public record CompositeMaterialMetadataResult(
    List<string> CompositeMaterialRefs, object? Data,
    string VcompmatPath, List<string> VmatRefs, List<string> VtexRefs);
public record MaterialMetadataResult(
    object? Data, string VmatPath,
    List<string> VmatRefs, List<string> VtexRefs);

public static partial class MetadataExtractor
{
    [GeneratedRegex("\"([^\"]+\\.(?:vcompmat|vmat|vtex))\"")]
    private static partial Regex ResourceRefRegex();

    public static List<ModelMetadataResult> ExtractModelMetadata(
        ItemGeneratorContext ctx, List<(string VpkPath, string TargetFilename)> entries)
    {
        var results = new List<ModelMetadataResult>();
        if (ctx.VpkPackage == null) return results;

        foreach (var (vpkPath, targetFilename) in entries)
        {
            var entry = ctx.VpkPackage.FindEntry(vpkPath);
            if (entry == null)
            {
                results.Add(new ModelMetadataResult(null, Path.GetFileName(targetFilename), []));
                continue;
            }

            ctx.VpkPackage.ReadEntry(entry, out var data);
            using var resource = new Resource();
            resource.Read(new MemoryStream(data));

            var materials = new List<string>();
            if (resource.ExternalReferences != null)
            {
                foreach (var extRef in resource.ExternalReferences.ResourceRefInfoList)
                {
                    if (extRef.Name.EndsWith(".vmat", StringComparison.OrdinalIgnoreCase))
                        materials.Add(extRef.Name);
                }
            }

            object? parsedData = null;
            if (resource.DataBlock is Model model)
            {
                parsedData = ConvertKV3ToObject(model.Data);
                if (parsedData is Dictionary<string, object?> topDict &&
                    topDict.TryGetValue("m_modelInfo", out var modelInfoObj) &&
                    modelInfoObj is Dictionary<string, object?> modelInfo &&
                    model.KeyValues.IsCollection)
                {
                    modelInfo["m_keyValueText"] = ConvertKV3ToObject(model.KeyValues);
                }

                // Surface the model's softbody simulation data (the PHYS block's FeModel) so the
                // viewer can run the game's own charm physics: node init pose + inverse masses,
                // quad/rod elements, hinge limits, anti-tunnel probes, volumetric vertex maps, and
                // the node->bone output maps (NodeBases/CtrlOffsets/ReverseOffsets). Emitted only
                // when the model actually simulates (dynamic nodes exist) — weapons carry a trivial
                // all-static FeModel (bone registration) that would be dead weight. The SIMD
                // mirrors, self-collision tree, and morph/wind data are solver-internal
                // acceleration structures fully derivable from the scalar arrays, so they are
                // dropped to keep the model-data JSON small.
                if (parsedData is Dictionary<string, object?> rootForPhysics &&
                    ExtractFeModel(resource) is { } feModel)
                {
                    rootForPhysics["physics"] = new Dictionary<string, object?> { ["feModel"] = feModel };
                }

                // Surface the applied-module anchors (StatTrak module, name tag, charm) from the
                // weapon's MDAT block so the viewer can parent those models at the game-correct
                // transform. These live in Model.Attachments, not model.Data, so they're emitted as
                // a top-level sibling of m_modelInfo. Values are raw model space (inches +
                // quaternion), influence[0] verbatim — no axis-swap/scale; the consumer's .glb root
                // node handles the conversion. Kept as float[] (not stringified KV) to match the
                // numeric JSON the viewer reads.
                if (parsedData is Dictionary<string, object?> root)
                {
                    string[] wantedAttachments =
                        ["stattrak", "stattrak_legacy", "nametag", "nametag_legacy", "keychain", "keychain_legacy"];
                    var attachments = new Dictionary<string, object?>();
                    foreach (var key in wantedAttachments)
                    {
                        if (!model.Attachments.TryGetValue(key, out var attachment) || attachment.Length == 0)
                            continue;
                        var influence = attachment[0];
                        attachments[key] = new Dictionary<string, object?>
                        {
                            ["bone"] = influence.Name,
                            ["offset"] = new[] { influence.Offset.X, influence.Offset.Y, influence.Offset.Z },
                            ["rotation"] = new[] { influence.Rotation.X, influence.Rotation.Y, influence.Rotation.Z, influence.Rotation.W },
                        };
                    }
                    if (attachments.Count > 0)
                        root["attachments"] = attachments;
                }
            }

            var filename = Path.GetFileNameWithoutExtension(targetFilename).Replace(".glb", "") + ".json";
            results.Add(new ModelMetadataResult(parsedData, filename, materials));
        }

        return results;
    }

    public static List<CompositeMaterialMetadataResult> ExtractCompositeMaterialMetadata(
        ItemGeneratorContext ctx, IEnumerable<string> vcompmatPaths)
    {
        var results = new List<CompositeMaterialMetadataResult>();
        if (ctx.VpkPackage == null) return results;

        foreach (var path in vcompmatPaths)
        {
            var resolvedPath = MaterialPaths.ResolveMaterialResourcePath(ctx, path);
            var vpkPath = MaterialPaths.ToCompiledMaterialResourcePath(resolvedPath);
            var entry = ctx.VpkPackage.FindEntry(vpkPath);

            if (entry == null)
            {
                results.Add(new CompositeMaterialMetadataResult([], null, resolvedPath, [], []));
                continue;
            }

            ctx.VpkPackage.ReadEntry(entry, out var data);
            using var resource = new Resource();
            resource.Read(new MemoryStream(data));

            object? parsedData = null;
            var compositeMaterialRefs = new List<string>();
            var vmatRefs = new List<string>();
            var vtexRefs = new List<string>();

            var rootKv = GetRootKvObject(resource);
            if (rootKv != null)
            {
                parsedData = ConvertKV3ToObject(rootKv);
                var dataText = JsonSerializer.Serialize(parsedData);
                CollectResourceRefs(dataText, ".vcompmat", compositeMaterialRefs);
                CollectResourceRefs(dataText, ".vmat", vmatRefs);
                CollectResourceRefs(dataText, ".vtex", vtexRefs);
            }

            results.Add(new CompositeMaterialMetadataResult(
                compositeMaterialRefs, parsedData, resolvedPath, vmatRefs, vtexRefs));
        }

        return results;
    }

    public static List<MaterialMetadataResult> ExtractMaterialMetadata(
        ItemGeneratorContext ctx, IEnumerable<string> vmatPaths)
    {
        var results = new List<MaterialMetadataResult>();
        if (ctx.VpkPackage == null) return results;

        foreach (var path in vmatPaths)
        {
            var resolvedPath = MaterialPaths.ResolveMaterialResourcePath(ctx, path);
            var vpkPath = MaterialPaths.ToCompiledMaterialResourcePath(resolvedPath);
            var entry = ctx.VpkPackage.FindEntry(vpkPath);
            if (entry == null) continue;

            ctx.VpkPackage.ReadEntry(entry, out var data);
            using var resource = new Resource();
            resource.Read(new MemoryStream(data));

            object? parsedData = null;
            var vmatRefs = new List<string>();
            var vtexRefs = new List<string>();

            if (resource.ExternalReferences != null)
            {
                foreach (var extRef in resource.ExternalReferences.ResourceRefInfoList)
                {
                    if (extRef.Name.EndsWith(".vtex", StringComparison.OrdinalIgnoreCase))
                        vtexRefs.Add(extRef.Name);
                }
            }

            var rootKv = GetRootKvObject(resource);
            if (rootKv != null)
            {
                parsedData = ConvertKV3ToObject(rootKv);
                if (resource.DataBlock is Material material)
                    ReplaceDynamicParamBytecode(parsedData, material);
                var dataText = JsonSerializer.Serialize(parsedData);
                CollectResourceRefs(dataText, ".vmat", vmatRefs);
                CollectResourceRefs(dataText, ".vtex", vtexRefs);
            }

            results.Add(new MaterialMetadataResult(parsedData, resolvedPath, vmatRefs, vtexRefs));
        }

        return results;
    }

    // m_dynamicParams/m_dynamicTextureParams store compiled expression bytecode, which the KV3
    // conversion stringifies into garbage. VRF already decompiles it (VfxEval) into
    // Material.DynamicExpressions, so rewrite each entry's m_value to the expression text (e.g.
    // "return lerp(45,-140,$KeychainSeed);" — how keychain seeds drive the charm material) for
    // consumers to evaluate. Params VRF couldn't decode fall back to null rather than garbage.
    private static void ReplaceDynamicParamBytecode(object? parsedData, Material material)
    {
        if (parsedData is not Dictionary<string, object?> root) return;
        foreach (var key in new[] { "m_dynamicParams", "m_dynamicTextureParams" })
        {
            if (!root.TryGetValue(key, out var listObj) || listObj is not List<object?> list) continue;
            foreach (var entryObj in list)
            {
                if (entryObj is not Dictionary<string, object?> entry ||
                    entry.GetValueOrDefault("m_name") is not string name) continue;
                entry["m_value"] = material.DynamicExpressions.TryGetValue(name, out var expression)
                    ? expression : null;
            }
        }
    }

    // FeModel keys not emitted: SIMD-packed mirrors of the scalar arrays, the self-collision
    // node tree, and wind/morph/source-element data — all internal acceleration structures a
    // reimplementation rebuilds (or doesn't need) from the scalar data that IS emitted.
    private static readonly string[] FeModelDropPrefixes = ["m_Simd", "m_Tree"];
    private static readonly HashSet<string> FeModelDropKeys =
    [
        "m_CtrlHash", "m_DynNodeWindBases", "m_SourceElems",
        "m_MorphLayers", "m_MorphSetData",
    ];

    // The model's FeModel (softbody) as a trimmed JSON-ready dictionary, or null when the model
    // has no PHYS block, no FeModel, or only static nodes (nothing simulates).
    private static Dictionary<string, object?>? ExtractFeModel(Resource resource)
    {
        if (resource.GetBlockByType(BlockType.PHYS) is not PhysAggregateData phys) return null;
        if (ConvertKV3ToObject(phys.Data) is not Dictionary<string, object?> physData ||
            physData.GetValueOrDefault("m_pFeModel") is not Dictionary<string, object?> feModel)
            return null;
        if (!int.TryParse(feModel.GetValueOrDefault("m_nNodeCount")?.ToString(), out var nodeCount) ||
            !int.TryParse(feModel.GetValueOrDefault("m_nStaticNodes")?.ToString(), out var staticNodes) ||
            nodeCount <= staticNodes)
            return null;
        foreach (var key in feModel.Keys.ToList())
        {
            if (FeModelDropKeys.Contains(key) || FeModelDropPrefixes.Any(key.StartsWith))
                feModel.Remove(key);
        }
        return feModel;
    }

    private static KVObject? GetRootKvObject(Resource resource) => resource.DataBlock switch
    {
        KeyValuesOrNTRO kv => kv.Data,
        BinaryKV3 binkv => binkv.Data.Root,
        _ => null,
    };

    private static void CollectResourceRefs(string dataText, string extension, List<string> refs)
    {
        foreach (Match match in ResourceRefRegex().Matches(dataText))
        {
            var path = MaterialPaths.NormalizeMaterialResourcePath(match.Groups[1].Value);
            if (path.EndsWith(extension, StringComparison.OrdinalIgnoreCase))
                refs.Add(path);
        }
    }

    public static object? ConvertKV3ToObject(KVObject? kvObject)
    {
        if (kvObject == null) return null;

        if (kvObject.IsArray)
        {
            var list = new List<object?>();
            foreach (var child in kvObject)
                list.Add(ConvertKVObjectToValue(child.Value));
            return list;
        }

        if (kvObject.IsCollection)
        {
            var dict = new Dictionary<string, object?>();
            foreach (var child in kvObject)
                dict[child.Key] = ConvertKVObjectToValue(child.Value);
            return dict;
        }

        return kvObject.ToString();
    }

    private static object? ConvertKVObjectToValue(KVObject? value)
    {
        if (value == null) return null;
        if (value.IsCollection || value.IsArray)
            return ConvertKV3ToObject(value);
        return value.ToString();
    }
}
