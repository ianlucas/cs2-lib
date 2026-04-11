/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DecompilerArgs, vrfDecompiler } from "@ianlucas/vrf-decompiler";
import { availableParallelism } from "os";
import { readProcess } from "../utils.ts";
import { Cs2Runtime, DecompileAssetsOptions } from "./types.ts";

const COMPILED_EXT: Record<string, string> = {
    ".vsvg_c": ".svg",
    ".vtex_c": ".png"
};
const OUTPUT_EXT = Object.fromEntries(Object.entries(COMPILED_EXT).map(([compiled, output]) => [output, compiled]));
const ITEM_DEFINITION_PATHS = ["scripts/items/items_game.txt", "resource/csgo_"];

function normalizeIndexedPath(path: string) {
    const compiledExt = Object.keys(COMPILED_EXT).find((extension) => path.endsWith(extension));
    return compiledExt ? path.slice(0, -compiledExt.length) + COMPILED_EXT[compiledExt] : path;
}

function toDecompilerPath(path: string) {
    const outputExt = Object.keys(OUTPUT_EXT).find((extension) => path.endsWith(extension));
    return outputExt ? path.slice(0, -outputExt.length) + OUTPUT_EXT[outputExt] : path;
}

async function runDecompiler(runtime: Cs2Runtime, options: DecompilerArgs) {
    return await readProcess(
        vrfDecompiler({
            input: runtime.config.paths.pakDirPath,
            threads: availableParallelism(),
            ...options
        })
    );
}

export async function buildVpkIndex(runtime: Cs2Runtime) {
    if (runtime.vpkIndex.size > 0) {
        return runtime.vpkIndex;
    }
    const output = await readProcess(vrfDecompiler({ input: runtime.config.paths.pakDirPath, vpkDir: true }));
    for (const line of output.split("\n")) {
        const parts = line.trim().split(" ");
        if (parts.length < 2) {
            continue;
        }
        const path = parts[0];
        const meta: Record<string, string> = {};
        for (const part of parts.slice(1)) {
            const eqIdx = part.indexOf("=");
            if (eqIdx !== -1) {
                meta[part.slice(0, eqIdx)] = part.slice(eqIdx + 1);
            }
        }
        if (meta.crc && meta.fnumber) {
            runtime.vpkIndex.set(normalizeIndexedPath(path), {
                crc: meta.crc.replace("0x", ""),
                fnumber: meta.fnumber
            });
        }
    }
    return runtime.vpkIndex;
}

export async function decompileItemDefinitionResources(runtime: Cs2Runtime) {
    await runDecompiler(runtime, {
        output: runtime.config.paths.decompiledDir,
        threads: availableParallelism(),
        vpkDecompile: true,
        vpkFilepath: ITEM_DEFINITION_PATHS.join(",")
    });
}

export async function decompileAssets(runtime: Cs2Runtime, vpkPaths: string[], options: DecompileAssetsOptions = {}) {
    if (vpkPaths.length === 0) {
        return;
    }
    const MAX_ARG_BYTES = 100_000;
    let batch: string[] = [];
    let batchBytes = 0;

    async function flush() {
        if (batch.length === 0) {
            return;
        }
        await runDecompiler(runtime, {
            output: runtime.config.paths.decompiledDir,
            threads: availableParallelism(),
            vpkDecompile: true,
            vpkFilepath: batch.join(","),
            ...options
        });
        batch = [];
        batchBytes = 0;
    }

    for (const path of vpkPaths) {
        const decompilerPath = toDecompilerPath(path);
        const length = Buffer.byteLength(decompilerPath) + 1;
        if (batchBytes + length > MAX_ARG_BYTES) {
            await flush();
        }
        batch.push(decompilerPath);
        batchBytes += length;
    }
    await flush();
}

export async function decompileModelAssets(runtime: Cs2Runtime, vpkPaths: string[]) {
    await decompileAssets(runtime, vpkPaths, {
        gltfExportFormat: "glb",
        gltfExportMaterials: true
    });
}

export async function decompileDataBlocks(runtime: Cs2Runtime, vpkPaths: string[], threads = 1) {
    return await runDecompiler(runtime, {
        block: "DATA",
        threads,
        vpkFilepath: vpkPaths.join(",")
    });
}
