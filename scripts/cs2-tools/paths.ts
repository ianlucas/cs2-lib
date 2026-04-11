/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from "path";
import { CWD_PATH } from "../env.ts";
import { Cs2Paths } from "./types.ts";

export const SCRIPTS_DIR = join(CWD_PATH, "scripts");
export const WORKDIR_DIR = join(SCRIPTS_DIR, "workdir");
export const DECOMPILED_DIR = join(WORKDIR_DIR, "decompiled");
export const ASSETS_MANIFEST_PATH = join(SCRIPTS_DIR, "cs2.manifest");
export const DEPOT_FILELIST_PATH = join(SCRIPTS_DIR, "cs2.depot");
export const DEPOT_CSGO_PATH = join(WORKDIR_DIR, "game/csgo");
export const CSGO_PAK_DIR_PATH = join(DEPOT_CSGO_PATH, "pak01_dir.vpk");
export const TEMP_PAK_FILELIST_PATH = join(WORKDIR_DIR, "cs2_temp_pak.depot");

export function createDefaultCs2Paths(source: Cs2Paths["pakDirPath"]): Cs2Paths {
    return {
        assetsManifestPath: ASSETS_MANIFEST_PATH,
        decompiledDir: DECOMPILED_DIR,
        depotCsgoPath: DEPOT_CSGO_PATH,
        depotFileListPath: DEPOT_FILELIST_PATH,
        pakDirPath: source,
        tempPakFileListPath: TEMP_PAK_FILELIST_PATH,
        workdirPath: WORKDIR_DIR
    };
}
