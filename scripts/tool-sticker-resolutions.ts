/*---------------------------------------------------------------------------------------------
 *  Resolution histogram of sticker textures, per material property. For each target property it
 *  reads the pixel dimensions of the texture every sticker binds and buckets stickers by WxH, so
 *  we can see how many stickers ship a 256² vs 1024² map (informs any downscale decision).
 *
 *  Usage: npx tsx scripts/tool-sticker-resolutions.ts [outputDir] [prop1,prop2,...]
 *         defaults: outputDir=.unoptimized-output  props=g_tHoloSpectrumSticker0
 *--------------------------------------------------------------------------------------------*/

import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { basename, dirname, join } from "path";
import sharp from "sharp";
import { CS2Economy, type CS2EconomyItem } from "../src/economy.ts";
import { CS2_ITEMS } from "../src/items.ts";
import { english } from "../src/translations/english.ts";

const outputDir = process.argv[2] ?? ".unoptimized-output";
const props = (process.argv[3] ?? "g_tHoloSpectrumSticker0").split(",");

const isTextureRef = (value: string): boolean => /^\/textures\/.+\.(webp|exr)$/.test(value);
const isMaterialRef = (value: string): boolean => /^\/materials\/.+\.(vmat|vcompmat)\.json$/.test(value);
const asName = (value: unknown): string | undefined =>
    typeof value === "string" && value.length > 0 ? value : undefined;

function resolveOutputFile(dir: string, resourcePath: string): string | undefined {
    const direct = join(dir, resourcePath.replace(/^\//, ""));
    if (existsSync(direct)) return direct;
    const d = dirname(direct);
    const match = basename(direct).match(/^(.*)_[0-9a-f]{8}(\..+)$/);
    if (match === null || !existsSync(d)) return undefined;
    const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`^${escape(match[1]!)}_[0-9a-f]{8}${escape(match[2]!)}$`);
    const sibling = readdirSync(d).find((entry) => pattern.test(entry));
    return sibling === undefined ? undefined : join(d, sibling);
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

function refsFor(item: CS2EconomyItem): TextureRef[] {
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
        const file = resolveOutputFile(outputDir, materialPath);
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

const dimCache = new Map<string, string>();
async function dimsOf(file: string): Promise<string> {
    if (dimCache.has(file)) return dimCache.get(file)!;
    const meta = await sharp(file).metadata();
    const label = `${meta.width}x${meta.height}`;
    dimCache.set(file, label);
    return label;
}

for (const prop of props) {
    // Count stickers by the resolution of their `prop` texture, and sum bytes for an average.
    const byRes = new Map<string, { count: number; bytes: number }>();
    let count = 0;
    let missing = 0;
    for (const sticker of stickers) {
        const ref = refsFor(sticker).find((r) => r.property === prop);
        if (ref === undefined) {
            missing++;
            continue;
        }
        const file = resolveOutputFile(outputDir, ref.path);
        if (file === undefined) {
            missing++;
            continue;
        }
        const res = await dimsOf(file);
        const agg = byRes.get(res) ?? { count: 0, bytes: 0 };
        agg.count++;
        agg.bytes += statSync(file).size;
        byRes.set(res, agg);
        count++;
    }
    console.log("");
    console.log(`### ${prop}  (${count} stickers bind it, ${missing} do not)`);
    console.log("| Resolution | Stickers | % | Avg size |");
    console.log("| --- | --- | --- | --- |");
    const sorted = [...byRes].sort((a, b) => {
        const area = (s: string) => s.split("x").reduce((p, n) => p * Number(n), 1);
        return area(b[0]) - area(a[0]);
    });
    for (const [res, { count: n, bytes }] of sorted) {
        const avgK = bytes / n / 1024;
        const avg = avgK >= 1024 ? `${(avgK / 1024).toFixed(2)}M` : `${avgK.toFixed(0)}K`;
        console.log(`| ${res} | ${n} | ${((n / count) * 100).toFixed(1)}% | ${avg} |`);
    }
}
