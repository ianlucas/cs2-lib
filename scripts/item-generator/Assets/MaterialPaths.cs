using System.Text.RegularExpressions;

namespace ItemGenerator;

public static class MaterialPaths
{
    public static string NormalizeMaterialResourcePath(string path)
    {
        path = path.Replace('\\', '/');
        path = Regex.Replace(path, @"^resource(?:_name)?:", "");
        path = Regex.Replace(path, @"/+", "/");
        return path;
    }

    public static string GetPaintCompositeMaterialPath(string className, string? compositeMaterialPath)
    {
        return compositeMaterialPath ?? $"weapons/paints/legacy/{className}.vcompmat";
    }

    public static string GetStickerMaterialPath(string stickerMaterial)
    {
        return $"stickers/{stickerMaterial}.vmat";
    }

    public static string ToCompiledMaterialResourcePath(string path)
    {
        var normalized = NormalizeMaterialResourcePath(path).ToLowerInvariant();
        if (normalized.EndsWith("_c")) return normalized;
        if (normalized.EndsWith(".vcompmat") || normalized.EndsWith(".vmat") || normalized.EndsWith(".vtex"))
            return $"{normalized}_c";
        return normalized;
    }

    private static string ToSourceMaterialResourcePath(string path)
    {
        return path.EndsWith("_c") ? path[..^2] : path;
    }

    public static string ResolveMaterialResourcePath(ItemGeneratorContext ctx, string path)
    {
        var compiledPath = ToCompiledMaterialResourcePath(path);
        if (ctx.VpkIndex.ContainsKey(compiledPath))
            return ToSourceMaterialResourcePath(compiledPath);

        var name = Path.GetFileName(compiledPath);
        var matches = ctx.VpkIndex.Keys
            .Where(candidate => Path.GetFileName(candidate) == name)
            .ToList();

        if (matches.Count == 1)
            return ToSourceMaterialResourcePath(matches[0]);
        if (matches.Count > 1)
            throw new InvalidOperationException($"Ambiguous VPK entry for '{compiledPath}': {string.Join(", ", matches)}");

        throw new FileNotFoundException($"VPK entry not found: {compiledPath}");
    }

    public static string GetCompositeMaterialFilename(string vcompmatPath, string crc)
    {
        var baseName = Path.GetFileNameWithoutExtension(NormalizeMaterialResourcePath(vcompmatPath));
        if (baseName.EndsWith(".vcompmat")) baseName = baseName[..^9];
        return $"{baseName}_{crc}.vcompmat.json";
    }

    public static string GetVmatFilename(string vmatPath, string crc)
    {
        var baseName = Path.GetFileNameWithoutExtension(NormalizeMaterialResourcePath(vmatPath));
        if (baseName.EndsWith(".vmat")) baseName = baseName[..^5];
        return $"{baseName}_{crc}.vmat.json";
    }

    public static string GetTextureFilename(string vtexPath, string crc, string extension)
    {
        var baseName = Path.GetFileNameWithoutExtension(NormalizeMaterialResourcePath(vtexPath));
        if (baseName.EndsWith(".vtex")) baseName = baseName[..^5];
        return $"{baseName}_{crc}{extension}";
    }

    public static string GetIndexedCompositeMaterialFilename(ItemGeneratorContext ctx, string vcompmatPath)
    {
        var resolvedPath = ResolveMaterialResourcePath(ctx, vcompmatPath);
        var vpkPath = ToCompiledMaterialResourcePath(resolvedPath);
        if (!ctx.VpkIndex.TryGetValue(vpkPath, out var entry))
            throw new FileNotFoundException($"VPK entry not found: {vpkPath}");
        return GetCompositeMaterialFilename(resolvedPath, entry.Crc);
    }

    public static string GetIndexedVmatFilename(ItemGeneratorContext ctx, string vmatPath)
    {
        var resolvedPath = ResolveMaterialResourcePath(ctx, vmatPath);
        var vpkPath = ToCompiledMaterialResourcePath(resolvedPath);
        if (!ctx.VpkIndex.TryGetValue(vpkPath, out var entry))
            throw new FileNotFoundException($"VPK entry not found: {vpkPath}");
        return GetVmatFilename(resolvedPath, entry.Crc);
    }

    public static object? PatchMaterialResourceReferences(
        object? value,
        Func<string, string?> resolveCompositeMaterial,
        Func<string, string?> resolveVmat,
        Func<string, string?> resolveTexture)
    {
        if (value is string str)
        {
            var normalized = NormalizeMaterialResourcePath(str);
            if (normalized.EndsWith(".vcompmat"))
                return resolveCompositeMaterial(normalized)
                    ?? throw new InvalidOperationException($"Unable to rewrite composite material reference: {str}");
            if (normalized.EndsWith(".vmat"))
                return resolveVmat(normalized)
                    ?? throw new InvalidOperationException($"Unable to rewrite material reference: {str}");
            if (normalized.EndsWith(".vtex"))
                return resolveTexture(normalized)
                    ?? throw new InvalidOperationException($"Unable to rewrite texture reference: {str}");
            return str;
        }

        if (value is List<object?> list)
            return list.Select(entry => PatchMaterialResourceReferences(entry, resolveCompositeMaterial, resolveVmat, resolveTexture)).ToList();

        if (value is Dictionary<string, object?> dict)
            return dict.ToDictionary(kv => kv.Key,
                kv => PatchMaterialResourceReferences(kv.Value, resolveCompositeMaterial, resolveVmat, resolveTexture));

        return value;
    }
}
