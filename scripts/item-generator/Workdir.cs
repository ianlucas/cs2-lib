/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

namespace ItemGenerator;

/// <summary>
/// The only place the generator recursively deletes anything. scripts/workdir is shared scratch
/// space, so a delete is allowed only when the path is an exact match for one of the directories
/// the generator itself creates (Config.GeneratedDirs). Anything else -- the workdir root, a
/// sibling directory someone parked there, a path outside the workdir -- throws.
/// </summary>
public static class Workdir
{
    public static void RemoveGeneratedDir(string path)
    {
        var target = Normalize(path);
        if (!Config.GeneratedDirs.Any(dir => Normalize(dir) == target))
            throw new InvalidOperationException(
                $"Refusing to delete '{target}': not an item-generator directory. " +
                "Add it to Config.GeneratedDirs if the generator owns it.");

        if (Directory.Exists(target))
            Directory.Delete(target, true);
    }

    public static void RecreateGeneratedDir(string path)
    {
        RemoveGeneratedDir(path);
        Directory.CreateDirectory(path);
    }

    private static string Normalize(string path) =>
        Path.TrimEndingDirectorySeparator(Path.GetFullPath(path));
}
