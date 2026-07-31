/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using ValveKeyValue;
using ValveResourceFormat;
using ValveResourceFormat.ResourceTypes;
using static ItemGenerator.Logging;

namespace ItemGenerator.GameFiles;

public record ModelMetadataResult(
    object? Data, object? ClothCollider, string Filename, List<string> Materials);
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

    // The quantisation window for a cloth collider's distances, in inches — see
    // ExtractClothCollider for why one exists and why it is this narrow. Below the floor is solid
    // and only the sign is left; nothing can be in contact from past the ceiling.
    private const double ClothColliderFloor = -1;
    private const double ClothColliderCeiling = 2.5;

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
                results.Add(new ModelMetadataResult(
                    null, null, Path.GetFileName(targetFilename), []));
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
                // when the model actually SIMULATES (dynamic nodes exist), which a weapon's
                // FeModel does not — every node of it is static. That does not make a weapon's
                // FeModel empty, only silent: it still carries the colliders cloth is pushed out
                // of, and those leave by their own door (ExtractClothCollider). The SIMD mirrors,
                // the self-collision tree's shape, and morph/wind data are solver-internal
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
            results.Add(new ModelMetadataResult(
                parsedData, ExtractClothCollider(resource), filename, materials));
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

    // FeModel keys not emitted: SIMD-packed mirrors of the scalar arrays, the SHAPE of the
    // self-collision tree, and wind/morph/source-element data — all internal acceleration
    // structures a reimplementation rebuilds (or doesn't need) from the scalar data that IS
    // emitted.
    //
    // m_TreeCollisionMasks is the exception and is KEPT, because it is not an acceleration
    // structure: the tree's leaves are the authored per-node collision mask. They are its first
    // (m_nNodeCount - m_nStaticNodes) entries, in dynamic-node order, indexed the same way
    // m_NodeCollisionRadii is; the entries after them are the unions of their children that the
    // traversal needs. A node touches a collider when (nodeMask & colliderMask) is non-zero.
    //
    // What says that indexing is real rather than a coincidence: over all 62 keychain models in the
    // game, not one node carries a non-zero mask without a collision sphere to go with it. The
    // converse does NOT hold, and that is the whole reason this array has to be published — a
    // sphere may be authored with mask 0 to take it out of contact, and 44 of the 62 do exactly
    // that for one sphere each. The 8 Ball is the case that shows what it costs to miss: its fifth
    // sphere ($cloth_node_body8, radius 0.28) sits a third of an inch BEHIND the charm on the side
    // facing the weapon, with mask 0. Collide it and the charm hangs that far off the gun instead
    // of resting on it. (A model may also author no radii at all, in which case every leaf is 0 and
    // the two arrays do not line up in length; kc_db_lighter_inspect is the one that does.)
    private static readonly string[] FeModelDropPrefixes = ["m_Simd"];
    private static readonly HashSet<string> FeModelDropKeys =
    [
        "m_CtrlHash", "m_DynNodeWindBases", "m_SourceElems",
        "m_MorphLayers", "m_MorphSetData",
        "m_TreeParents", "m_TreeChildren",
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

    // The model's CLOTH COLLIDER: the shapes a keychain is pushed out of, read off the same
    // m_pFeModel as the softbody above and emitted as a sibling file.
    //
    // WHY IT NEEDS ITS OWN PATH OUT. A weapon's FeModel simulates nothing — every node static, no
    // quads, no rods — so ExtractFeModel drops it, and yet it is the only place the weapon's cloth
    // collision lives: m_SDFRigids (a signed distance field on a regular grid), m_BoxRigids and
    // m_TaperedCapsuleRigids, each bound to a weapon bone. 36 weapon models author a field and 38
    // author a collider of some kind; the AK-47 has two grids, 128x16x40 on `weapon_offset` for the
    // body and 32x16x32 on `clip` for the magazine, plus a box. m_parts[].m_hulls is not a
    // substitute for any of it: that single convex hull is what the weapon is when it lies on the
    // ground, and on the AK-47 it swallows 92% of the region a charm may be placed in, the default
    // mount included, so pushing a charm out of it lifts the charm clear off the gun. The field
    // follows the silhouette instead — dust cover, magazine well, the gap between them — which is
    // what lets a charm rest ON the receiver.
    //
    // WHY A SIBLING FILE. The distances are bulk: the AK's two grids are 98,304 samples and the
    // M249's is 262,144, against 42 KB for the whole of the AK's model data. Only a consumer
    // showing a keychain needs them, while the model data is fetched for every weapon.
    //
    // WHY THE DISTANCES ARE QUANTISED, which is the one thing here that is not the file's own
    // numbers. A byte across [ClothColliderFloor, ClothColliderCeiling] inches, with the window
    // written into the file so it is self-describing. It is not a shortcut around a precise field.
    // The step it introduces is 0.0137in, an order of magnitude under the finest grid the game
    // ships (cells run 0.145in on the P2000 to 0.771in on the MP5-SD), and contact is only ever
    // decided within the largest collision radius any keychain authors — 0.65in — of the surface.
    // What the window costs is at the two ends, and nothing needs either: over every grid in the
    // game 0.1% of samples fall below the floor (deep inside metal, where only the sign is left)
    // and the 53% above the ceiling are further from the weapon than anything can reach.
    //
    // GRID CONVENTION, which a consumer cannot recover from a flat array and has to be told:
    // samples sit at cell CORNERS, p(i,j,k) = min + (i,j,k) * cell, in the bone's own local frame,
    // and memory order is X FASTEST — index = x + width * (y + height * z). The cell is one number
    // rather than three: (vLocalMax - vLocalMin) / n agrees on all three axes to 6e-8 over every
    // grid the game ships, and a grid where it does not is skipped rather than guessed at.
    private static Dictionary<string, object?>? ExtractClothCollider(Resource resource)
    {
        if (resource.GetBlockByType(BlockType.PHYS) is not PhysAggregateData phys) return null;
        if (ConvertKV3ToObject(phys.Data) is not Dictionary<string, object?> physData ||
            physData.GetValueOrDefault("m_pFeModel") is not Dictionary<string, object?> feModel)
            return null;

        // The FeModel's own control names are the weapon BONES its colliders are bound to, and
        // nNode indexes them. Resolving it here means the collider file names its bones outright
        // and a consumer never needs m_CtrlName.
        var bones = (feModel.GetValueOrDefault("m_CtrlName") as List<object?>)?
            .Select(name => name?.ToString() ?? "").ToList() ?? [];
        string BoneOf(Dictionary<string, object?> rigid)
        {
            var node = ParseInt(rigid.GetValueOrDefault("nNode"));
            return node >= 0 && node < bones.Count ? bones[node] : "";
        }

        // A shape that cannot be read is dropped rather than guessed at, and says so: silently it
        // would surface as a keychain passing through the weapon, which reads as a physics bug
        // instead of a missing branch here.
        var sdfs = new List<object?>();
        foreach (var entryObj in feModel.GetValueOrDefault("m_SDFRigids") as List<object?> ?? [])
        {
            if (entryObj is not Dictionary<string, object?> sdf) continue;
            var min = ParseVector(sdf.GetValueOrDefault("vLocalMin"), 3);
            var max = ParseVector(sdf.GetValueOrDefault("vLocalMax"), 3);
            var width = ParseInt(sdf.GetValueOrDefault("m_nWidth"));
            var height = ParseInt(sdf.GetValueOrDefault("m_nHeight"));
            var depth = ParseInt(sdf.GetValueOrDefault("m_nDepth"));
            if (min == null || max == null || width <= 0 || height <= 0 || depth <= 0)
            {
                Log($"  Cloth collider grid has no readable box: {width}x{height}x{depth}.");
                continue;
            }
            if (sdf.GetValueOrDefault("m_Distances") is not List<object?> distances ||
                distances.Count != width * height * depth)
            {
                Log($"  Cloth collider grid holds the wrong number of samples for " +
                    $"{width}x{height}x{depth}.");
                continue;
            }

            var cells = new[]
            {
                (max[0] - min[0]) / width,
                (max[1] - min[1]) / height,
                (max[2] - min[2]) / depth
            };
            if (cells.Max() - cells.Min() > 1e-4)
            {
                Log($"  Cloth collider grid is not cubic: {string.Join(", ", cells)}.");
                continue;
            }

            var bytes = new byte[distances.Count];
            var span = ClothColliderCeiling - ClothColliderFloor;
            var unreadable = 0;
            for (var i = 0; i < bytes.Length; i++)
            {
                // An unreadable sample reads as far outside, the one answer that cannot invent
                // metal where there is none.
                if (!TryParseDouble(distances[i], out var distance))
                {
                    distance = ClothColliderCeiling;
                    unreadable++;
                }
                var clamped = Math.Clamp(distance, ClothColliderFloor, ClothColliderCeiling);
                bytes[i] = (byte)Math.Round((clamped - ClothColliderFloor) / span * 255);
            }
            if (unreadable > 0)
                Log($"  Cloth collider grid has {unreadable} unreadable samples of {bytes.Length}.");

            sdfs.Add(new Dictionary<string, object?>
            {
                ["bone"] = BoneOf(sdf),
                ["collisionMask"] = ParseInt(sdf.GetValueOrDefault("nCollisionMask")),
                ["min"] = min,
                ["cell"] = cells[0],
                ["width"] = width,
                ["height"] = height,
                ["depth"] = depth,
                ["distances"] = Convert.ToBase64String(bytes),
            });
        }

        var boxes = new List<object?>();
        foreach (var entryObj in feModel.GetValueOrDefault("m_BoxRigids") as List<object?> ?? [])
        {
            if (entryObj is not Dictionary<string, object?> box) continue;
            // tmFrame2 packs the position as (x, y, z, 1) and then the quaternion, exactly like
            // m_InitPose. vSize is carried verbatim and is read as half-extents.
            var frame = ParseVector(box.GetValueOrDefault("tmFrame2"), 8);
            var size = ParseVector(box.GetValueOrDefault("vSize"), 3);
            if (frame == null || size == null)
            {
                Log("  Cloth collider box has no readable frame or size.");
                continue;
            }
            boxes.Add(new Dictionary<string, object?>
            {
                ["bone"] = BoneOf(box),
                ["collisionMask"] = ParseInt(box.GetValueOrDefault("nCollisionMask")),
                ["center"] = new List<double> { frame[0], frame[1], frame[2] },
                ["rotation"] = new List<double> { frame[4], frame[5], frame[6], frame[7] },
                ["halfExtents"] = size,
            });
        }

        var capsules = new List<object?>();
        foreach (var entryObj in
            feModel.GetValueOrDefault("m_TaperedCapsuleRigids") as List<object?> ?? [])
        {
            if (entryObj is not Dictionary<string, object?> capsule) continue;
            // vSphere is the capsule's two ends, each packed (x, y, z, radius), and the radii
            // differ — that is what makes it tapered. Carried in the same packing.
            var ends = capsule.GetValueOrDefault("vSphere") as List<object?>;
            var near = ends?.Count >= 2 ? ParseVector(ends[0], 4) : null;
            var far = ends?.Count >= 2 ? ParseVector(ends[1], 4) : null;
            if (near == null || far == null)
            {
                Log("  Cloth collider capsule has no readable ends.");
                continue;
            }
            capsules.Add(new Dictionary<string, object?>
            {
                ["bone"] = BoneOf(capsule),
                ["collisionMask"] = ParseInt(capsule.GetValueOrDefault("nCollisionMask")),
                ["spheres"] = new List<object?> { near, far },
            });
        }

        // No weapon in the game authors either of these today, which is why there is no branch for
        // them above — and why one appearing has to say so rather than vanish.
        foreach (var key in new[] { "m_SphereRigids", "m_CollisionPlanes" })
        {
            if (feModel.GetValueOrDefault(key) is List<object?> { Count: > 0 } unread)
                Log($"  Cloth collider carries {unread.Count} unread {key}.");
        }

        if (sdfs.Count == 0 && boxes.Count == 0 && capsules.Count == 0) return null;
        return new Dictionary<string, object?>
        {
            ["quantiseFloor"] = ClothColliderFloor,
            ["quantiseCeiling"] = ClothColliderCeiling,
            ["sdfs"] = sdfs,
            ["boxes"] = boxes,
            ["capsules"] = capsules,
        };
    }

    private static int ParseInt(object? value) =>
        int.TryParse(value?.ToString(), out var result) ? result : -1;

    // A fixed-length KV3 float array, or null when it is absent or the wrong length.
    private static List<double>? ParseVector(object? value, int length)
    {
        if (value is not List<object?> list || list.Count < length) return null;
        var result = new List<double>(length);
        for (var i = 0; i < length; i++)
        {
            if (!TryParseDouble(list[i], out var component)) return null;
            result.Add(component);
        }
        return result;
    }

    private static bool TryParseDouble(object? value, out double result) =>
        double.TryParse(
            value?.ToString(), NumberStyles.Float, CultureInfo.InvariantCulture, out result);

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
