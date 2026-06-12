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
                var dataText = JsonSerializer.Serialize(parsedData);
                CollectResourceRefs(dataText, ".vmat", vmatRefs);
                CollectResourceRefs(dataText, ".vtex", vtexRefs);
            }

            results.Add(new MaterialMetadataResult(parsedData, resolvedPath, vmatRefs, vtexRefs));
        }

        return results;
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
