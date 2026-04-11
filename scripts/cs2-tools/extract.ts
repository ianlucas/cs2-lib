/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { basename } from "path";
import { CS2KeyValues3 } from "../../src/keyvalues3.ts";
import {
    getCompositeMaterialFilename,
    getVmatFilename,
    normalizeMaterialResourcePath,
    toCompiledMaterialResourcePath
} from "../item-generator/assets/material-paths.ts";
import { decompileDataBlocks } from "./decompile.ts";
import {
    CompositeMaterialMetadataExtractionResult,
    Cs2Runtime,
    MaterialMetadataExtractionResult,
    ModelMetadataEntry,
    ModelMetadataExtractionResult
} from "./types.ts";

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

function buildChunkByPathMap(stdout: string) {
    const map = new Map<string, string>();
    for (const chunk of stdout.split(/(?=\[\d+\/\d+\])/)) {
        const match = chunk.match(/^\[\d+\/\d+\]\s+([^\r\n]+)/);
        if (match !== null) {
            map.set(match[1].trim(), chunk);
        }
    }
    return map;
}

function collectResourceRefs(data: string, extension: ".vcompmat" | ".vmat" | ".vtex") {
    return [...data.matchAll(/"([^"]+\.(?:vcompmat|vmat|vtex))"/g)]
        .map((match) => normalizeMaterialResourcePath(match[1]))
        .filter((path) => path.endsWith(extension));
}

export async function extractModelMetadata(runtime: Cs2Runtime, entries: ModelMetadataEntry[]) {
    const MAX_ARG_BYTES = 100_000;
    const results: ModelMetadataExtractionResult[] = [];
    let batchEntries: ModelMetadataEntry[] = [];
    let batchBytes = 0;

    async function flush() {
        if (batchEntries.length === 0) {
            return;
        }
        const stdout = await decompileDataBlocks(
            runtime,
            batchEntries.map((entry) => entry.vpkPath)
        );
        const chunksByPath = buildChunkByPathMap(stdout);
        for (const entry of batchEntries) {
            const chunk = chunksByPath.get(entry.vpkPath) ?? "";
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
    }

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

export async function extractCompositeMaterialMetadata(runtime: Cs2Runtime, vcompmatPaths: string[]) {
    const MAX_ARG_BYTES = 100_000;
    const results: CompositeMaterialMetadataExtractionResult[] = [];
    const entries = vcompmatPaths.map((path) => ({
        vcompmatPath: normalizeMaterialResourcePath(path),
        vpkPath: toCompiledMaterialResourcePath(path)
    }));
    let batchEntries = [] as typeof entries;
    let batchBytes = 0;

    async function flush() {
        if (batchEntries.length === 0) {
            return;
        }
        const missing = batchEntries.filter((entry) => !runtime.vpkIndex.has(entry.vpkPath));
        if (missing.length > 0) {
            throw new Error(`VPK entry not found: ${missing.map((entry) => entry.vpkPath).join(", ")}`);
        }
        const stdout = await decompileDataBlocks(
            runtime,
            batchEntries.map((entry) => entry.vpkPath)
        );
        const chunksByPath = buildChunkByPathMap(stdout);
        for (const entry of batchEntries) {
            const chunk = chunksByPath.get(entry.vpkPath) ?? "";
            const dataMatch = chunk.match(/--- Data for block "DATA" ---\s*([\s\S]+)$/);
            let data: any = null;
            const compositeMaterialRefs: string[] = [];
            const vmatRefs: string[] = [];
            if (dataMatch) {
                const dataText = dataMatch[1].trim();
                data = parseKv3Recursively(CS2KeyValues3.parse(dataText));
                compositeMaterialRefs.push(...collectResourceRefs(dataText, ".vcompmat"));
                vmatRefs.push(...collectResourceRefs(dataText, ".vmat"));
            }
            const crc = runtime.vpkIndex.get(entry.vpkPath)!.crc;
            results.push({
                compositeMaterialRefs,
                data,
                filename: getCompositeMaterialFilename(entry.vcompmatPath, crc),
                vcompmatPath: entry.vcompmatPath,
                vmatRefs
            });
        }
        batchEntries = [];
        batchBytes = 0;
    }

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
        .map((path) => ({ vmatPath: normalizeMaterialResourcePath(path), vpkPath: toCompiledMaterialResourcePath(path) }))
        .filter((entry) => runtime.vpkIndex.has(entry.vpkPath));
    let batchEntries = [] as typeof entries;
    let batchBytes = 0;

    async function flush() {
        if (batchEntries.length === 0) {
            return;
        }
        const stdout = await decompileDataBlocks(
            runtime,
            batchEntries.map((entry) => entry.vpkPath)
        );
        const chunksByPath = buildChunkByPathMap(stdout);
        for (const entry of batchEntries) {
            const chunk = chunksByPath.get(entry.vpkPath) ?? "";
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
                const dataText = dataMatch[1].trim();
                data = parseKv3Recursively(CS2KeyValues3.parse(dataText));
                vmatRefs.push(...collectResourceRefs(dataText, ".vmat"));
            }
            const crc = runtime.vpkIndex.get(entry.vpkPath)!.crc;
            results.push({
                data,
                filename: getVmatFilename(entry.vmatPath, crc),
                vmatPath: entry.vmatPath,
                vmatRefs,
                vtexRefs
            });
        }
        batchEntries = [];
        batchBytes = 0;
    }

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
