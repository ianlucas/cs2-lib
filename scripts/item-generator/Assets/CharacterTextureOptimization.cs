/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

namespace ItemGenerator;

// Per-property WebP encode tiers for AGENT textures, the fifth tuning surface beside
// StickerTextureOptimization, WeaponTextureOptimization, GloveTextureOptimization and
// KeychainTextureOptimization. It follows their contract exactly: this file owns POLICY (which
// property gets which tier), scripts/item-generator-webp.ts owns MEASUREMENT (every guard named
// here is a texture-driven classifier it evaluates against the pristine decompiled PNG), and a
// property absent from Targets is never touched -- its textures take the default lossless path.
//
// WHY THESE TEXTURES MATTER MORE THAN THE OTHER FAMILIES'. An agent's textures are EMBEDDED in its
// .glb rather than served as separate content-addressed files (see docs/patches.md and
// item-generator-agent-glb.ts), because an agent has no paint kit and so nothing to recombine at
// runtime. That makes the per-texture budget here the agent's download size directly: there is no
// dedup across agents for anything an agent's own material binds.
//
// THE TIER RECORD IS GloveTextureTier, deliberately. Agents and glove arms bind csgo_character.vfx
// -- the SAME shader, the same channel meanings on g_tColor / g_tNormal / g_tAmbientOcclusion --
// so the descriptor the encoder receives is the same one, and duplicating the record set would put
// two copies of one wire format in the tree. `Kind` is overridden to "character" so a manifest line
// still names the family that chose it.
//
// SCOPE. GloveTextureOptimization admits csgo_character.vfx ONLY under
// `characters/models/shared/arms/` (its GlovePathSegments); this file admits it only OUTSIDE that
// subtree, which is where an agent's own body, legs and headwear materials live. An agent model
// binds both — its third-person meshes wear the shared glove and bare-arm materials — and the arm
// half stays lossless here, exactly as it does when a glove item ships it. Patch materials
// (`patches/**.vmat`) are csgo_character.vfx too and are excluded as well: they are published
// through the material pipeline, where PatchTextureOptimization owns them.
public static class CharacterTextureOptimization
{
    // ---------------------------------------------------------------------------------------------
    // SCOPE
    // ---------------------------------------------------------------------------------------------

    public const string CharacterShader = "csgo_character.vfx";

    /// Subtrees of csgo_character.vfx materials that belong to another family.
    public static readonly IReadOnlyList<string> ForeignPathSegments =
    [
        "/models/shared/arms/",
        "/patches/",
    ];

    // ---------------------------------------------------------------------------------------------
    // TIERS
    //
    // These carry the GLOVE numbers over unchanged, and that is the point rather than an accident:
    // the channels are the same channels, so the tier that is right for a glove's normal map is
    // right for an agent's. The one number that does NOT transfer on its own authority is the
    // ceiling -- gloves aim at 1.5 MB because a glove is two small objects on screen, whereas an
    // agent is a whole body in the inspect view AND carries roughly eight of its own textures into
    // one .glb. The ceiling is kept at 1.5 MB here so the first build is comparable to the glove
    // family it is ported from; it is the first thing to measure and retune once a full build has
    // run, and the only figure in this file not backed by a measurement.
    // ---------------------------------------------------------------------------------------------

    private const int Cap = 2048;
    private const int Half = 1024;
    private const int MB = 1024 * 1024;
    private static readonly int Ceiling = (int)Math.Round(1.5 * MB);

    private const string Character = "character";

    // TANGENT-SPACE NORMALS. The csgo_character.vfx variant packs BC7 RG=normal + isoRough(B), which
    // VRF's decode moves into ALPHA, so alpha is ROUGHNESS and never a coverage mask -- it is most of
    // the file, and an RGB-only ladder cannot reach the ceiling. Alpha joins the walk but stops at 60.
    // This is GloveTextureOptimization's NormalTier verbatim, for the identical channel layout.
    private static readonly GloveTextureTier NormalTier = new()
    {
        Kind = Character,
        Mode = GloveEncodeMode.Lossy,
        Quality = 80,
        MaxWidth = Cap,
        AlphaQuality = 100,
        SizeBudget = new(Ceiling, MinQuality: 64, MinAlphaQuality: 60),
    };

    // ALBEDO -- g_tColor, and the patch BACKING weaves, which are albedo by another name (a cloth or
    // leather swatch the patch is composited onto). FlattenGuard matters here specifically: an agent
    // colour map's alpha is constant 255 on every sample measured, and a constant plane costs bytes
    // for nothing.
    private static readonly GloveTextureTier AlbedoTier = new()
    {
        Kind = Character,
        Mode = GloveEncodeMode.Lossy,
        Quality = 80,
        MaxWidth = Cap,
        LossyGuard = new(30),
        AlphaGuard = new(0.5, 60),
        FlattenGuard = true,
        SizeBudget = new(Ceiling, MinQuality: 64, MinAlphaQuality: 40),
    };

    // ORM PACK -- R = ambient occlusion, G = roughness, B = metalness: three INDEPENDENT scalars, so
    // this is GloveTextureOptimization's PackedTier and PackedFloorTier verbatim. The chroma subsampler
    // must never see it (4:2:0 would bleed metalness across AO), and FlatPlaneGuard routes the many
    // packs with a constant plane (B = 0 on a surface with no metal) to the bounded posterize path,
    // which leaves that plane bit-exact. Metalness is a selector plane with hard edges, which is why
    // the fallback floor is lossless rather than a lower lossy quality.
    private static readonly GloveTextureTier OrmFloorTier = new()
    {
        Kind = Character,
        Mode = GloveEncodeMode.Lossless,
        Quality = 100,
        MaxWidth = Cap,
        MaskKernel = true,
        MaskBudget = new(Ceiling, [80, 70, 60], [4, 8, 12, 16], [Half]),
    };

    private static readonly GloveTextureTier OrmTier = new()
    {
        Kind = Character,
        Mode = GloveEncodeMode.Lossy,
        Quality = 90,
        MaxWidth = Cap,
        SmartSubsample = true,
        MaskKernel = true,
        FlatPlaneGuard = true,
        FlattenGuard = true,
        LossyGuard = new(30),
        GuardFallback = OrmFloorTier,
        SizeBudget = new(Ceiling, MinQuality: 70, MinAlphaQuality: null, Widths: [Half]),
        MaskBudget = new(Ceiling, [80, 70, 60], [4, 8, 12, 16], [Half]),
    };

    // A property absent from this table is never touched. The absences are deliberate:
    //   g_tAmbientOcclusion, VRF never exports these as images of their own: it packs them (with the
    //   g_tMetalness        roughness in g_tNormal's alpha) into one ORM image, which only glTF's PBR
    //                       slots reference. They are tiered through SlotTargets instead.
    //   g_tDiffuseFalloff   a skin-lighting LUT -- the one content class where a DCT has no business
    //                       at any size. This is also the texture gltfpack destroys outright (its
    //                       alpha is uniformly 0, and a lossy encoder discards the RGB underneath);
    //                       item-generator-webp.ts passes `exact` and the default path is lossless,
    //                       so both halves of that failure are already ruled out here.
    //   g_tBloodMask        nearly always the shared 1x1/16x16 engine default.
    //   g_tSssMask,         small single files, none near the ceiling.
    //   g_tAnisoGloss
    //   g_tEyeAlbedo1,      eyes are a few hundred pixels on screen at inspect distance and the
    //   g_tEyeMask1         masks are selector planes.
    //   g_tPatch0..2        the placeholder artwork the game always replaces. It never renders, and
    //                       item-generator-agent-glb.ts stubs it to 4x4 in the .glb regardless.
    //   g_tTintMask,        one binding each across every agent material in the build.
    //   g_tGlassTintColor,
    //   g_tGlassDust
    public static readonly IReadOnlyDictionary<string, GloveTextureTier> Targets = new Dictionary<
        string,
        GloveTextureTier
    >(StringComparer.Ordinal)
    {
        ["g_tColor"] = AlbedoTier,
        ["g_tNormal"] = NormalTier,
        ["g_tPatch0Backing"] = AlbedoTier,
        ["g_tPatch1Backing"] = AlbedoTier,
        ["g_tPatch2Backing"] = AlbedoTier,
    };

    /// <summary>
    /// Tiers for images a material binds through a glTF PBR SLOT rather than a vmat parameter.
    /// </summary>
    /// <remarks>
    /// The ORM pack is synthesised by VRF at export, so no vmat parameter names it and the slot is the
    /// only binding it has. The slot is still a structural binding read off the material, never a
    /// filename pattern. Both slots name the same image; they agree on the tier, so it survives
    /// agree-or-drop.
    /// </remarks>
    public static readonly IReadOnlyDictionary<string, GloveTextureTier> SlotTargets =
        new Dictionary<string, GloveTextureTier>(StringComparer.Ordinal)
        {
            ["occlusionTexture"] = OrmTier,
            ["metallicRoughnessTexture"] = OrmTier,
        };

    // ---------------------------------------------------------------------------------------------
    // CLASSIFIER
    // ---------------------------------------------------------------------------------------------

    /// <summary>
    /// Resolves `texture file name -> tier` for one agent's own textures, reading the material
    /// graph back out of the .glb VRF exported.
    /// </summary>
    /// <remarks>
    /// <para>
    /// This classifier reads the GLB rather than the material pipeline, because an agent's materials
    /// never enter that pipeline: its textures are embedded in its .glb, so nothing about them is
    /// published as a separate content-addressed file and there is no material JSON to build. VRF
    /// writes the whole vmat into each glTF material's `extras.vmat`, so the shader name and the
    /// parameter each texture is bound to survive the export intact.
    /// </para>
    /// <para>
    /// The agree-or-drop rule is the one the other four families use, narrowed to its meaningful
    /// scope: a texture qualifies only when every binding of it WITHIN THIS MODEL is an agent
    /// material binding it to a target property. It does not need to consider bindings elsewhere in
    /// the build the way GloveTextureOptimization does, because this encode produces a copy that
    /// lives only inside this .glb — a glove item shipping the same texture ships its own, encoded
    /// under its own family's rules, and the two cannot disagree about a file they do not share.
    /// </para>
    /// <para>
    /// `materials` is (material resource path, shader name, vmat parameter name -> texture file
    /// name, glTF PBR slot name -> image name), read from the .glb. Keys of the result are image
    /// names as the GLB lists them, e.g. "tm_phoenix_v2_body_variantf_color_psd_2d8f36b4.vtex".
    /// </para>
    /// </remarks>
    public static Dictionary<string, GloveTextureTier> ResolveTextureTiers(
        IEnumerable<(
            string MaterialPath,
            string ShaderName,
            IReadOnlyDictionary<string, string> TextureParams,
            IReadOnlyDictionary<string, string> GltfSlots
        )> materials
    )
    {
        var tiers = new Dictionary<string, GloveTextureTier>(StringComparer.OrdinalIgnoreCase);
        var foreign = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        void Bind(string texture, GloveTextureTier? tier)
        {
            if (texture.Length == 0)
                return;
            // Two bindings that want DIFFERENT tiers have no single answer, so the texture is dropped
            // exactly like a foreign one.
            if (
                tier == null
                || tiers.TryGetValue(texture, out var seen) && !ReferenceEquals(seen, tier)
            )
                foreign.Add(texture);
            else
                tiers[texture] = tier;
        }

        foreach (var (materialPath, shaderName, textureParams, gltfSlots) in materials)
        {
            var agentFamily = IsAgentMaterial(materialPath, shaderName);
            foreach (var (property, texture) in textureParams)
                Bind(texture, agentFamily ? Targets.GetValueOrDefault(property) : null);
            foreach (var (slot, image) in gltfSlots)
                Bind(image, agentFamily ? SlotTargets.GetValueOrDefault(slot) : null);
        }

        foreach (var texture in foreign)
            tiers.Remove(texture);
        return tiers;
    }

    private static bool IsAgentMaterial(string materialPath, string shaderName)
    {
        if (!string.Equals(shaderName, CharacterShader, StringComparison.OrdinalIgnoreCase))
            return false;
        var path = $"/{MaterialPaths.NormalizeMaterialResourcePath(materialPath).TrimStart('/')}";
        foreach (var segment in ForeignPathSegments)
            if (path.Contains(segment, StringComparison.OrdinalIgnoreCase))
                return false;
        return true;
    }
}
