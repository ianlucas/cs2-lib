/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

using ValveResourceFormat;
using ValveResourceFormat.ResourceTypes;

namespace ItemGenerator.GameFiles;

/// <summary>
/// Identifies the textures whose four channels must be exported verbatim instead of
/// through ValveResourceFormat's HemiOct decode.
///
/// A BC7 normal map compiled with "Mip HemiOctAnisoRoughness" and WITHOUT
/// "Mip HemiOctIsoRoughness_RG_B" packs FOUR independent values: an anisotropic roughness
/// pair in (r, b) and a hemi-octahedral normal in (g, a). VRF maps both dependencies to
/// <c>TextureCodec.HemiOctRB</c>, whose decode reads the packed pair from (r, g), writes the
/// decoded unit vector into rgb and moves b into alpha -- OVERWRITING raw_a. Three of the
/// four channels invert back out of that map in a shader; raw_a does not, so the consumer is
/// stuck decoding the wrong pair. Measured against a raw export, that tilts the normal by a
/// mean 6-67 degrees depending on the texture (silk 67.0, brass 37.7, leather 8.0).
///
/// The absence of the _RG_B dependency is what makes it so, and it is the ONLY reliable
/// signal. Nearly every other normal map in the game carries BOTH dependencies, and for those
/// the _RG_B layout is the one that was actually applied: the normal really does live in
/// (r, g) and VRF decodes them correctly. Gating on "HemiOctAnisoRoughness present" alone
/// matches 8,552 textures game-wide -- sticker and character normals included -- and
/// exporting those raw renders them meaningless (measured mean tilt 89.7 degrees reading
/// (g, a), versus 0.5 degrees reading (r, g)).
///
/// BC7 is required on top: a 2-channel ATI2N normal has no fourth channel to lose, so the
/// decode is right for it regardless.
///
/// The surviving set is the compat glove layer maps, bound by csgo_customglove_preview.vfx
/// and csgo_textile_layer.vfx. No weapon, sticker or character shader binds any of them.
/// </summary>
public static class TextureCodecPolicy
{
    private const string CompileTexture = "CompileTexture";
    private const string HemiOctAnisoRoughness = "Texture Compiler Version Mip HemiOctAnisoRoughness";
    private const string HemiOctIsoRoughnessRgB = "Texture Compiler Version Mip HemiOctIsoRoughness_RG_B";
    private const string AnisoRoughnessRg = "Texture Compiler Version Mip AnisoRoughness_RG";

    /// <summary>
    /// Whether this is a compiler-generated anisotropic roughness pair (csgo_character.vfx's
    /// g_tAnisoGloss), whose (r, g) must be exported verbatim.
    /// </summary>
    /// <remarks>
    /// The ATI2N texture holds roughness along the two anisotropy axes. It also carries the
    /// HemiOctAnisoRoughness dependency, so VRF's default decode reads (r, g) as a hemi-octahedral
    /// normal and rewrites both: measured on ctm_fbi_v2_body_variantd, a raw median of 0.89 comes
    /// out as 0.99.
    /// </remarks>
    public static bool IsAnisoRoughness(Resource resource) =>
        resource.EditInfo != null && resource.EditInfo.SpecialDependencies.Any(dependency =>
            dependency.CompilerIdentifier == CompileTexture && dependency.String == AnisoRoughnessRg);

    /// <summary>
    /// Whether this texture's four raw channels must survive export intact.
    /// </summary>
    public static bool IsRawFourChannelNormal(Resource resource)
    {
        if (resource.DataBlock is not Texture texture || texture.Format != VTexFormat.BC7)
            return false;
        if (resource.EditInfo == null)
            return false;
        var aniso = false;
        foreach (var dependency in resource.EditInfo.SpecialDependencies)
        {
            if (dependency.CompilerIdentifier != CompileTexture) continue;
            if (dependency.String == HemiOctIsoRoughnessRgB) return false;
            if (dependency.String == HemiOctAnisoRoughness) aniso = true;
        }
        return aniso;
    }
}
