/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { depotDownloader } from "@ianlucas/depot-downloader";
import { DecompilerArgs, vrfDecompiler } from "@ianlucas/vrf-decompiler";
import { mkdir, writeFile } from "fs/promises";
import { availableParallelism } from "os";
import { join } from "path";
import { assert, ensure } from "../src/utils";
import { CS2_CSGO_PATH, CWD_PATH, INPUT_FORCE } from "./env";
import { log, readFileOrDefault, readProcess } from "./utils";

export const SCRIPTS_DIR = join(CWD_PATH, "scripts");
export const WORKDIR_DIR = join(SCRIPTS_DIR, "workdir");
export const DECOMPILED_DIR = join(WORKDIR_DIR, "decompiled");
export const ASSETS_MANIFEST_PATH = join(SCRIPTS_DIR, "cs2.manifest");
export const DEPOT_FILELIST_PATH = join(SCRIPTS_DIR, "cs2.depot");
export const PAK_FILELIST_PATH = join(WORKDIR_DIR, "cs2_pak.depot");
export const IMAGE_PAK_FILELIST_PATH = join(WORKDIR_DIR, "cs2_image_pak.depot");
export const DEPOT_CSGO_PATH = join(WORKDIR_DIR, "game/csgo");
export const CSGO_PAK_DIR_PATH = join(DEPOT_CSGO_PATH, "pak01_dir.vpk");

export interface VpkEntry {
    crc: string;
    fnumber: string;
}

const DEPOT_SUCCESS_RE = /100[,.]00%/;
const DEPOT_MANIFEST_RE = /Manifest\s(\d+)/;

const APP_ID = 730;
const ASSETS_DEPOT_ID = 2347770;
const TEXT_DIRS = ["scripts/", "resource/"];
const EXTRACT_IMAGE_DIRS = ["panorama/", "resource/", "scripts/"];

export class CS2 {
    public local = !CS2_CSGO_PATH.includes("workdir");
    public vpkIndex: Map<string, VpkEntry> = new Map();

    get pakDirPath() {
        return this.local ? join(CS2_CSGO_PATH, "pak01_dir.vpk") : CSGO_PAK_DIR_PATH;
    }

    private async fetchLatestAssetsManifest() {
        const output = await readProcess(
            depotDownloader({
                app: APP_ID,
                depot: ASSETS_DEPOT_ID,
                dir: WORKDIR_DIR,
                manifestOnly: true
            })
        );
        return ensure(output.match(DEPOT_MANIFEST_RE)?.[1]);
    }

    private async downloadCsgoPakDir() {
        log("Downloading 'pak01_dir.vpk'...");
        const output = await readProcess(
            depotDownloader({
                app: APP_ID,
                depot: ASSETS_DEPOT_ID,
                dir: WORKDIR_DIR,
                filelist: DEPOT_FILELIST_PATH
            })
        );
        assert(DEPOT_SUCCESS_RE.test(output));
    }

    private async downloadCsgoPakDirParts(dirs: string[]) {
        log("Checking required 'pak01_dir.vpk' parts...");
        if (this.vpkIndex.size === 0) {
            await this.buildVpkIndex();
        }
        const vpks = new Set<string>(["game/csgo/steam.inf"]);
        for (const [path, entry] of this.vpkIndex) {
            if (dirs.some((dir) => path.startsWith(dir))) {
                vpks.add(`game/csgo/pak01_${entry.fnumber.padStart(3, "0")}.vpk`);
            }
        }
        await writeFile(PAK_FILELIST_PATH, [...vpks].join("\n"), "utf-8");
        log("Downloading packages...");
        const output = await readProcess(
            depotDownloader({
                app: APP_ID,
                depot: ASSETS_DEPOT_ID,
                dir: WORKDIR_DIR,
                filelist: PAK_FILELIST_PATH
            })
        );
        assert(DEPOT_SUCCESS_RE.test(output));
    }

    private async extractAndDecompileFiles() {
        const threads = availableParallelism();
        log(`Extracting and decompiling asset files (${threads} threads)...`);
        for (const dir of EXTRACT_IMAGE_DIRS) {
            await readProcess(
                vrfDecompiler({
                    input: this.pakDirPath,
                    output: DECOMPILED_DIR,
                    vpkDecompile: true,
                    vpkFilepath: dir,
                    threads
                })
            );
        }
    }

    public async syncLatestAssetsManifest() {
        const current = await readFileOrDefault(ASSETS_MANIFEST_PATH);
        const latest = await this.fetchLatestAssetsManifest();
        assert(INPUT_FORCE === "true" || current !== latest, `Depot ${ASSETS_DEPOT_ID} is already up to date.`);
        await writeFile(ASSETS_MANIFEST_PATH, latest, "utf-8");
    }

    public async buildVpkIndex() {
        log("Building VPK index...");
        const output = await readProcess(vrfDecompiler({ input: this.pakDirPath, vpkDir: true }));
        for (const line of output.split("\n")) {
            const parts = line.trim().split(" ");
            if (parts.length < 2) continue;
            const path = parts[0];
            const meta: Record<string, string> = {};
            for (const kv of parts.slice(1)) {
                const eqIdx = kv.indexOf("=");
                if (eqIdx !== -1) meta[kv.slice(0, eqIdx)] = kv.slice(eqIdx + 1);
            }
            if (meta.crc && meta.fnumber) {
                const normalizedPath = path.endsWith(".vtex_c") ? path.slice(0, -7) + ".png" : path;
                this.vpkIndex.set(normalizedPath, {
                    crc: meta.crc.replace("0x", ""),
                    fnumber: meta.fnumber
                });
            }
        }
        return this.vpkIndex;
    }

    public async downloadTextData() {
        await mkdir(WORKDIR_DIR, { recursive: true });
        await this.downloadCsgoPakDir();
        await this.buildVpkIndex();
        await this.downloadCsgoPakDirParts(TEXT_DIRS);
        const threads = availableParallelism();
        log(`Extracting text data files (${threads} threads)...`);
        for (const dir of TEXT_DIRS) {
            await readProcess(
                vrfDecompiler({
                    input: this.pakDirPath,
                    output: DECOMPILED_DIR,
                    vpkDecompile: true,
                    vpkFilepath: dir,
                    threads
                })
            );
        }
    }

    public async downloadAndDecompileImages(vpkPaths: string[]) {
        if (vpkPaths.length === 0) {
            return log("No images to download.");
        }
        const vpks = new Set<string>();
        for (const vpkPath of vpkPaths) {
            const entry = this.vpkIndex.get(vpkPath);
            if (entry) {
                vpks.add(`game/csgo/pak01_${entry.fnumber.padStart(3, "0")}.vpk`);
            }
        }
        await writeFile(IMAGE_PAK_FILELIST_PATH, [...vpks].join("\n"), "utf-8");
        log(`Downloading ${vpks.size} image package(s)...`);
        const dlOutput = await readProcess(
            depotDownloader({
                app: APP_ID,
                depot: ASSETS_DEPOT_ID,
                dir: WORKDIR_DIR,
                filelist: IMAGE_PAK_FILELIST_PATH
            })
        );
        assert(DEPOT_SUCCESS_RE.test(dlOutput));
        const threads = availableParallelism();
        log(`Decompiling ${vpkPaths.length} images (${threads} threads)...`);
        console.log(vpkPaths);
        const MAX_ARG_BYTES = 100_000;
        let batch: string[] = [];
        let batchBytes = 0;
        const flush = async () => {
            if (batch.length === 0) return;
            await readProcess(
                vrfDecompiler({
                    input: this.pakDirPath,
                    output: DECOMPILED_DIR,
                    vpkDecompile: true,
                    vpkFilepath: batch.join(","),
                    threads
                })
            );
            batch = [];
            batchBytes = 0;
        };
        for (const p of vpkPaths) {
            const original = p.endsWith(".png") ? p.slice(0, -4) + ".vtex_c" : p;
            const len = Buffer.byteLength(original) + 1;
            if (batchBytes + len > MAX_ARG_BYTES) await flush();
            batch.push(original);
            batchBytes += len;
        }
        await flush();
    }

    public async download() {
        await mkdir(WORKDIR_DIR, { recursive: true });
        await this.syncLatestAssetsManifest();
        await this.downloadCsgoPakDir();
        await this.downloadCsgoPakDirParts(EXTRACT_IMAGE_DIRS);
        await this.extractAndDecompileFiles();
        log("Game files successfully downloaded and decompiled.");
    }

    async decompile(options: DecompilerArgs) {
        return await readProcess(
            vrfDecompiler({
                input: this.pakDirPath,
                threads: availableParallelism(),
                ...options
            })
        );
    }
}
