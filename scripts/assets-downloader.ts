/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { depotDownloader } from "@ianlucas/depot-downloader";
import { vrfDecompiler } from "@ianlucas/vrf-decompiler";
import { access, mkdir, readFile, rm, writeFile } from "fs/promises";
import { join } from "path";
import { assert } from "../src/utils";
import { shouldRun } from "./utils";

const cwd = process.cwd();
const APP = 730;
const DEPOT_ID = 2347770;
const filelistPath = join(cwd, `scripts/${DEPOT_ID}.depot`);
const manifestPath = join(cwd, `scripts/${DEPOT_ID}.manifest`);
const workdirPath = join(cwd, "scripts/workdir");
const gamePath = join(workdirPath, "game");
const decompiledPath = join(workdirPath, "decompiled");
const vpkFilelistPath = join(workdirPath, "vpk.depot");
const vpkDirPath = join(workdirPath, "game/csgo/pak01_dir.vpk");
const exceptionsPath = join(cwd, "exceptions.json");
const assetsDirectories = ["panorama/", "resource/", "scripts/", "soundevents/"];

async function exists(path: string) {
    try {
        await access(path);
        return true;
    } catch {
        return false;
    }
}

async function getLatestManifest() {
    try {
        const output = await depotDownloader({
            app: APP,
            depot: DEPOT_ID,
            dir: workdirPath,
            manifestOnly: true
        });
        const matches = output.match(/Manifest\s(\d+)/);
        if (matches !== null) {
            return parseInt(matches[1]);
        }
    } catch (error) {
        console.error(error);
    }
    return undefined;
}

async function downloadPakDirFromDepot() {
    try {
        console.log("Downloading pak_dir...");
        const output = await depotDownloader({
            app: APP,
            depot: DEPOT_ID,
            dir: workdirPath,
            filelist: filelistPath
        });
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

async function getPakFilelistToDownload() {
    assert(await exists(vpkDirPath));
    const vpksToDownload = new Set<string>();
    console.log("Getting vpk filelist to download...");
    (
        await vrfDecompiler({
            input: vpkDirPath,
            vpkDir: true
        })
    )
        .split("\n")
        .forEach((line) => {
            for (const dir of assetsDirectories) {
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

async function checkPakDir() {
    if (!(await exists(workdirPath))) {
        await mkdir(workdirPath, { recursive: true });
    }
    const manifest = (await exists(manifestPath)) ? parseInt(await readFile(manifestPath, "utf-8")) : 0;
    const latestManifest = await getLatestManifest();
    if (latestManifest === undefined) {
        console.log(`Failed to get latest manifest for depot ${DEPOT_ID}`);
        return false;
    }
    if (manifest === latestManifest) {
        console.log(`Depot ${DEPOT_ID} is up to date`);
        return false;
    }
    if (!(await downloadPakDirFromDepot())) {
        console.log("Failed to download pak_dir");
        return;
    }
    await writeFile(manifestPath, latestManifest.toString(), "utf-8");
    return true;
}

async function downloadVpkFiles() {
    try {
        await writeFile(vpkFilelistPath, await getPakFilelistToDownload(), "utf-8");
        console.log("Downloading vpk files...");
        const output = await depotDownloader({
            app: APP,
            depot: DEPOT_ID,
            dir: workdirPath,
            filelist: vpkFilelistPath
        });
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

async function extractFiles() {
    try {
        console.log("Extracting files...");
        for (const directory of assetsDirectories) {
            await vrfDecompiler({
                input: vpkDirPath,
                output: decompiledPath,
                vpkDecompile: true,
                vpkFilepath: directory
            });
        }
        await rm(gamePath, { recursive: true });
        return true;
    } catch {
        console.error("Failed to extract files");
    }
    return false;
}

export class AssetsDownloader {
    async run() {
        if (await checkPakDir()) {
            if (await downloadVpkFiles()) {
                if (await extractFiles()) {
                    console.log("Assets downloaded successfully");
                }
            }
        } else {
            console.warn("Assets are up to date");
        }
    }
}

if (shouldRun(import.meta.url)) {
    new AssetsDownloader().run();
}
