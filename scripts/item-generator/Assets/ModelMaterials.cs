/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

using System.Text.Json;

namespace ItemGenerator;

// A published model's mesh materials: each mesh's leaf name -> the names of the materials its
// primitives draw with, both in the .glb's own order, a material listed once per mesh. VRF names a
// glTF mesh "<model resource path>.<leaf>", and the leaf is what a consumer finds the mesh by
// (`body_hd`, `body_legacy`, `viewmodel`). A material's name is its published filename stem
// (PatchGlbAssets), except an agent's, which keeps VRF's. They are read back from the finished
// .glb, after item-generator-glb.ts has dropped the meshes a model does not keep, and emitted as
// src/model-materials.ts so a consumer knows a model's materials without loading it.
public static partial class AssetProcessor
{
    // Parses a .glb's JSON chunk alone, leaving its binary chunk and any satellite files unread.
    private static JsonDocument ReadGlbJson(string glbPath)
    {
        var bytes = File.ReadAllBytes(glbPath);
        var jsonLength = (int)BitConverter.ToUInt32(bytes, 12);
        return JsonDocument.Parse(System.Text.Encoding.UTF8.GetString(bytes, 20, jsonLength));
    }

    // Throws on a mesh a consumer could not find by leaf name or a primitive with no named material,
    // so a model breaking that contract stops the run before it is uploaded.
    private static OrderedDictionary<string, List<string>> ReadModelMaterials(string glbPath)
    {
        using var doc = ReadGlbJson(glbPath);
        var root = doc.RootElement;

        var materialNames = new List<string?>();
        if (root.TryGetProperty("materials", out var materials))
        {
            foreach (var material in materials.EnumerateArray())
                materialNames.Add(
                    material.TryGetProperty("name", out var name) ? name.GetString() : null
                );
        }

        var meshes = new OrderedDictionary<string, List<string>>();
        if (!root.TryGetProperty("meshes", out var meshArray))
            return meshes;
        foreach (var mesh in meshArray.EnumerateArray())
        {
            var meshName = mesh.TryGetProperty("name", out var name) ? name.GetString() ?? "" : "";
            var leaf = meshName[(meshName.LastIndexOf('.') + 1)..];
            if (leaf.Length == 0)
                throw new InvalidOperationException($"Model '{glbPath}' has an unnamed mesh.");
            var names = new List<string>();
            if (!meshes.TryAdd(leaf, names))
                throw new InvalidOperationException(
                    $"Model '{glbPath}' has two meshes named '{leaf}'."
                );
            foreach (var primitive in mesh.GetProperty("primitives").EnumerateArray())
            {
                var materialName = primitive.TryGetProperty("material", out var index)
                    ? materialNames.ElementAtOrDefault(index.GetInt32())
                    : null;
                if (string.IsNullOrEmpty(materialName))
                    throw new InvalidOperationException(
                        $"Model '{glbPath}' mesh '{leaf}' has a primitive with no named material."
                    );
                if (!names.Contains(materialName))
                    names.Add(materialName);
            }
        }
        return meshes;
    }
}
