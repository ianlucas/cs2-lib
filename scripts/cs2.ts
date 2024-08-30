/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { depotDownloader } from "@ianlucas/depot-downloader";
import { vrfDecompiler } from "@ianlucas/vrf-decompiler";
import { warn } from "console";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import { join } from "path";
import { assert } from "../src/utils";
import { exists, log, readProcess, shouldRun, warning } from "./utils";

const cwd = process.cwd();
const APP = 730;
const DEPOT_ID = 2347770;
const csgoDirectoryFilelistPath = join(cwd, `scripts/cs2.depot`);
const csgoManifestPath = join(cwd, `scripts/cs2.manifest`);
const workdirPath = join(cwd, "scripts/workdir");
const gamePath = join(workdirPath, "game");
const decompiledPath = join(workdirPath, "decompiled");
const csgoPackageFilelistPath = join(workdirPath, "csgo_packages.depot");
const csgoDirectoryPath = join(workdirPath, "game/csgo/pak01_dir.vpk");
const extractDirectories = ["panorama/", "resource/", "scripts/", "soundevents/"];

async function getLatestCsgoManifest() {
    try {
        const output = await readProcess(
            depotDownloader({
                app: APP,
                depot: DEPOT_ID,
                dir: workdirPath,
                manifestOnly: true
            })
        );
        const matches = output.match(/Manifest\s(\d+)/);
        if (matches !== null) {
            return parseInt(matches[1]);
        }
    } catch (error) {
        console.error(error);
    }
    return undefined;
}

async function downloadCsgoDirectoryFromDepot() {
    try {
        log("Downloading game/csgo/pak01_dir.vpk...");
        const output = await readProcess(
            depotDownloader({
                app: APP,
                depot: DEPOT_ID,
                dir: workdirPath,
                filelist: csgoDirectoryFilelistPath
            })
        );
        const matches = output.match(/100(\.|,)00% (.*)/);
        if (matches !== null) {
            return true;
        }
        return undefined;
    } catch (error) {
        console.error(error);
    }
    return undefined;
}

async function getCsgoPackageFilesToDownload() {
    assert(await exists(csgoDirectoryPath));
    const vpksToDownload = new Set<string>();
    log("Getting list of package files to download...");
    (
        await readProcess(
            vrfDecompiler({
                input: csgoDirectoryPath,
                vpkDir: true
            })
        )
    )
        .split("\n")
        .forEach((line) => {
            for (const dir of extractDirectories) {
                if (line.startsWith(dir)) {
                    const meta = Object.fromEntries(
                        line
                            .split(" ")
                            .slice(1)
                            .map((kv) => kv.split("="))
                    ) as {
                        crc: string;
                        metadatasz: string;
                        fnumber: string;
                        ofs: string;
                        sz: string;
                    };
                    vpksToDownload.add(`game/csgo/pak01_${meta.fnumber.padStart(3, "0")}.vpk`);
                    return;
                }
            }
        });
    return Array.from(vpksToDownload).join("\n");
}

async function checkCsgoPackageDirectory() {
    if (!(await exists(workdirPath))) {
        await mkdir(workdirPath, { recursive: true });
    }
    const manifest = (await exists(csgoManifestPath)) ? parseInt(await readFile(csgoManifestPath, "utf-8")) : 0;
    const latestManifest = await getLatestCsgoManifest();
    if (latestManifest === undefined) {
        warning(`Failed to get latest manifest for depot ${DEPOT_ID}`);
        return false;
    }
    if (manifest === latestManifest) {
        warning(`Depot ${DEPOT_ID} is up to date`);
        return false;
    }
    if (!(await downloadCsgoDirectoryFromDepot())) {
        warning("Failed to download game/csgo/pak01_dir.vpk");
        return;
    }
    await writeFile(csgoManifestPath, latestManifest.toString(), "utf-8");
    return true;
}

async function downloadCsgoPackageFiles() {
    try {
        await writeFile(csgoPackageFilelistPath, await getCsgoPackageFilesToDownload(), "utf-8");
        log("Downloading package files...");
        const output = await readProcess(
            depotDownloader({
                app: APP,
                depot: DEPOT_ID,
                dir: workdirPath,
                filelist: csgoPackageFilelistPath
            })
        );
        const matches = output.match(/100(\.|,)00% (.*)/);
        if (matches !== null) {
            return true;
        }
        return undefined;
    } catch (error) {
        console.error(error);
    }
    return undefined;
}

async function extractCsgoPackageFiles() {
    try {
        log("Extracting files...");
        for (const directory of extractDirectories) {
            await readProcess(
                vrfDecompiler({
                    input: csgoDirectoryPath,
                    output: decompiledPath,
                    vpkDecompile: true,
                    vpkFilepath: directory
                })
            );
        }
        await rm(gamePath, { recursive: true });
        return true;
    } catch {
        console.error("Failed to extract files");
    }
    return false;
}

export async function main() {
    if (await checkCsgoPackageDirectory()) {
        if (await downloadCsgoPackageFiles()) {
            if (await extractCsgoPackageFiles()) {
                log("Downloaded CS2 files successfully");
            }
        }
    } else {
        warn("CS2 files are up to date");
        process.exit(1);
    }
}

if (shouldRun(import.meta.url)) {
    main().catch(console.error);
}
