/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Lists every material (and every material it transitively references) used by a single item,
// together with each material's texture parameters and the on-disk size of each texture. Handy
// for scoping texture-optimization work to one item without re-running the whole item-generator.
//
// Usage:
//   npx tsx scripts/tool-list-textures.ts <item-id-or-name> [outputDir]
//
// Examples:
//   npx tsx scripts/tool-list-textures.ts 215
//   npx tsx scripts/tool-list-textures.ts "AK-47 | Case Hardened"
//   npx tsx scripts/tool-list-textures.ts "AK-47 | Case Hardened" .unoptimized-output

import { existsSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { CS2Economy, type CS2EconomyItem } from "../src/economy.ts";
import { CS2_ITEMS } from "../src/items.ts";
import { english } from "../src/translations/english.ts";
import { log } from "./utils.ts";

const DEFAULT_OUTPUT_DIR = ".unoptimized-output";

const isTextureRef = (value: string): boolean => /^\/textures\/.+\.(webp|exr)$/.test(value);
const isMaterialRef = (value: string): boolean => /^\/materials\/.+\.(vmat|vcompmat)\.json$/.test(value);
const asName = (value: unknown): string | undefined =>
    typeof value === "string" && value.length > 0 ? value : undefined;

interface TextureRef {
    property: string;
    path: string;
}

// Strip cs2-lib's output hash (`_<8 hex>` before the extension) so the same source texture maps to
// one key even if its encoded bytes - and therefore its cs2-lib hash - ever change.
function toVrfIdentity(texturePath: string): string {
    return texturePath.replace(/_[0-9a-f]{8}(\.(?:webp|exr))$/, "$1");
}

function humanSize(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}K`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
}

function resolveItem(query: string): CS2EconomyItem {
    CS2Economy.load({ items: CS2_ITEMS, language: english });
    if (/^\d+$/.test(query)) {
        return CS2Economy.getById(Number(query));
    }
    const items = [...CS2Economy.items.values()];
    const exact = items.find((item) => item.name === query);
    if (exact !== undefined) return exact;
    const insensitive = items.find((item) => item.name.toLowerCase() === query.toLowerCase());
    if (insensitive !== undefined) return insensitive;
    const partial = items.filter((item) => item.name.toLowerCase().includes(query.toLowerCase()));
    if (partial.length === 1) return partial[0]!;
    if (partial.length > 1) {
        const preview = partial.slice(0, 10).map((item) => `  ${String(item.id).padEnd(7)}${item.name}`);
        throw new Error(
            `"${query}" matches ${partial.length} items; pass an id or an exact name:\n${preview.join("\n")}` +
                (partial.length > 10 ? "\n  ..." : "")
        );
    }
    throw new Error(`No item found matching "${query}".`);
}

// Walks arbitrary material JSON, collecting texture references (attributed to the enclosing
// parameter's `m_name`/`m_strName`, mirroring the generator's own attribution) and references to
// other materials. `contextName` carries the nearest enclosing parameter name down to scalar
// values so a texture sitting under `m_pValue`/`m_strTextureRuntimeResourcePath` is named correctly.
function walk(value: unknown, contextName: string | undefined, textures: TextureRef[], materials: string[]): void {
    if (typeof value === "string") {
        if (isTextureRef(value)) {
            textures.push({ property: contextName ?? "(unnamed)", path: value });
        } else if (isMaterialRef(value)) {
            materials.push(value);
        }
        return;
    }
    if (Array.isArray(value)) {
        for (const entry of value) {
            walk(entry, contextName, textures, materials);
        }
        return;
    }
    if (value !== null && typeof value === "object") {
        const record = value as Record<string, unknown>;
        const name = asName(record.m_name) ?? asName(record.m_strName) ?? contextName;
        for (const [key, child] of Object.entries(record)) {
            walk(child, name ?? key, textures, materials);
        }
    }
}

function main(): void {
    const [, , query, outputDirArg] = process.argv;
    if (query === undefined) {
        log(
            "Usage: npx tsx scripts/tool-list-textures.ts <item-id-or-name> [outputDir]\n" +
                `       (outputDir defaults to ${DEFAULT_OUTPUT_DIR})`
        );
        process.exitCode = 1;
        return;
    }
    const outputDir = outputDirArg ?? DEFAULT_OUTPUT_DIR;

    const item = resolveItem(query);
    const rootMaterial = item.materialPath ?? item.parent?.materialPath;
    if (rootMaterial === undefined) {
        throw new Error(`Item ${item.id} (${item.name}) has no material.`);
    }
    console.error(`# item ${item.id}: ${item.name}`);
    console.error(`# material: ${rootMaterial}`);
    console.error(`# output: ${outputDir}`);

    const visited = new Set<string>();
    const uniqueTextures = new Map<string, number>();
    let missingTextures = 0;
    const blocks: { material: string; found: boolean; rows: (TextureRef & { size: string })[] }[] = [];

    // Depth-first, pre-order: collect each material with its textures, then descend into the
    // materials it references. `visited` records each material once and breaks reference cycles.
    const stack: string[] = [rootMaterial];
    while (stack.length > 0) {
        const materialPath = stack.pop()!;
        if (visited.has(materialPath)) continue;
        visited.add(materialPath);

        const file = join(outputDir, materialPath.replace(/^\//, ""));
        if (!existsSync(file)) {
            blocks.push({ material: materialPath, found: false, rows: [] });
            continue;
        }

        const textures: TextureRef[] = [];
        const materials: string[] = [];
        walk(JSON.parse(readFileSync(file, "utf-8")), undefined, textures, materials);

        const rows: (TextureRef & { size: string })[] = [];
        const seenLines = new Set<string>();
        for (const { property, path } of textures) {
            const dedupeKey = `${property}\t${path}`;
            if (seenLines.has(dedupeKey)) continue;
            seenLines.add(dedupeKey);

            const texFile = join(outputDir, path.replace(/^\//, ""));
            let size = "?";
            if (existsSync(texFile)) {
                const bytes = statSync(texFile).size;
                size = humanSize(bytes);
                uniqueTextures.set(toVrfIdentity(path), bytes);
            } else {
                missingTextures++;
            }
            rows.push({ property, path, size });
        }
        blocks.push({ material: materialPath, found: true, rows });

        // Reverse so that, once popped off the stack, children are visited in document order.
        const nextMaterials = [...new Set(materials)].filter((path) => !visited.has(path));
        for (let i = nextMaterials.length - 1; i >= 0; i--) {
            stack.push(nextMaterials[i]!);
        }
    }

    // Pad to widths measured across every material, so the columns line up over the whole listing
    // rather than resetting per block.
    let propWidth = 0;
    let pathWidth = 0;
    for (const { rows } of blocks) {
        for (const row of rows) {
            propWidth = Math.max(propWidth, row.property.length);
            pathWidth = Math.max(pathWidth, row.path.length);
        }
    }
    blocks.forEach(({ material, found, rows }, index) => {
        if (index > 0) log("");
        log(material);
        if (!found) {
            log("  (material file not found)");
            return;
        }
        for (const { property, path, size } of rows) {
            log(`${property.padEnd(propWidth)}  ${path.padEnd(pathWidth)}  ${size}`);
        }
    });

    const totalBytes = [...uniqueTextures.values()].reduce((sum, bytes) => sum + bytes, 0);
    console.error(
        `# ${visited.size} materials, ${uniqueTextures.size} unique textures, ${humanSize(totalBytes)} total` +
            (missingTextures > 0 ? ` (${missingTextures} texture file(s) missing)` : "")
    );
}

try {
    main();
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
}
