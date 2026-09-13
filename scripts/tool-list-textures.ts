/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Lists every material (and every material it transitively references) used by a single item,
// together with each material's texture parameters and the on-disk size of each texture. Handy
// for scoping texture-optimization work to one item without re-running the whole item-generator.
//
// Doubles as a module: the helpers below are exported so a future tool can resolve an item, resolve
// its root materials and walk them without shelling out. `main` only runs when this file is the
// process entrypoint, so importing it has no side effects beyond loading the economy on demand.
//
// Usage:
//   npx tsx scripts/tool-list-textures.ts <item-id-or-name> [outputDir]
//
// Examples:
//   npx tsx scripts/tool-list-textures.ts 215
//   npx tsx scripts/tool-list-textures.ts "AK-47 | Case Hardened"
//   npx tsx scripts/tool-list-textures.ts "AK-47 | Case Hardened" .unoptimized-output

import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { basename, dirname, join } from "path";
import { CS2Economy, type CS2EconomyItem } from "../src/economy.ts";
import { CS2_ITEMS } from "../src/items.ts";
import { english } from "../src/translations/english.ts";
import { log, shouldRun } from "./utils.ts";

export const DEFAULT_OUTPUT_DIR = ".unoptimized-output";

const isTextureRef = (value: string): boolean => /^\/textures\/.+\.(webp|exr)$/.test(value);
const isMaterialRef = (value: string): boolean => /^\/materials\/.+\.(vmat|vcompmat)\.json$/.test(value);
const asName = (value: unknown): string | undefined =>
    typeof value === "string" && value.length > 0 ? value : undefined;

export interface TextureRef {
    property: string;
    path: string;
}

interface Gltf {
    meshes?: { name?: string; primitives?: { material?: number }[] }[];
    materials?: { name?: string }[];
}

// Strip cs2-lib's output hash (`_<8 hex>` before the extension) so the same source texture maps to
// one key even if its encoded bytes - and therefore its cs2-lib hash - ever change.
export function toVrfIdentity(texturePath: string): string {
    return texturePath.replace(/_[0-9a-f]{8}(\.(?:webp|exr))$/, "$1");
}

// Resolve a `/materials/...`, `/textures/...` or `/models/...` resource to an on-disk file under
// `outputDir`, tolerating a different output hash than the one cs2-lib recorded (e.g. `.prd-output`
// re-encodes its own bytes): if the exact file is absent, fall back to any sibling whose name
// matches once the trailing `_<8 hex>` hash is stripped.
export function resolveOutputFile(outputDir: string, resourcePath: string): string | undefined {
    const direct = join(outputDir, resourcePath.replace(/^\//, ""));
    if (existsSync(direct)) return direct;
    const dir = dirname(direct);
    const match = basename(direct).match(/^(.*)_[0-9a-f]{8}(\..+)$/);
    if (match === null || !existsSync(dir)) return undefined;
    const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`^${escape(match[1]!)}_[0-9a-f]{8}${escape(match[2]!)}$`);
    const sibling = readdirSync(dir).find((entry) => pattern.test(entry));
    return sibling === undefined ? undefined : join(dir, sibling);
}

export function humanSize(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}K`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
}

// A weapon/knife GLB embeds one mesh per variant -- `.body_hd` and/or `.body_legacy` -- and the
// item's `isLegacyModel` flag decides which one the game renders. Each mesh primitive names a glTF
// material (e.g. `weapon_rif_ak47_6a98526d`), and that name is a `/materials/<name>.vmat.json`
// resource whose texture params point at the real `/textures/*.webp` files (the images embedded in
// the GLB itself are runtime stubs of a few bytes, so we ignore them). A base weapon with no paint
// kit therefore gets its textures from here; a painted skin uses its paint-kit material instead.

// GLB container: 12-byte header then length-prefixed chunks; the first chunk is the glTF JSON.
function readGlbJson(file: string): Gltf | undefined {
    const buffer = readFileSync(file);
    if (buffer.length < 20 || buffer.readUInt32LE(0) !== 0x46546c67) return undefined;
    const chunkLength = buffer.readUInt32LE(12);
    const json = buffer.subarray(20, 20 + chunkLength).toString("utf-8");
    try {
        return JSON.parse(json) as Gltf;
    } catch {
        return undefined;
    }
}

// Pick the mesh(es) the game renders for this item's model variant. Weapons/knives carry a
// `.body_hd` and/or `.body_legacy` mesh; `isLegacyModel` selects between them (falling back to
// whichever variant exists). Models with no hd/legacy split (gloves, keychains) contribute all of
// their non-hidden meshes.
function selectMeshes(gltf: Gltf, isLegacy: boolean): NonNullable<Gltf["meshes"]> {
    const meshes = (gltf.meshes ?? []).filter((mesh) => !(mesh.name ?? "").includes("hidden"));
    const legacy = meshes.filter((mesh) => (mesh.name ?? "").includes("legacy"));
    const hd = meshes.filter((mesh) => (mesh.name ?? "").includes("hd"));
    if (legacy.length > 0 || hd.length > 0) {
        const preferred = isLegacy ? legacy : hd;
        const fallback = isLegacy ? hd : legacy;
        return preferred.length > 0 ? preferred : fallback;
    }
    return meshes;
}

// The `/materials/<name>.vmat.json` resource paths bound by the rendered model variant, in mesh
// order and deduped.
export function collectModelMaterials(modelFile: string, isLegacy: boolean): string[] {
    const gltf = readGlbJson(modelFile);
    if (gltf === undefined) return [];
    const materials = gltf.materials ?? [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const mesh of selectMeshes(gltf, isLegacy)) {
        for (const primitive of mesh.primitives ?? []) {
            const name = primitive.material === undefined ? undefined : materials[primitive.material]?.name;
            if (name === undefined) continue;
            const resourcePath = `/materials/${name}.vmat.json`;
            if (seen.has(resourcePath)) continue;
            seen.add(resourcePath);
            out.push(resourcePath);
        }
    }
    return out;
}

// The material roots to walk for an item: its paint-kit material (when painted) plus the materials
// its model binds for the rendered hd/legacy variant. Both matter: a painted skin composites its
// pattern over the model's base body textures (e.g. a legacy skin still ships `ak47_color_psd`), and
// a base/vanilla weapon has only the model materials. Shared sub-materials are deduped by the
// caller's material walk, so listing both here never double-counts a texture.
export function resolveRootMaterials(item: CS2EconomyItem, outputDir: string): string[] {
    const roots: string[] = [];
    const paint = item.materialPath ?? item.parent?.materialPath;
    if (paint !== undefined) roots.push(paint);
    const modelPath = item.modelPath ?? item.parent?.modelPath;
    if (modelPath !== undefined) {
        const modelFile = resolveOutputFile(outputDir, modelPath);
        if (modelFile !== undefined) {
            const isLegacy = item.isLegacyModel ?? item.parent?.isLegacyModel ?? false;
            roots.push(...collectModelMaterials(modelFile, isLegacy));
        }
    }
    return roots;
}

export function resolveItem(query: string): CS2EconomyItem {
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
export function walk(
    value: unknown,
    contextName: string | undefined,
    textures: TextureRef[],
    materials: string[]
): void {
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
    // A painted skin walks its paint-kit material; a base/vanilla weapon or knife has none, so it
    // walks the materials its model (`.glb`) binds for the rendered hd/legacy variant instead.
    const rootMaterials = resolveRootMaterials(item, outputDir);
    if (rootMaterials.length === 0) {
        throw new Error(`Item ${item.id} (${item.name}) has no material.`);
    }
    console.error(`# item ${item.id}: ${item.name}`);
    console.error(`# material: ${rootMaterials.join(", ")}`);
    console.error(`# output: ${outputDir}`);

    const visited = new Set<string>();
    const visitedFiles = new Set<string>();
    const uniqueTextures = new Map<string, number>();
    let missingTextures = 0;
    const blocks: { material: string; found: boolean; rows: (TextureRef & { size: string })[] }[] = [];

    // Depth-first, pre-order: collect each material with its textures, then descend into the
    // materials it references. `visited` records each material path once and breaks reference cycles;
    // `visitedFiles` additionally collapses paths that resolve to the same on-disk file, so a material
    // that references itself by its `.prd-output` hash isn't listed twice.
    const stack: string[] = [...rootMaterials].reverse();
    while (stack.length > 0) {
        const materialPath = stack.pop()!;
        if (visited.has(materialPath)) continue;
        visited.add(materialPath);

        const file = resolveOutputFile(outputDir, materialPath);
        if (file === undefined) {
            blocks.push({ material: materialPath, found: false, rows: [] });
            continue;
        }
        if (visitedFiles.has(file)) continue;
        visitedFiles.add(file);

        const textures: TextureRef[] = [];
        const materials: string[] = [];
        walk(JSON.parse(readFileSync(file, "utf-8")), undefined, textures, materials);

        const rows: (TextureRef & { size: string })[] = [];
        const seenLines = new Set<string>();
        for (const { property, path } of textures) {
            const dedupeKey = `${property}\t${path}`;
            if (seenLines.has(dedupeKey)) continue;
            seenLines.add(dedupeKey);

            const texFile = resolveOutputFile(outputDir, path);
            let size = "?";
            if (texFile !== undefined) {
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
        `# ${blocks.length} materials, ${uniqueTextures.size} unique textures, ${humanSize(totalBytes)} total` +
            (missingTextures > 0 ? ` (${missingTextures} texture file(s) missing)` : "")
    );
}

if (shouldRun(import.meta.url)) {
    try {
        main();
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    }
}
