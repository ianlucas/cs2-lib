/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

using System.Collections.Concurrent;
using ValveResourceFormat;
using ValveResourceFormat.ResourceTypes;

namespace ItemGenerator.GameFiles;

/// <summary>
/// Reads vtex_c headers to decide, per texture, which of its channels are real.
///
/// Two independent questions, both answered from the compiled header alone:
/// <see cref="IsRawFourChannelNormal"/> asks whether VRF's HemiOct decode would destroy a
/// channel the game stores, and <see cref="HasSyntheticAlpha"/> asks whether VRF's decode
/// invents one the game does not. The first is asked per resource as it is decompiled
/// (<see cref="ResourceDecompiler"/>); the second in a batch up front (<see cref="Collect"/>),
/// because the encoder needs the answer for every texture before any of them is encoded.
///
/// The first case: the textures whose four channels must be exported verbatim instead of
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
    /// Formats that carry no alpha channel in the game data at all. Every alpha value VRF
    /// reports for one of these is invented by its decoder, so none of it may ship.
    ///
    /// BC4/BC5 store one and two channels; VRF's block decoder fills the rest with 0 and the
    /// alpha with 255. I8 is single-channel and expands to gray. DXT1 decodes through
    /// TinyBCSharp's BC1NoAlpha, which is opaque by definition -- VRF never reads BC1's
    /// one-bit alpha mode, so a DXT1 texture cannot reach us with alpha either.
    ///
    /// IA88 is deliberately absent: its second channel IS alpha. So is BC7, which is the only
    /// block format here that can carry a genuine fourth channel.
    /// </summary>
    private static readonly VTexFormat[] AlphaFreeFormats =
        [VTexFormat.ATI1N, VTexFormat.ATI2N, VTexFormat.DXT1, VTexFormat.I8];

    /// <summary>
    /// Whether every alpha value VRF will report for this texture is an artifact of its
    /// decoder rather than data from the game.
    ///
    /// Two shapes reach us. The plain one is a format with fewer than four channels, where
    /// VRF pads the alpha to 255; libwebp already drops a fully-opaque alpha, so those ship
    /// clean today and this predicate only makes that explicit. The one that actually leaks is
    /// a BC5 normal carrying a HemiOct dependency: <c>Decode_HemiOct</c> ends with
    /// <c>color.a = color.b</c>, and BC5 has no blue, so 592 textures ship a fabricated
    /// all-zero alpha plane over meaningful RGB. That is the pattern that forces `exact` on the
    /// encoder and that silently destroys the image in any tool which premultiplies -- sharp's
    /// own resize included.
    ///
    /// Gated on format alone, never on pixels: a BC7 texture whose alpha happens to be constant
    /// still has a real fourth channel, and flipping it would change what a shader samples.
    /// </summary>
    public static bool HasSyntheticAlpha(Resource resource)
    {
        return resource.DataBlock is Texture texture
            && Array.IndexOf(AlphaFreeFormats, texture.Format) >= 0;
    }

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
    /// The subsets of <paramref name="vpkPaths"/>, as normalized VPK paths, that
    /// <see cref="IsRawFourChannelNormal"/> and <see cref="HasSyntheticAlpha"/> hold for.
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
    public static (HashSet<string> RawFourChannelNormals, HashSet<string> SyntheticAlpha) Collect(
        ItemGeneratorContext ctx, IEnumerable<string> vpkPaths)
    {
        var package = ctx.VpkPackage;
        if (package == null) return ([], []);

        var work = vpkPaths
            .Select(p => (VpkPath: p, Entry: package.FindEntry(p)))
            .Where(t => t.Entry != null)
            .ToArray();
        if (work.Length == 0) return ([], []);

        Array.Sort(work, static (a, b) =>
        {
            var c = a.Entry!.ArchiveIndex.CompareTo(b.Entry!.ArchiveIndex);
            return c != 0 ? c : a.Entry.Offset.CompareTo(b.Entry.Offset);
        });

        // Entries inlined in pak01_dir.vpk (ArchiveIndex 0x7FFF) share Package.Reader's base
        // stream and seek on it, so they cannot be read concurrently.
        var dirVpkLock = new object();
        var rawFourChannelNormals = new ConcurrentBag<string>();
        var syntheticAlpha = new ConcurrentBag<string>();
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
                rawFourChannelNormals.Add(vpkPath);
            if (HasSyntheticAlpha(resource))
                syntheticAlpha.Add(vpkPath);
        });

        return ([.. rawFourChannelNormals], [.. syntheticAlpha]);
    }
}
