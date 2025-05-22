/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { depotDownloader } from "@ianlucas/depot-downloader";
import { DecompilerArgs, vrfDecompiler } from "@ianlucas/vrf-decompiler";
import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { assert, ensure } from "../src/utils";
import { CS2_CSGO_DIRECTORY_PATH, INPUT_FORCE } from "./env";
import { exists, log, readProcess, shouldRun } from "./utils";

export class CS2 {
    public readonly isLocal = CS2_CSGO_DIRECTORY_PATH !== undefined;
    private readonly APP_ID = 730;
    private readonly DEPOT_ID = 2347770;
    private readonly EXTRACT_DIRS = ["panorama/", "resource/", "scripts/", "soundevents/"];
    private readonly TEXTURE_DIRS = [
        "weapons/paints/",
        "materials/models/weapons/customization/paints/vmats/",
        "materials/models/weapons/customization/paints/custom/",
        "materials/models/weapons/customization/paints/gunsmith/",
        "items/assets/paintkits/"
    ];
    private readonly paths = {
        cwd: process.cwd(),
        workdir: join(process.cwd(), "scripts/workdir"),
        decompiled: join(process.cwd(), "scripts/workdir/decompiled"),
        manifest: join(process.cwd(), "scripts/cs2.manifest"),
        depotFilelist: join(process.cwd(), "scripts/cs2.depot"),
        packageFilelist: join(process.cwd(), "scripts/workdir/csgo_packages.depot"),
        csgoDir: CS2_CSGO_DIRECTORY_PATH ?? join(process.cwd(), "scripts/workdir/game/csgo/pak01_dir.vpk")
    };

    private async getLatestManifest() {
        const output = await readProcess(
            depotDownloader({
                app: this.APP_ID,
                depot: this.DEPOT_ID,
                dir: this.paths.workdir,
                manifestOnly: true
            })
        ).catch((e) => {
            throw new Error(`Failed to fetch manifest: ${e}`);
        });
        const match = ensure(output.match(/Manifest\s(\d+)/), `No manifest found for depot ${this.DEPOT_ID}`);
        return match[1];
    }

    private async downloadCsgoDirectory() {
        log("Downloading CSGO directory...");
        const output = await readProcess(
            depotDownloader({
                app: this.APP_ID,
                depot: this.DEPOT_ID,
                dir: this.paths.workdir,
                filelist: this.paths.depotFilelist
            })
        );
        assert(/100[,.]00%/.test(output), "Failed to download CSGO directory");
    }

    private async getPackageFiles() {
        assert(await exists(this.paths.csgoDir), "CSGO directory missing");
        log("Listing package files...");
        const vpks = new Set<string>(["game/csgo/steam.inf"]);
        const output = await readProcess(
            vrfDecompiler({
                input: this.paths.csgoDir,
                vpkDir: true
            })
        );
        const dirs = [...this.EXTRACT_DIRS, ...this.TEXTURE_DIRS];
        for (const line of output.split("\n")) {
            if (dirs.some((dir) => line.startsWith(dir))) {
                const meta = Object.fromEntries(
                    line
                        .split(" ")
                        .slice(1)
                        .map((kv) => kv.split("="))
                ) as { fnumber: string };
                vpks.add(`game/csgo/pak01_${meta.fnumber.padStart(3, "0")}.vpk`);
            }
        }
        return [...vpks];
    }

    private async fetchManifest() {
        await mkdir(this.paths.workdir, { recursive: true });
        const current = (await exists(this.paths.manifest)) ? await readFile(this.paths.manifest, "utf-8") : "";
        const latest = await this.getLatestManifest();
        assert(INPUT_FORCE === "true" || current !== latest, `Depot ${this.DEPOT_ID} is up to date`);
        await this.downloadCsgoDirectory();
        await writeFile(this.paths.manifest, latest.toString(), "utf-8");
        return true;
    }

    private async downloadPackages() {
        const files = await this.getPackageFiles();
        await writeFile(this.paths.packageFilelist, files.join("\n"), "utf-8");
        log("Downloading packages...");
        const output = await readProcess(
            depotDownloader({
                app: this.APP_ID,
                depot: this.DEPOT_ID,
                dir: this.paths.workdir,
                filelist: this.paths.packageFilelist
            })
        );
        assert(/100[,.]00%/.test(output), "Unable to download packages.");
        return true;
    }

    private async extractFiles() {
        log("Extracting files...");
        for (const dir of this.EXTRACT_DIRS) {
            await readProcess(
                vrfDecompiler({
                    input: this.paths.csgoDir,
                    output: this.paths.decompiled,
                    vpkDecompile: true,
                    vpkFilepath: dir
                })
            );
        }
        return true;
    }

    public async download() {
        if ((await this.fetchManifest()) && (await this.downloadPackages()) && (await this.extractFiles())) {
            log("CS2 files downloaded successfully");
            return;
        }
        throw new Error("CS2 files download or extraction failed");
    }

    async decompile(options: DecompilerArgs) {
        return await readProcess(
            vrfDecompiler({
                input: this.paths.csgoDir,
                ...options
            })
        );
    }
}

if (shouldRun(import.meta.url)) {
    await new CS2().download();
}
