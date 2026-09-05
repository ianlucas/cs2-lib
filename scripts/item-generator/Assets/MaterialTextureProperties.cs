/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

namespace ItemGenerator;

// The complete set of CS2 material parameter names known to reference a texture. A parameter
// names its texture in one of two shapes, both covered here:
//
//   * `.vmat` `m_textureParams` — name is `m_name`, texture is `m_pValue`.
//   * `.vcompmat` loose variables — name is `m_strName`, texture is `m_strTextureRuntimeResourcePath`
//     (the `m_strTextureContentAssetPath` source is authoring content, not counted).
//
// Gathered by scanning generated `*.vmat.json`/`*.vcompmat.json` for parameters pointing at
// `/textures/`. AssetProcessor fails the build on any texture reference not attributable to a listed
// parameter, so a new texture-bearing parameter in a CS2 update stops the build until it is reviewed.
//
// Keep this list sorted; add new entries only after confirming the parameter in fresh game data.
//
// ---------------------------------------------------------------------------------------------
// TEXTURE ANNOTATIONS
// Each entry's comment records, for the texture that parameter feeds: (1) the CS2 `vtex_c`
// format(s) it is compiled to, (2) what each RGBA channel holds, (3) a one-line description.
//
// Shaders sourced (the [bracket] tags, each a csgo_*.vfx): customweapon, composite_inputs, weapon,
// weapon_sticker, customglove(+preview), textile_layer, character, simple, simple_liquid,
// unlitgeneric, composite_generic.
//
// Format legend (CS2 VTEX_FORMAT):
//   BC7      4-channel block (carries RGB or RGBA)     DXT1    RGB (+1-bit A) block
//   BC5      = ATI2N, 2-channel (R,G) block            DXT5    RGBA block
//   BC4      = ATI1N, 1-channel (R) block              RGBA8   uncompressed 8-bit x4
//   I8       1-channel 8-bit                           RGBA16F uncompressed half-float x4 (HDR)
// Normal packings:
//   HemiOct(RG)         2-channel hemi-octahedral unit normal (VRF decodes R,G -> rgb)
//   +isoRough(B)        isotropic roughness packed in B (only on 4-channel BC7/DXT5 normals)
//   HemiOctAniso(RGBA)  four independent values: unit normal in (G,A), anisotropic roughness in
//                       (R,B). Lacks the `_RG_B` compiler tag, so it MUST be exported raw or the
//                       decode corrupts alpha — see TextureCodecPolicy.IsRawFourChannelNormal.
// Colorspace is called out only when sRGB; unmarked channels are linear.
// ---------------------------------------------------------------------------------------------
public static class MaterialTextureProperties
{
    public static readonly IReadOnlySet<string> Known = new HashSet<string>(StringComparer.Ordinal)
    {
        // BC7 RGBA sRGB [vcompmat loose var]. Prepacked compositor AO input for gunsmith paint-kits:
        // R=cavity, G=ambient occlusion, A=no-paint mask (same family as g_tAmbientOcclusion).
        "ambient_occlusion",
        // [customweapon/composite_inputs] BC7 RGBA sRGB: R=cavity, G=ambient occlusion, A=no-paint mask.
        // [weapon/weapon_sticker/character/simple] BC4 R: plain AO. Ambient occlusion / cavity.
        "g_tAmbientOcclusion",
        // BC4 R [character]. Blood-application mask.
        "g_tBloodMask",
        // BC7 RGBA sRGB [customweapon]. Color-ramp LUT: remaps wear/durability to a case-hardening tint.
        "g_tCaseHardeningColorRamp",
        // [customweapon/composite/weapon] BC7 RGBA sRGB: RGB albedo (+A). [sticker/character/unlit]
        // DXT1 RGB. [simple/character] BC7 RGB + A=AO|metalness|translucency. Base color / albedo.
        "g_tColor",
        // BC7 [simple_liquid]: RGB=color (sRGB), A=metalness. Liquid layer-A albedo+metalness.
        "g_tColorA",
        // BC4 R [customglove(+preview)/textile]. Per-material damage height (stored inverted).
        "g_tDamage1",
        // BC4 R [customglove(+preview)]. Per-material damage height — as g_tDamage1.
        "g_tDamage2",
        // BC4 R [customglove(+preview)]. Per-material damage height — as g_tDamage1.
        "g_tDamage3",
        // BC4 R [customglove(+preview)]. Per-material damage height — as g_tDamage1.
        "g_tDamage4",
        // BC5 HemiOct(RG) [customglove/textile]. Per-material damage normal.
        "g_tDamageNormal1",
        // BC5 HemiOct(RG) [customglove]. Per-material damage normal — as g_tDamageNormal1.
        "g_tDamageNormal2",
        // BC5 HemiOct(RG) [customglove]. Per-material damage normal — as g_tDamageNormal1.
        "g_tDamageNormal3",
        // BC5 HemiOct(RG) [customglove]. Per-material damage normal — as g_tDamageNormal1.
        "g_tDamageNormal4",
        // BC7 RGB sRGB [weapon/character]. Detail albedo overlay.
        "g_tDetail",
        // BC7 RGBA [customglove/textile]. Per-material detail map.
        "g_tDetail1",
        // BC7 RGBA [customglove]. Per-material detail map — as g_tDetail1.
        "g_tDetail2",
        // BC7 RGBA [customglove]. Per-material detail map — as g_tDetail1.
        "g_tDetail3",
        // BC7 RGBA [customglove]. Per-material detail map — as g_tDetail1.
        "g_tDetail4",
        // BC5 HemiOct(RG) [customglove/textile]. Per-material detail normal.
        "g_tDetailNormal1",
        // BC5 HemiOct(RG) [customglove]. Per-material detail normal — as g_tDetailNormal1.
        "g_tDetailNormal2",
        // BC5 HemiOct(RG) [customglove]. Per-material detail normal — as g_tDetailNormal1.
        "g_tDetailNormal3",
        // BC5 HemiOct(RG) [customglove]. Per-material detail normal — as g_tDetailNormal1.
        "g_tDetailNormal4",
        // RGBA8 RGB [character]. Diffuse-warp ramp (skin lighting LUT).
        "g_tDiffuseFalloff",
        // Grayscale AO (R) [vcompmat loose var]. AO baked into the final composited material.
        "g_tFinalAmbientOcclusion",
        // RGBA8 [customweapon/weapon]: RG=hemi-oct glitter normal, A=glitter mask.
        "g_tGlitterNormal",
        // RGBA8 [weapon_sticker/weapon]: RG=hemi-oct glitter normal, A=glitter mask. Sticker glitter.
        "g_tGlitterNormalSticker0",
        // RGBA8 [weapon]. Sticker glitter — as g_tGlitterNormalSticker0.
        "g_tGlitterNormalSticker1",
        // RGBA8 [weapon]. Sticker glitter — as g_tGlitterNormalSticker0.
        "g_tGlitterNormalSticker2",
        // RGBA8 [weapon]. Sticker glitter — as g_tGlitterNormalSticker0.
        "g_tGlitterNormalSticker3",
        // RGBA8 [weapon]. Sticker glitter — as g_tGlitterNormalSticker0.
        "g_tGlitterNormalSticker4",
        // BC7 RGB sRGB [customglove(+preview)/textile]. Per-material grime color overlay.
        "g_tGrime1",
        // BC7 RGB sRGB [customglove(+preview)]. Per-material grime — as g_tGrime1.
        "g_tGrime2",
        // BC7 RGB sRGB [customglove(+preview)]. Per-material grime — as g_tGrime1.
        "g_tGrime3",
        // BC7 RGB sRGB [customglove(+preview)]. Per-material grime — as g_tGrime1.
        "g_tGrime4",
        // BC7 RGBA sRGB [customweapon]. Grunge/dirt overlay (RGB grime, A wear modifier) multiplied over paint.
        "g_tGrunge",
        // BC7 RGBA [customglove/textile]. Per-material grunge/dirt overlay.
        "g_tGrunge1",
        // BC7 RGBA [customglove]. Per-material grunge — as g_tGrunge1.
        "g_tGrunge2",
        // BC7 RGBA [customglove]. Per-material grunge — as g_tGrunge1.
        "g_tGrunge3",
        // BC7 RGBA [customglove]. Per-material grunge — as g_tGrunge1.
        "g_tGrunge4",
        // BC7 RGB sRGB [weapon_sticker/weapon]. Holographic spectrum gradient (view-angle rainbow).
        "g_tHoloSpectrumSticker0",
        // BC7 RGB sRGB [weapon]. Holo spectrum — as g_tHoloSpectrumSticker0.
        "g_tHoloSpectrumSticker1",
        // BC7 RGB sRGB [weapon]. Holo spectrum — as g_tHoloSpectrumSticker0.
        "g_tHoloSpectrumSticker2",
        // BC7 RGB sRGB [weapon]. Holo spectrum — as g_tHoloSpectrumSticker0.
        "g_tHoloSpectrumSticker3",
        // BC7 RGB sRGB [weapon]. Holo spectrum — as g_tHoloSpectrumSticker0.
        "g_tHoloSpectrumSticker4",
        // BC7 RGB [customglove(+preview)]. Object material-id map: picks which layer material per texel.
        "g_tLayerId",
        // BC7 RGBA [customglove]. Per-layer blend masks.
        "g_tLayerMask",
        // BC4 R [simple_liquid] (inverted). Liquid coverage mask.
        "g_tLiquidMask",
        // BC7 RGB [customweapon/composite_inputs]. Three paint-region masks: R,G,B each select paint
        // slot 1/2/3 over base slot 0 (drives color, durability, metalness and roughness per region).
        "g_tMasks",
        // [customweapon/composite/weapon] BC5 R=roughness(inverted), G=metalness (BC7 adds B=SFX mask).
        // [character] BC7 G=metal, B=cloth, A=rim (one variant R=retro-reflective). [sticker] DXT1 G=metal.
        // Packed roughness/metalness — NOTE R is roughness (not metalness) in the weapon pipeline.
        "g_tMetalness",
        // BC7 RGBA [customglove/textile]. Blend noise.
        "g_tNoise",
        // [weapon/customweapon/customglove/textile] BC5 HemiOct(RG) normal. [character/simple/weapon_sticker]
        // BC7 RG=normal +isoRough(B). Tangent-space normal (with packed roughness in the 4-channel form).
        "g_tNormal",
        // BC7 [simple_liquid]: RG=hemi-oct normal, +isoRough(B). Liquid layer-A normal.
        "g_tNormalA",
        // BC7 [weapon_sticker/weapon]: RG=hemi-oct normal, +isoRough(B), A=self-illum mask. Sticker normal.
        "g_tNormalRoughnessSticker0",
        // BC7 [weapon]. Sticker normal — as g_tNormalRoughnessSticker0.
        "g_tNormalRoughnessSticker1",
        // BC7 [weapon]. Sticker normal — as g_tNormalRoughnessSticker0.
        "g_tNormalRoughnessSticker2",
        // BC7 [weapon]. Sticker normal — as g_tNormalRoughnessSticker0.
        "g_tNormalRoughnessSticker3",
        // BC7 [weapon]. Sticker normal — as g_tNormalRoughnessSticker0.
        "g_tNormalRoughnessSticker4",
        // BC7 [customglove(+preview)/textile]: R=AO, G=curvature, B=high-touch (wear) mask. Object properties.
        "g_tObjectProperties",
        // BC7 R [weapon]. Opaque-refraction mask.
        "g_tOpaqueRefractMask",
        // BC7 RGBA sRGB [customweapon]. Overlay color composited over the paint.
        "g_tOverlay",
        // BC4 R sRGB [customweapon]. Mask for where g_tOverlay applies.
        "g_tOverlayMask",
        // RGBA mask atlas [vcompmat loose var]. Paint-by-number region masks: assign gunsmith paint
        // colors per region (the g_tMasks equivalent for community "paint by number" kits).
        "g_tPaintByNumberMasks",
        // BC4 R [customweapon]. Extra per-paint metalness mask.
        "g_tPaintMetalness",
        // BC4 R [customweapon]. Per-paint roughness.
        "g_tPaintRoughness",
        // BC7 RGBA sRGB [customweapon]. Patina/age color-ramp LUT.
        "g_tPatinaAgeColorRamp",
        // BC4 R [customweapon]. Patina/age application mask.
        "g_tPatinaAgeMask",
        // BC7 RGBA [customweapon]: RGB=pattern color / region weights, A=coverage/cut mask (triplanar-
        // projected via g_tPosition). [customglove] BC7 RGBA, or RGB=color(sRGB)+A=translucency. Paint pattern.
        "g_tPattern",
        // BC5 [customglove(+preview)]: R=metalness, G=roughness. Pattern PBR properties.
        "g_tPatternProperties",
        // BC4 R [customweapon]. Pearlescence amount mask.
        "g_tPearlescenceMask",
        // RGBA16F [customweapon/composite_inputs]: RGB=object-space position, A=scale. Triplanar
        // pattern-projection coordinates.
        "g_tPosition",
        // RGBA16F / EXR [vcompmat loose var]. Object-space position override (workshop UV position map).
        "g_tPositionOverride",
        // DXT1 RGB sRGB [weapon]. Self-illumination color mask.
        "g_tSelfIllumMask",
        // [weapon_sticker/weapon] BC7 (also DXT5): RGB=holo mask, A=glitter mask. Sticker SFX masks.
        "g_tSfxMaskSticker0",
        // DXT5 [weapon]. Sticker SFX masks — as g_tSfxMaskSticker0.
        "g_tSfxMaskSticker1",
        // DXT5 [weapon]. Sticker SFX masks — as g_tSfxMaskSticker0.
        "g_tSfxMaskSticker2",
        // DXT5 [weapon]. Sticker SFX masks — as g_tSfxMaskSticker0.
        "g_tSfxMaskSticker3",
        // DXT5 [weapon]. Sticker SFX masks — as g_tSfxMaskSticker0.
        "g_tSfxMaskSticker4",
        // DXT1 [character]: G=SSS mask, R=hair mask. Subsurface-scatter / hair.
        "g_tSssMask",
        // BC7 RGBA sRGB [weapon_sticker/weapon]: RGB=sticker color, A=wear mask. Sticker image.
        "g_tSticker0",
        // BC7 RGBA sRGB [weapon]. Sticker image — as g_tSticker0.
        "g_tSticker1",
        // BC7 RGBA sRGB [weapon]. Sticker image — as g_tSticker0.
        "g_tSticker2",
        // BC7 RGBA sRGB [weapon]. Sticker image — as g_tSticker0.
        "g_tSticker3",
        // BC7 RGBA sRGB [weapon]. Sticker image — as g_tSticker0.
        "g_tSticker4",
        // BC7 R [weapon_sticker/weapon]. Sticker scratch/wear pattern.
        "g_tStickerScratches",
        // BC5 [weapon]: R=sticker mask, G=sticker cavity. Weapon-side inputs feeding sticker compositing.
        "g_tStickerWepInputs",
        // BC7 [customglove(+preview)/textile]: RGB=substrate albedo (sRGB), A=tint mask. Substrate layer color.
        "g_tSubstrate1",
        // BC7 [customglove(+preview)]. Substrate layer color — as g_tSubstrate1.
        "g_tSubstrate2",
        // BC7 [customglove(+preview)]. Substrate layer color — as g_tSubstrate1.
        "g_tSubstrate3",
        // BC7 [customglove(+preview)]. Substrate layer color — as g_tSubstrate1.
        "g_tSubstrate4",
        // BC7 HemiOctAniso(RGBA) [customglove(+preview)/textile]: normal in (G,A), aniso roughness in
        // (R,B); export RAW (see TextureCodecPolicy). Substrate normal + roughness.
        "g_tSubstrateNormal1",
        // BC7 HemiOctAniso(RGBA) [customglove(+preview)]. Substrate normal+rough — as g_tSubstrateNormal1.
        "g_tSubstrateNormal2",
        // BC7 HemiOctAniso(RGBA) [customglove(+preview)]. Substrate normal+rough — as g_tSubstrateNormal1.
        "g_tSubstrateNormal3",
        // BC7 HemiOctAniso(RGBA) [customglove(+preview)]. Substrate normal+rough — as g_tSubstrateNormal1.
        "g_tSubstrateNormal4",
        // BC7 [customglove(+preview)/textile]: R=AO, G=metalness, B=cloth mask, A=height. Substrate properties.
        "g_tSubstrateProperties1",
        // BC7 [customglove(+preview)]. Substrate properties — as g_tSubstrateProperties1.
        "g_tSubstrateProperties2",
        // BC7 [customglove(+preview)]. Substrate properties — as g_tSubstrateProperties1.
        "g_tSubstrateProperties3",
        // BC7 [customglove(+preview)]. Substrate properties — as g_tSubstrateProperties1.
        "g_tSubstrateProperties4",
        // [customweapon/composite_inputs] BC7 RGB: object-space surface normal (triplanar pattern blend).
        // [customglove/textile] BC7 RGBA: packed surface properties. The "surface" composite input.
        "g_tSurface",
        // BC7 [customglove(+preview)/textile]: RGB=surface albedo (sRGB), A=tint mask. Surface layer color.
        "g_tSurface1",
        // BC7 [customglove(+preview)]. Surface layer color — as g_tSurface1.
        "g_tSurface2",
        // BC7 [customglove(+preview)]. Surface layer color — as g_tSurface1.
        "g_tSurface3",
        // BC7 [customglove(+preview)]. Surface layer color — as g_tSurface1.
        "g_tSurface4",
        // BC7 HemiOctAniso(RGBA) [customglove(+preview)/textile]: normal in (G,A), aniso roughness in
        // (R,B); export RAW (see TextureCodecPolicy). Surface normal + roughness.
        "g_tSurfaceNormal1",
        // BC7 HemiOctAniso(RGBA) [customglove(+preview)]. Surface normal+rough — as g_tSurfaceNormal1.
        "g_tSurfaceNormal2",
        // BC7 HemiOctAniso(RGBA) [customglove(+preview)]. Surface normal+rough — as g_tSurfaceNormal1.
        "g_tSurfaceNormal3",
        // BC7 HemiOctAniso(RGBA) [customglove(+preview)]. Surface normal+rough — as g_tSurfaceNormal1.
        "g_tSurfaceNormal4",
        // BC7 [customglove(+preview)/textile]: R=AO, G=metalness, B=cloth mask, A=height. Surface properties.
        "g_tSurfaceProperties1",
        // BC7 [customglove(+preview)]. Surface properties — as g_tSurfaceProperties1.
        "g_tSurfaceProperties2",
        // BC7 [customglove(+preview)]. Surface properties — as g_tSurfaceProperties1.
        "g_tSurfaceProperties3",
        // BC7 [customglove(+preview)]. Surface properties — as g_tSurfaceProperties1.
        "g_tSurfaceProperties4",
        // BC7 RGBA sRGB [composite_generic]. Generic composite operand A.
        "g_tTextureA",
        // BC7 RGBA sRGB [composite_generic]. Generic composite operand B.
        "g_tTextureB",
        // I8 [customglove(+preview)]. Object tint-region id (selects a tint per region).
        "g_tTintId",
        // BC4 R [weapon/character]. Tint-application mask.
        "g_tTintMask",
        // BC4 R [customweapon]. Paint-wear pattern (drives where paint wears through to base metal).
        "g_tWear",
    };
}
