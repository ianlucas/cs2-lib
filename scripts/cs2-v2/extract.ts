/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { basename } from "path";
import { CS2KeyValues3 } from "../../src/keyvalues3.ts";
import { decompileDataBlocks } from "./decompile.ts";
import { Cs2Runtime, MaterialMetadataExtractionResult, ModelMetadataEntry, ModelMetadataExtractionResult } from "./types.ts";

function parseKv3Recursively(value: any): any {
    if (typeof value === "string" && value.trimStart().startsWith("<!--")) {
        try {
            return parseKv3Recursively(CS2KeyValues3.parse(value));
        } catch {
            return value;
        }
    }
    if (Array.isArray(value)) {
        return value.map((entry) => parseKv3Recursively(entry));
    }
    if (value !== null && typeof value === "object") {
        return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, parseKv3Recursively(child)]));
    }
    return value;
}

export async function extractModelMetadata(runtime: Cs2Runtime, entries: ModelMetadataEntry[]) {
    const MAX_ARG_BYTES = 100_000;
    const results: ModelMetadataExtractionResult[] = [];
    let batchEntries: ModelMetadataEntry[] = [];
    let batchBytes = 0;

    const flush = async () => {
        if (batchEntries.length === 0) {
            return;
        }
        const stdout = await decompileDataBlocks(runtime, batchEntries.map((entry) => entry.vpkPath));
        const chunks = stdout.split(/(?=\[\d+\/\d+\])/);
        let chunkIndex = 0;
        for (const entry of batchEntries) {
            const chunk = chunks[chunkIndex++] ?? "";
            const materialsMatch = chunk.match(/--- Resource External Refs: ---([\s\S]*?)(?=---|$)/);
            const materials: string[] = [];
            if (materialsMatch) {
                for (const line of materialsMatch[1].split("\n")) {
                    const match = line.match(/\s+[0-9A-F]+\s+(\S+\.vmat)\s*$/);
                    if (match) {
                        materials.push(match[1]);
                    }
                }
            }
            const dataMatch = chunk.match(/--- Data for block "DATA" ---\s*([\s\S]+)$/);
            let data: any = null;
            if (dataMatch) {
                data = parseKv3Recursively(CS2KeyValues3.parse(dataMatch[1].trim()));
            }
            results.push({
                data,
                filename: basename(entry.targetFilename).replace(/\.glb$/, ".json"),
                materials
            });
        }
        batchEntries = [];
        batchBytes = 0;
    };

    for (const entry of entries) {
        const length = Buffer.byteLength(entry.vpkPath) + 1;
        if (batchBytes + length > MAX_ARG_BYTES) {
            await flush();
        }
        batchEntries.push(entry);
        batchBytes += length;
    }
    await flush();
    return results;
}

export async function extractMaterialMetadata(runtime: Cs2Runtime, vmatPaths: string[]) {
    const MAX_ARG_BYTES = 100_000;
    const results: MaterialMetadataExtractionResult[] = [];
    const entries = vmatPaths
        .map((path) => ({ vmatPath: path, vpkPath: path.replace(".vmat", ".vmat_c").toLowerCase() }))
        .filter((entry) => runtime.vpkIndex.has(entry.vpkPath));
    let batchEntries = [] as typeof entries;
    let batchBytes = 0;

    const flush = async () => {
        if (batchEntries.length === 0) {
            return;
        }
        const stdout = await decompileDataBlocks(runtime, batchEntries.map((entry) => entry.vpkPath));
        const chunks = stdout.split(/(?=\[\d+\/\d+\])/);
        let chunkIndex = 0;
        for (const entry of batchEntries) {
            const chunk = chunks[chunkIndex++] ?? "";
            const externalRefsMatch = chunk.match(/--- Resource External Refs: ---([\s\S]*?)(?=---|$)/);
            const vtexRefs: string[] = [];
            if (externalRefsMatch) {
                for (const line of externalRefsMatch[1].split("\n")) {
                    const match = line.match(/\s+[0-9A-F]+\s+(\S+\.vtex)\s*$/);
                    if (match) {
                        vtexRefs.push(match[1]);
                    }
                }
            }
            const dataMatch = chunk.match(/--- Data for block "DATA" ---\s*([\s\S]+)$/);
            let data: any = null;
            const vmatRefs: string[] = [];
            if (dataMatch) {
                data = parseKv3Recursively(CS2KeyValues3.parse(dataMatch[1].trim()));
                for (const match of dataMatch[1].matchAll(/"([^"]+\.vmat)"/g)) {
                    vmatRefs.push(match[1].replace(/\\/g, "/"));
                }
            }
            const crc = runtime.vpkIndex.get(entry.vpkPath)!.crc;
            results.push({
                data,
                filename: `${basename(entry.vmatPath, ".vmat")}_${crc}.vmat.json`,
                vmatPath: entry.vmatPath,
                vmatRefs,
                vtexRefs
            });
        }
        batchEntries = [];
        batchBytes = 0;
    };

    for (const entry of entries) {
        const length = Buffer.byteLength(entry.vpkPath) + 1;
        if (batchBytes + length > MAX_ARG_BYTES) {
            await flush();
        }
        batchEntries.push(entry);
        batchBytes += length;
    }
    await flush();
    return results;
}
