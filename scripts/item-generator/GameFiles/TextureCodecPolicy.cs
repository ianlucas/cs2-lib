/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

using System.Collections.Concurrent;
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

    /// <summary>
    /// The subset of <paramref name="vpkPaths"/> that <see cref="IsRawFourChannelNormal"/> holds
    /// for, as normalized VPK paths.
    ///
    /// Deliberately re-reads the vtex_c headers rather than recording what
    /// <see cref="ResourceDecompiler"/> saw: decompilation skips textures already present in the
    /// workdir, so a set built there would depend on incremental state. Encoded bytes feed the
    /// content hashes in CDN filenames, so the classification has to come out the same on an
    /// incremental run as on a clean one.
    ///
    /// Costs one extra pass over the vtex_c entries. Reading is ordered by (archive, offset) so
    /// that pass stays sequential, and only the headers are parsed -- no pixels are decoded.
    /// </summary>
    public static HashSet<string> Collect(ItemGeneratorContext ctx, IEnumerable<string> vpkPaths)
    {
        var package = ctx.VpkPackage;
        if (package == null) return [];

        var work = vpkPaths
            .Select(p => (VpkPath: p, Entry: package.FindEntry(p)))
            .Where(t => t.Entry != null)
            .ToArray();
        if (work.Length == 0) return [];

        Array.Sort(work, static (a, b) =>
        {
            var c = a.Entry!.ArchiveIndex.CompareTo(b.Entry!.ArchiveIndex);
            return c != 0 ? c : a.Entry.Offset.CompareTo(b.Entry.Offset);
        });

        // Entries inlined in pak01_dir.vpk (ArchiveIndex 0x7FFF) share Package.Reader's base
        // stream and seek on it, so they cannot be read concurrently.
        var dirVpkLock = new object();
        var found = new ConcurrentBag<string>();
        var po = new ParallelOptions { MaxDegreeOfParallelism = Math.Max(2, Environment.ProcessorCount) };

        Parallel.ForEach(work, po, item =>
        {
            var (vpkPath, entry) = item;
            byte[] data;
            if (entry!.ArchiveIndex == 0x7FFF)
            {
                lock (dirVpkLock)
                    package.ReadEntry(entry, out data, validateCrc: false);
            }
            else
            {
                package.ReadEntry(entry, out data, validateCrc: false);
            }

            using var resource = new Resource();
            resource.FileName = vpkPath;
            resource.Read(new MemoryStream(data));
            if (IsRawFourChannelNormal(resource))
                found.Add(vpkPath);
        });

        return [.. found];
    }
}
