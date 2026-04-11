/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { basename } from "path";
import { ensure } from "../../../src/utils.ts";
import { type Cs2Runtime } from "../../cs2-tools/types.ts";

export type MaterialReferenceResolver = (path: string) => string | undefined;

export function normalizeMaterialResourcePath(path: string): string {
    return path
        .replace(/\\/g, "/")
        .replace(/^resource(?:_name)?:/, "")
        .replace(/\/+/g, "/");
}

export function getPaintCompositeMaterialPath(className: string, compositeMaterialPath?: string): string {
    return compositeMaterialPath ?? `weapons/paints/legacy/${className}.vcompmat`;
}

export function toCompiledMaterialResourcePath(path: string): string {
    const normalized = normalizeMaterialResourcePath(path).toLowerCase();
    if (normalized.endsWith("_c")) {
        return normalized;
    }
    if (normalized.endsWith(".vcompmat") || normalized.endsWith(".vmat") || normalized.endsWith(".vtex")) {
        return `${normalized}_c`;
    }
    return normalized;
}

function toSourceMaterialResourcePath(path: string) {
    return path.endsWith("_c") ? path.slice(0, -2) : path;
}

export function resolveMaterialResourcePath(runtime: Cs2Runtime, path: string): string {
    const compiledPath = toCompiledMaterialResourcePath(path);
    if (runtime.vpkIndex.has(compiledPath)) {
        return toSourceMaterialResourcePath(compiledPath);
    }
    const name = basename(compiledPath);
    const matches = [...runtime.vpkIndex.keys()].filter((candidate) => basename(candidate) === name);
    if (matches.length === 1) {
        return toSourceMaterialResourcePath(matches[0]!);
    }
    if (matches.length > 1) {
        throw new Error(`Ambiguous VPK entry for '${compiledPath}': ${matches.join(", ")}`);
    }
    throw new Error(`VPK entry not found: ${compiledPath}`);
}

export function getCompositeMaterialFilename(vcompmatPath: string, crc: string): string {
    return `${basename(normalizeMaterialResourcePath(vcompmatPath), ".vcompmat")}_${crc}.vcompmat.json`;
}

export function getVmatFilename(vmatPath: string, crc: string): string {
    return `${basename(normalizeMaterialResourcePath(vmatPath), ".vmat")}_${crc}.vmat.json`;
}

export function getTextureFilename(vtexPath: string, crc: string, extension: ".webp" | ".exr"): string {
    return `${basename(normalizeMaterialResourcePath(vtexPath), ".vtex")}_${crc}${extension}`;
}

export function getIndexedCompositeMaterialFilename(runtime: Cs2Runtime, vcompmatPath: string): string {
    const resolvedPath = resolveMaterialResourcePath(runtime, vcompmatPath);
    const vpkPath = toCompiledMaterialResourcePath(resolvedPath);
    const entry = ensure(runtime.vpkIndex.get(vpkPath), `VPK entry not found: ${vpkPath}`);
    return getCompositeMaterialFilename(resolvedPath, entry.crc);
}

export function getIndexedVmatFilename(runtime: Cs2Runtime, vmatPath: string): string {
    const resolvedPath = resolveMaterialResourcePath(runtime, vmatPath);
    const vpkPath = toCompiledMaterialResourcePath(resolvedPath);
    const entry = ensure(runtime.vpkIndex.get(vpkPath), `VPK entry not found: ${vpkPath}`);
    return getVmatFilename(resolvedPath, entry.crc);
}

export function patchMaterialResourceReferences(
    value: unknown,
    resolveCompositeMaterial: MaterialReferenceResolver,
    resolveVmat: MaterialReferenceResolver,
    resolveTexture: MaterialReferenceResolver
): unknown {
    if (typeof value === "string") {
        const normalized = normalizeMaterialResourcePath(value);
        if (normalized.endsWith(".vcompmat")) {
            return ensure(resolveCompositeMaterial(normalized), `Unable to rewrite composite material reference: ${value}`);
        }
        if (normalized.endsWith(".vmat")) {
            return ensure(resolveVmat(normalized), `Unable to rewrite material reference: ${value}`);
        }
        if (normalized.endsWith(".vtex")) {
            return ensure(resolveTexture(normalized), `Unable to rewrite texture reference: ${value}`);
        }
        return value;
    }
    if (Array.isArray(value)) {
        return value.map((entry) =>
            patchMaterialResourceReferences(entry, resolveCompositeMaterial, resolveVmat, resolveTexture)
        );
    }
    if (value !== null && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value).map(([key, child]) => [
                key,
                patchMaterialResourceReferences(child, resolveCompositeMaterial, resolveVmat, resolveTexture)
            ])
        );
    }
    return value;
}
