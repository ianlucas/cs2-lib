/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { depotDownloader } from "@ianlucas/depot-downloader";
import { mkdir, writeFile } from "fs/promises";
import { assert, ensure } from "../../src/utils.ts";
import { readFileOrDefault, readProcess } from "../utils.ts";
import { buildVpkIndex } from "./decompile.ts";
import { isWorkspaceDepotSource } from "./runtime.ts";
import { Cs2Runtime } from "./types.ts";

const APP_ID = 730;
const ASSETS_DEPOT_ID = 2347770;
const DEPOT_SUCCESS_RE = /100[,.]00%/;
const DEPOT_MANIFEST_RE = /Manifest\s(\d+)/;
const ITEM_DEFINITION_PATHS = ["scripts/items/items_game.txt", "resource/csgo_"];

async function fetchLatestAssetsManifest(runtime: Cs2Runtime) {
    const output = await readProcess(
        depotDownloader({
            app: APP_ID,
            depot: ASSETS_DEPOT_ID,
            dir: runtime.config.paths.workdirPath,
            manifestOnly: true
        })
    );
    return ensure(output.match(DEPOT_MANIFEST_RE)?.[1]);
}

async function downloadDepotFileList(runtime: Cs2Runtime, filelistPath: string) {
    const output = await readProcess(
        depotDownloader({
            app: APP_ID,
            depot: ASSETS_DEPOT_ID,
            dir: runtime.config.paths.workdirPath,
            filelist: filelistPath
        })
    );
    assert(DEPOT_SUCCESS_RE.test(output));
}

export async function syncAssetsManifest(runtime: Cs2Runtime) {
    if (!isWorkspaceDepotSource(runtime)) {
        return;
    }
    const current = await readFileOrDefault(runtime.config.paths.assetsManifestPath);
    const latest = await fetchLatestAssetsManifest(runtime);
    assert(runtime.config.force || current !== latest, `Depot ${ASSETS_DEPOT_ID} is already up to date.`);
    await writeFile(runtime.config.paths.assetsManifestPath, latest, "utf-8");
}

export async function ensureItemDefinitionPackages(runtime: Cs2Runtime) {
    await mkdir(runtime.config.paths.workdirPath, { recursive: true });
    if (!isWorkspaceDepotSource(runtime)) {
        return;
    }
    await downloadDepotFileList(runtime, runtime.config.paths.depotFileListPath);
    await buildVpkIndex(runtime);
    const vpks = new Set<string>(["game/csgo/steam.inf"]);
    for (const [path, entry] of runtime.vpkIndex) {
        if (ITEM_DEFINITION_PATHS.some((prefix) => path.startsWith(prefix))) {
            vpks.add(`game/csgo/pak01_${entry.fnumber.padStart(3, "0")}.vpk`);
        }
    }
    await writeFile(runtime.config.paths.tempPakFileListPath, [...vpks].join("\n"), "utf-8");
    await downloadDepotFileList(runtime, runtime.config.paths.tempPakFileListPath);
}

export async function ensureAssetPackages(runtime: Cs2Runtime, vpkPaths: string[]) {
    if (!isWorkspaceDepotSource(runtime) || vpkPaths.length === 0) {
        return;
    }
    if (runtime.vpkIndex.size === 0) {
        await buildVpkIndex(runtime);
    }
    const vpks = new Set<string>();
    for (const vpkPath of vpkPaths) {
        const entry = runtime.vpkIndex.get(vpkPath);
        if (entry !== undefined) {
            vpks.add(`game/csgo/pak01_${entry.fnumber.padStart(3, "0")}.vpk`);
        }
    }
    if (vpks.size === 0) {
        return;
    }
    await writeFile(runtime.config.paths.tempPakFileListPath, [...vpks].join("\n"), "utf-8");
    await downloadDepotFileList(runtime, runtime.config.paths.tempPakFileListPath);
}
