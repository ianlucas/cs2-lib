/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { depotDownloader } from "@ianlucas/depot-downloader";
import { DecompilerArgs, vrfDecompiler } from "@ianlucas/vrf-decompiler";
import { mkdir, writeFile } from "fs/promises";
import { availableParallelism } from "os";
import { basename, join } from "path";
import { CS2KeyValues3 } from "../src/keyvalues3.ts";
import { assert, ensure } from "../src/utils";
import { CS2_CSGO_PATH, CWD_PATH, INPUT_FORCE } from "./env";
import { log, readFileOrDefault, readProcess } from "./utils";

export const SCRIPTS_DIR = join(CWD_PATH, "scripts");
export const WORKDIR_DIR = join(SCRIPTS_DIR, "workdir");
export const DECOMPILED_DIR = join(WORKDIR_DIR, "decompiled");
export const ASSETS_MANIFEST_PATH = join(SCRIPTS_DIR, "cs2.manifest");
export const DEPOT_FILELIST_PATH = join(SCRIPTS_DIR, "cs2.depot");
export const PAK_FILELIST_PATH = join(WORKDIR_DIR, "cs2_pak.depot");
export const TEMP_PAK_FILELIST_PATH = join(WORKDIR_DIR, "cs2_temp_pak.depot");
export const DEPOT_CSGO_PATH = join(WORKDIR_DIR, "game/csgo");
export const CSGO_PAK_DIR_PATH = join(DEPOT_CSGO_PATH, "pak01_dir.vpk");

export interface VpkEntry {
    crc: string;
    fnumber: string;
}

const COMPILED_EXT: Record<string, string> = {
    ".vtex_c": ".png",
    ".vsvg_c": ".svg"
};
const OUTPUT_EXT = Object.fromEntries(Object.entries(COMPILED_EXT).map(([k, v]) => [v, k]));
const DEPOT_SUCCESS_RE = /100[,.]00%/;
const DEPOT_MANIFEST_RE = /Manifest\s(\d+)/;

const APP_ID = 730;
const ASSETS_DEPOT_ID = 2347770;
const TEXT_DIRS = ["scripts/items/items_game.txt", "resource/csgo_"];

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
        log(`Downloading packages (${vpks.size} parts)...`);
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

    public async syncLatestAssetsManifest() {
        if (this.local) {
            return;
        }
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
                const compiledExt = Object.keys(COMPILED_EXT).find((e) => path.endsWith(e));
                const normalizedPath = compiledExt
                    ? path.slice(0, -compiledExt.length) + COMPILED_EXT[compiledExt]
                    : path;
                this.vpkIndex.set(normalizedPath, {
                    crc: meta.crc.replace("0x", ""),
                    fnumber: meta.fnumber
                });
            }
        }
        return this.vpkIndex;
    }

    public async downloadAndDecompileScripts() {
        await mkdir(WORKDIR_DIR, { recursive: true });
        if (!this.local) {
            log("Downloading script objects...");
            await this.downloadCsgoPakDir();
        }
        await this.buildVpkIndex();
        if (!this.local) {
            await this.downloadCsgoPakDirParts(TEXT_DIRS);
        }
        const threads = availableParallelism();
        log(`Decompiling script objects (${threads} threads)...`);
        await readProcess(
            vrfDecompiler({
                input: this.pakDirPath,
                output: DECOMPILED_DIR,
                vpkDecompile: true,
                vpkFilepath: TEXT_DIRS.join(","),
                threads
            })
        );
    }

    public async downloadAndDecompile(vpkPaths: string[]) {
        if (!this.local) {
            if (vpkPaths.length === 0) {
                return log("No objects to download.");
            }
            const vpks = new Set<string>();
            for (const vpkPath of vpkPaths) {
                const entry = this.vpkIndex.get(vpkPath);
                if (entry) {
                    vpks.add(`game/csgo/pak01_${entry.fnumber.padStart(3, "0")}.vpk`);
                }
            }
            await writeFile(TEMP_PAK_FILELIST_PATH, [...vpks].join("\n"), "utf-8");
            log(`Downloading ${vpks.size} package(s)...`);
            const dlOutput = await readProcess(
                depotDownloader({
                    app: APP_ID,
                    depot: ASSETS_DEPOT_ID,
                    dir: WORKDIR_DIR,
                    filelist: TEMP_PAK_FILELIST_PATH
                })
            );
            assert(DEPOT_SUCCESS_RE.test(dlOutput));
        }
        await this.decompilePaths(vpkPaths);
    }

    private async decompilePaths(vpkPaths: string[], extraArgs?: Partial<DecompilerArgs>) {
        const threads = availableParallelism();
        log(`Decompiling ${vpkPaths.length} objects (${threads} threads)...`);
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
                    threads,
                    ...extraArgs
                })
            );
            batch = [];
            batchBytes = 0;
        };
        for (const p of vpkPaths) {
            const outputExt = Object.keys(OUTPUT_EXT).find((e) => p.endsWith(e));
            const original = outputExt ? p.slice(0, -outputExt.length) + OUTPUT_EXT[outputExt] : p;
            const len = Buffer.byteLength(original) + 1;
            if (batchBytes + len > MAX_ARG_BYTES) await flush();
            batch.push(original);
            batchBytes += len;
        }
        await flush();
    }

    public async decompileModels(vpkPaths: string[]) {
        await this.decompilePaths(vpkPaths, {
            gltfExportFormat: "glb",
            gltfExportMaterials: true
        });
    }

    private parseKv3Recursively(value: any): any {
        if (typeof value === "string" && value.trimStart().startsWith("<!--")) {
            try {
                return this.parseKv3Recursively(CS2KeyValues3.parse(value));
            } catch {
                return value;
            }
        }
        if (Array.isArray(value)) {
            return value.map((v) => this.parseKv3Recursively(v));
        }
        if (value !== null && typeof value === "object") {
            return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, this.parseKv3Recursively(v)]));
        }
        return value;
    }

    public async extractModelData(entries: { vpkPath: string; targetFilename: string }[]) {
        const MAX_ARG_BYTES = 100_000;
        const results: { filename: string; data: any; materials: string[] }[] = [];
        let batchEntries: typeof entries = [];
        let batchBytes = 0;

        const flush = async () => {
            if (batchEntries.length === 0) {
                return;
            }
            const stdout = await this.decompile({
                block: "DATA",
                threads: 1,
                vpkFilepath: batchEntries.map((e) => e.vpkPath).join(",")
            });
            // Split stdout into per-file chunks by "[N/M] path" boundaries
            const chunks = stdout.split(/(?=\[\d+\/\d+\])/);
            let chunkIndex = 0;
            for (const entry of batchEntries) {
                const chunk = chunks[chunkIndex++] ?? "";
                // Extract .vmat references
                const materialsMatch = chunk.match(/--- Resource External Refs: ---([\s\S]*?)(?=---|$)/);
                const materials: string[] = [];
                if (materialsMatch) {
                    for (const line of materialsMatch[1].split("\n")) {
                        const m = line.match(/\s+[0-9A-F]+\s+(\S+\.vmat)\s*$/);
                        if (m) materials.push(m[1]);
                    }
                }
                // Extract and parse DATA block
                const dataMatch = chunk.match(/--- Data for block "DATA" ---\s*([\s\S]+)$/);
                let data: any = null;
                if (dataMatch) {
                    data = this.parseKv3Recursively(CS2KeyValues3.parse(dataMatch[1].trim()));
                }
                const filename = basename(entry.targetFilename).replace(/\.glb$/, ".json");
                results.push({ filename, data, materials });
            }
            batchEntries = [];
            batchBytes = 0;
        };

        for (const entry of entries) {
            const len = Buffer.byteLength(entry.vpkPath) + 1;
            if (batchBytes + len > MAX_ARG_BYTES) await flush();
            batchEntries.push(entry);
            batchBytes += len;
        }
        await flush();
        return results;
    }

    public async extractMaterialData(vmatPaths: string[]) {
        const MAX_ARG_BYTES = 100_000;
        const results: { vmatPath: string; filename: string; data: any; vtexRefs: string[]; vmatRefs: string[] }[] = [];
        const entries = vmatPaths
            .map((p) => ({ vmatPath: p, vpkPath: p.replace(".vmat", ".vmat_c").toLowerCase() }))
            .filter((e) => this.vpkIndex.has(e.vpkPath));
        let batchEntries: typeof entries = [];
        let batchBytes = 0;

        const flush = async () => {
            if (batchEntries.length === 0) {
                return;
            }
            const stdout = await this.decompile({
                block: "DATA",
                threads: 1,
                vpkFilepath: batchEntries.map((e) => e.vpkPath).join(",")
            });
            const chunks = stdout.split(/(?=\[\d+\/\d+\])/);
            let chunkIndex = 0;
            for (const entry of batchEntries) {
                const chunk = chunks[chunkIndex++] ?? "";
                const externalRefsMatch = chunk.match(/--- Resource External Refs: ---([\s\S]*?)(?=---|$)/);
                const vtexRefs: string[] = [];
                if (externalRefsMatch) {
                    for (const line of externalRefsMatch[1].split("\n")) {
                        const m = line.match(/\s+[0-9A-F]+\s+(\S+\.vtex)\s*$/);
                        if (m) vtexRefs.push(m[1]);
                    }
                }
                const dataMatch = chunk.match(/--- Data for block "DATA" ---\s*([\s\S]+)$/);
                let data: any = null;
                const vmatRefs: string[] = [];
                if (dataMatch) {
                    data = this.parseKv3Recursively(CS2KeyValues3.parse(dataMatch[1].trim()));
                    for (const m of dataMatch[1].matchAll(/"([^"]+\.vmat)"/g)) {
                        vmatRefs.push(m[1].replace(/\\/g, "/"));
                    }
                }
                const crc = this.vpkIndex.get(entry.vpkPath)!.crc;
                const filename = `${basename(entry.vmatPath, ".vmat")}_${crc}.vmat.json`;
                results.push({ vmatPath: entry.vmatPath, filename, data, vtexRefs, vmatRefs });
            }
            batchEntries = [];
            batchBytes = 0;
        };

        for (const entry of entries) {
            const len = Buffer.byteLength(entry.vpkPath) + 1;
            if (batchBytes + len > MAX_ARG_BYTES) await flush();
            batchEntries.push(entry);
            batchBytes += len;
        }
        await flush();
        return results;
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
