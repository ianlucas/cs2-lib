/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

using System.Globalization;
using ValveResourceFormat.ResourceTypes;

namespace ItemGenerator.GameFiles;

// The agent-only half of the model metadata pass. Three jobs, all of them reading the model
// resource and none of them expressible anywhere else in the pipeline:
//
//   1. Trim the model-data JSON. An agent's raw DATA block is ~32 KB of KV, and ~77% of it is the
//      skeleton (already in the .glb, and posed there) plus the eye-look bone-constraint rig. The
//      drop list below is a DROP list rather than an allow list on purpose: a key Valve adds next
//      patch still reaches the consumer instead of being silently filtered out.
//   2. Resolve the mesh groups into the choices the published .glb actually contains, so a consumer
//      can hide the default gloves (to show an equipped glove model) or reveal the defuse kit.
//   3. Read the agent's inventory pose, which FinalizeModels writes into the .glb's joints.
//
// The patch slots are NOT resolved here. They need the agent's MATERIALS parsed, and materials are
// processed after models — see AssetProcessor.ResolveAgentPatchSlots.
public static partial class MetadataExtractor
{
    // Top-level DATA keys dropped from an agent's model-data JSON.
    private static readonly string[] AgentDataDropKeys =
        ["m_modelSkeleton", "m_remappingTable"];

    // m_keyValueText keys dropped from an agent's model-data JSON. All three are engine runtime
    // rigging: the AO capsule proxies feed the game's own ambient-occlusion pass, the physics body
    // markup feeds ragdolls, and the bone constraints drive eye-look morphs off a look-at bone.
    private static readonly string[] AgentKeyValueDropKeys =
        ["ao_proxy_capsule_list", "CPhysicsBodyGameMarkupData", "BoneConstraintList"];

    // A mesh group entry is "<group>_@<choice index>_#&<choice name>".
    private const string MeshGroupChoiceSeparator = "_#&";
    private const string MeshGroupIndexSeparator = "_@";

    // The one mesh group whose choices are dropped from the published .glb. Its choices are named
    // "firstperson_*" and "thirdperson_*"; only the latter survive, because a first-person arm set
    // is geometry no inventory viewer shows.
    private const string FirstPersonChoicePrefix = "firstperson";
    private const string ThirdPersonChoicePrefix = "thirdperson";
    private const string FirstOrThirdPersonGroup = "first_or_third_person";

    private static AgentModelExport ApplyAgentModelData(
        ItemGeneratorContext ctx,
        Model model,
        Dictionary<string, object?> root,
        AgentModelInfo agent)
    {
        foreach (var key in AgentDataDropKeys) root.Remove(key);
        if (root.TryGetValue("m_modelInfo", out var modelInfoObj) &&
            modelInfoObj is Dictionary<string, object?> modelInfo &&
            modelInfo.TryGetValue("m_keyValueText", out var keyValuesObj) &&
            keyValuesObj is Dictionary<string, object?> keyValues)
        {
            foreach (var key in AgentKeyValueDropKeys) keyValues.Remove(key);
        }

        var (keepMeshes, meshGroups) = ResolveMeshGroups(model, root);
        root["meshGroups"] = meshGroups;

        var pose = new Dictionary<string, object?>();
        if (agent.PoseSequence is { Length: > 0 } poseSequence)
        {
            root["poseSequence"] = poseSequence;
            pose = InventoryPose.Read(ctx, agent.Team, poseSequence);
        }

        return new AgentModelExport(keepMeshes, pose);
    }

    /// <summary>
    /// Pairs the model's mesh groups with its per-mesh group masks, and splits them into the meshes
    /// the published .glb keeps and the choices a consumer can switch between.
    /// </summary>
    /// <remarks>
    /// A mesh belongs to a choice when its mask has that choice's bit set — choice bit N is index N
    /// in m_meshGroups, and m_refMeshGroupMasks is parallel to the model's mesh list. Phoenix
    /// variantf, for instance, has masks [3, 1, 4, 12] over
    /// [thirdperson_body, thirdperson_default_gloves, firstperson_default_gloves_arms,
    /// firstperson_sleeves]: the body is in both third-person choices, the default gloves only in
    /// the first, and the two first-person meshes in the first-person choices.
    /// </remarks>
    private static (List<string> KeepMeshes, List<object?> MeshGroups) ResolveMeshGroups(
        Model model, Dictionary<string, object?> root)
    {
        var groups = model.GetMeshGroups().ToList();
        var masks = ParseMaskArray(root.GetValueOrDefault("m_refMeshGroupMasks"));
        var defaultMask = ParseMask(root.GetValueOrDefault("m_nDefaultMeshGroupMask"));

        var meshNames = model.GetEmbeddedMeshesAndLoD()
            .Select(m => (m.MeshIndex, m.Name))
            .Concat(model.GetReferenceMeshNamesAndLoD().Select(m => (m.MeshIndex, Name: m.MeshName)))
            .OrderBy(m => m.MeshIndex)
            .ToList();

        var keepMeshes = new List<string>();
        var meshGroups = new List<object?>();
        if (groups.Count == 0 || meshNames.Count == 0)
        {
            // No groups to choose between: every mesh ships, and there is nothing to toggle.
            keepMeshes.AddRange(meshNames.Select(m => m.Name));
            return (keepMeshes, meshGroups);
        }

        ulong keepBits = 0;
        var kept = new List<(string Group, string Choice, int Bit)>();
        for (var bit = 0; bit < groups.Count && bit < 64; bit++)
        {
            var (group, choice) = SplitMeshGroup(groups[bit]);
            if (string.Equals(group, FirstOrThirdPersonGroup, StringComparison.OrdinalIgnoreCase))
            {
                // Drift guard: this drop rule reads a CHOICE NAME, so it has to fail loudly rather
                // than silently ship first-person arms (or silently drop the whole body) if Valve
                // ever renames one.
                var isFirst = choice.StartsWith(FirstPersonChoicePrefix, StringComparison.OrdinalIgnoreCase);
                var isThird = choice.StartsWith(ThirdPersonChoicePrefix, StringComparison.OrdinalIgnoreCase);
                if (!isFirst && !isThird)
                    throw new InvalidOperationException(
                        $"Unrecognised '{FirstOrThirdPersonGroup}' mesh group choice '{choice}' in {model.Name}.");
                if (isFirst) continue;
            }
            keepBits |= 1UL << bit;
            kept.Add((group, choice, bit));
        }

        foreach (var (index, name) in meshNames)
        {
            var mask = index < masks.Count ? masks[index] : 0;
            if ((mask & keepBits) != 0) keepMeshes.Add(name);
        }

        foreach (var (group, choice, bit) in kept)
        {
            var bitMask = 1UL << bit;
            meshGroups.Add(new Dictionary<string, object?>
            {
                ["group"] = group,
                ["choice"] = choice,
                ["default"] = (defaultMask & bitMask) != 0,
                ["meshes"] = meshNames
                    .Where(m => m.MeshIndex < masks.Count && (masks[m.MeshIndex] & bitMask) != 0)
                    .Select(m => (object?)m.Name)
                    .ToList()
            });
        }

        return (keepMeshes, meshGroups);
    }

    private static (string Group, string Choice) SplitMeshGroup(string entry)
    {
        var choiceAt = entry.IndexOf(MeshGroupChoiceSeparator, StringComparison.Ordinal);
        var choice = choiceAt >= 0 ? entry[(choiceAt + MeshGroupChoiceSeparator.Length)..] : entry;
        var head = choiceAt >= 0 ? entry[..choiceAt] : entry;
        var indexAt = head.LastIndexOf(MeshGroupIndexSeparator, StringComparison.Ordinal);
        var group = indexAt >= 0 ? head[..indexAt] : head;
        return (group, choice);
    }

    private static List<ulong> ParseMaskArray(object? value) =>
        value is List<object?> list ? [.. list.Select(ParseMask)] : [];

    private static ulong ParseMask(object? value) =>
        ulong.TryParse(value?.ToString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var mask)
            ? mask
            : 0;
}
