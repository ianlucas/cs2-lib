/*---------------------------------------------------------------------------------------------
 *  Per-material-property texture size table across ALL stickers. For each property the shader
 *  binds, reports how many stickers use it and the average bytes it contributes per sticker
 *  (textures deduped within a sticker, mirroring the per-item metric). Pass two output dirs to
 *  see before/after side by side.
 *
 *  Usage: npx tsx scripts/tool-sticker-property-avg.ts [afterDir] [beforeDir]
 *         defaults: afterDir=scripts/workdir/output  beforeDir=.unoptimized-output
 *--------------------------------------------------------------------------------------------*/

import { existsSync, readFileSync, statSync } from "fs";
import { basename, dirname, join } from "path";
import { readdirSync } from "fs";
import { CS2Economy, type CS2EconomyItem } from "../src/economy.ts";
import { CS2_ITEMS } from "../src/items.ts";
import { english } from "../src/translations/english.ts";

const afterDir = process.argv[2] ?? "scripts/workdir/output";
const beforeDir = process.argv[3] ?? ".unoptimized-output";

const isTextureRef = (value: string): boolean => /^\/textures\/.+\.(webp|exr)$/.test(value);
const isMaterialRef = (value: string): boolean => /^\/materials\/.+\.(vmat|vcompmat)\.json$/.test(value);
const asName = (value: unknown): string | undefined =>
    typeof value === "string" && value.length > 0 ? value : undefined;

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

// For every sticker, the set of (property, texture-path) pairs its material tree references. Walk
// materials from `.unoptimized-output` (structure is identical to workdir) so the attribution is
// stable; sizes are then read from whichever output dir we are measuring.
function collectStickerRefs(item: CS2EconomyItem): TextureRef[] {
    const root = item.materialPath ?? item.parent?.materialPath;
    if (root === undefined) return [];
    const visited = new Set<string>();
    const stack = [root];
    const out: TextureRef[] = [];
    const seen = new Set<string>();
    while (stack.length > 0) {
        const materialPath = stack.pop()!;
        if (visited.has(materialPath)) continue;
        visited.add(materialPath);
        const file = resolveOutputFile(beforeDir, materialPath);
        if (file === undefined) continue;
        const textures: TextureRef[] = [];
        const materials: string[] = [];
        walk(JSON.parse(readFileSync(file, "utf-8")), undefined, textures, materials);
        for (const ref of textures) {
            const key = `${ref.property}\t${ref.path}`;
            if (!seen.has(key)) {
                seen.add(key);
                out.push(ref);
            }
        }
        for (const m of new Set(materials)) if (!visited.has(m)) stack.push(m);
    }
    return out;
}

CS2Economy.load({ items: CS2_ITEMS, language: english });
const stickers = [...CS2Economy.items.values()].filter((item) => item.isSticker());

interface Agg {
    stickers: number;
    beforeBytes: number;
    afterBytes: number;
}
const byProp = new Map<string, Agg>();

for (const sticker of stickers) {
    const refs = collectStickerRefs(sticker);
    // Dedupe textures within a sticker (one contribution each), attributed to their property.
    const perProp = new Map<string, { before: number; after: number }>();
    for (const { property, path } of refs) {
        const bf = resolveOutputFile(beforeDir, path);
        const af = resolveOutputFile(afterDir, path);
        const before = bf === undefined ? 0 : statSync(bf).size;
        const after = af === undefined ? 0 : statSync(af).size;
        const cur = perProp.get(property) ?? { before: 0, after: 0 };
        cur.before += before;
        cur.after += after;
        perProp.set(property, cur);
    }
    for (const [property, { before, after }] of perProp) {
        const agg = byProp.get(property) ?? { stickers: 0, beforeBytes: 0, afterBytes: 0 };
        agg.stickers++;
        agg.beforeBytes += before;
        agg.afterBytes += after;
        byProp.set(property, agg);
    }
}

const K = 1024;
console.log(`after=${afterDir}  before=${beforeDir}`);
console.log("");
console.log("| Property | Stickers | Avg before | Avg after | Change |");
console.log("| --- | --- | --- | --- | --- |");
for (const [property, agg] of [...byProp].sort((a, b) => b[1].afterBytes - a[1].afterBytes)) {
    const avgBefore = agg.beforeBytes / agg.stickers / K;
    const avgAfter = agg.afterBytes / agg.stickers / K;
    const change = agg.beforeBytes > 0 ? (1 - agg.afterBytes / agg.beforeBytes) * 100 : 0;
    console.log(
        `| ${property} | ${agg.stickers} | ${avgBefore.toFixed(0)}K | ${avgAfter.toFixed(0)}K | ${change >= 0 ? "-" : "+"}${Math.abs(change).toFixed(0)}% |`
    );
}
