/*---------------------------------------------------------------------------------------------
 *  Buckets every sticker by its total unoptimized texture size (per 1MB) and, for the stickers
 *  above 1MB, breaks the bytes down by texture property so we can see what to optimize.
 *
 *  Usage: npx tsx scripts/tool-sticker-sizes.ts [outputDir]
 *--------------------------------------------------------------------------------------------*/

import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { basename, dirname, join } from "path";
import { CS2Economy, type CS2EconomyItem } from "../src/economy.ts";
import { CS2_ITEMS } from "../src/items.ts";
import { english } from "../src/translations/english.ts";

const OUTPUT_DIR = process.argv[2] ?? ".unoptimized-output";

const isTextureRef = (value: string): boolean => /^\/textures\/.+\.(webp|exr)$/.test(value);
const isMaterialRef = (value: string): boolean => /^\/materials\/.+\.(vmat|vcompmat)\.json$/.test(value);
const asName = (value: unknown): string | undefined =>
    typeof value === "string" && value.length > 0 ? value : undefined;

function toVrfIdentity(texturePath: string): string {
    return texturePath.replace(/_[0-9a-f]{8}(\.(?:webp|exr))$/, "$1");
}

function resolveOutputFile(outputDir: string, resourcePath: string): string | undefined {
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

interface TextureRef {
    property: string;
    path: string;
}

function walk(value: unknown, contextName: string | undefined, textures: TextureRef[], materials: string[]): void {
    if (typeof value === "string") {
        if (isTextureRef(value)) textures.push({ property: contextName ?? "(unnamed)", path: value });
        else if (isMaterialRef(value)) materials.push(value);
        return;
    }
    if (Array.isArray(value)) {
        for (const entry of value) walk(entry, contextName, textures, materials);
        return;
    }
    if (value !== null && typeof value === "object") {
        const record = value as Record<string, unknown>;
        const name = asName(record.m_name) ?? asName(record.m_strName) ?? contextName;
        for (const [key, child] of Object.entries(record)) walk(child, name ?? key, textures, materials);
    }
}

// Per-sticker breakdown: total bytes plus bytes attributed to each texture property.
interface Breakdown {
    total: number;
    byProperty: Map<string, number>;
}

function analyze(item: CS2EconomyItem): Breakdown | undefined {
    const rootMaterial = item.materialPath ?? item.parent?.materialPath;
    if (rootMaterial === undefined) return undefined;
    const visited = new Set<string>();
    const visitedFiles = new Set<string>();
    const uniqueTextures = new Map<string, { property: string; bytes: number }>();
    const stack: string[] = [rootMaterial];
    while (stack.length > 0) {
        const materialPath = stack.pop()!;
        if (visited.has(materialPath)) continue;
        visited.add(materialPath);
        const file = resolveOutputFile(OUTPUT_DIR, materialPath);
        if (file === undefined) continue;
        if (visitedFiles.has(file)) continue;
        visitedFiles.add(file);
        const textures: TextureRef[] = [];
        const materials: string[] = [];
        walk(JSON.parse(readFileSync(file, "utf-8")), undefined, textures, materials);
        const seen = new Set<string>();
        for (const { property, path } of textures) {
            const dedupeKey = `${property}\t${path}`;
            if (seen.has(dedupeKey)) continue;
            seen.add(dedupeKey);
            const texFile = resolveOutputFile(OUTPUT_DIR, path);
            if (texFile !== undefined) uniqueTextures.set(toVrfIdentity(path), { property, bytes: statSync(texFile).size });
        }
        for (const path of new Set(materials)) if (!visited.has(path)) stack.push(path);
    }
    const byProperty = new Map<string, number>();
    let total = 0;
    for (const { property, bytes } of uniqueTextures.values()) {
        total += bytes;
        byProperty.set(property, (byProperty.get(property) ?? 0) + bytes);
    }
    return { total, byProperty };
}

CS2Economy.load({ items: CS2_ITEMS, language: english });
const MB = 1024 * 1024;
const stickers = [...CS2Economy.items.values()].filter((item) => item.isSticker());

const sizes: { name: string; total: number; byProperty: Map<string, number> }[] = [];
let missing = 0;
for (const sticker of stickers) {
    const breakdown = analyze(sticker);
    if (breakdown === undefined || breakdown.total === 0) {
        missing++;
        continue;
    }
    sizes.push({ name: sticker.name, ...breakdown });
}

const buckets = new Map<number, number>();
for (const { total } of sizes) {
    const bucket = Math.floor(total / MB); // 0 => <1MB, 1 => 1-2MB, ...
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
}

console.log(`Total stickers analyzed: ${sizes.length} (skipped ${missing} with no/zero textures)`);
console.log("");
console.log("| Size bucket | Count |");
console.log("| --- | --- |");
const maxBucket = Math.max(...buckets.keys());
for (let b = 0; b <= maxBucket; b++) {
    const count = buckets.get(b) ?? 0;
    const label = b === 0 ? "< 1 MB" : `${b}–${b + 1} MB`;
    console.log(`| ${label} | ${count} |`);
}

console.log("");
const heaviest = [...sizes].sort((a, b) => b.total - a.total).slice(0, 10);
console.log("Heaviest 10 stickers:");
for (const { name, total } of heaviest) {
    console.log(`  ${(total / MB).toFixed(2)} MB  ${name}`);
}

// For stickers over 1MB, aggregate bytes per texture property to see what dominates.
const over = sizes.filter((s) => s.total >= MB);
const propTotal = new Map<string, number>();
const propCount = new Map<string, number>();
let overSum = 0;
for (const { byProperty } of over) {
    for (const [property, bytes] of byProperty) {
        propTotal.set(property, (propTotal.get(property) ?? 0) + bytes);
        propCount.set(property, (propCount.get(property) ?? 0) + 1);
        overSum += bytes;
    }
}

console.log("");
console.log(`Texture-property breakdown across the ${over.length} stickers >= 1 MB:`);
console.log("");
console.log("| Property | Total | Share | Stickers | Avg/sticker |");
console.log("| --- | --- | --- | --- | --- |");
for (const [property, bytes] of [...propTotal].sort((a, b) => b[1] - a[1])) {
    const count = propCount.get(property)!;
    const avgK = Math.round(bytes / count / 1024);
    console.log(
        `| ${property} | ${(bytes / MB).toFixed(1)} MB | ${((bytes / overSum) * 100).toFixed(1)}% | ${count} | ${avgK}K |`
    );
}
