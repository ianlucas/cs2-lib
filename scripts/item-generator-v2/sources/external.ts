/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mkdir, writeFile } from "fs/promises";
import { basename, join } from "path";
import { assert, ensure } from "../../../src/utils.ts";
import { readFileOrDefault } from "../../utils.ts";
import { STATIC_IMAGES_DIR, V2_CACHE_DIR } from "../config.ts";
import { ExternalCacheMetadata } from "../types.ts";

const EXTERNAL_URLS = {
    collectible: "https://raw.githubusercontent.com/ByMykel/CSGO-API/refs/heads/main/public/api/en/collectibles.json",
    container: "https://raw.githubusercontent.com/ByMykel/CSGO-API/refs/heads/main/public/api/en/crates.json",
    keychain: "https://raw.githubusercontent.com/ByMykel/CSGO-API/refs/heads/main/public/api/en/sticker_slabs.json"
} as const;

type ExternalSourceKey = keyof typeof EXTERNAL_URLS;

type SourceEntry = {
    image: string;
    original: { image_inventory: string };
};

type CrateEntry = {
    contains: { name: string; id: string }[];
    contains_rare: { name: string; id: string }[];
    original: { item_name: string };
};

function getCachePaths(key: ExternalSourceKey) {
    return {
        dataPath: join(V2_CACHE_DIR, `${key}.json`),
        metadataPath: join(V2_CACHE_DIR, `${key}.metadata.json`)
    };
}

export async function fetchCachedExternalJson<T>(key: ExternalSourceKey): Promise<T> {
    const url = EXTERNAL_URLS[key];
    const { dataPath, metadataPath } = getCachePaths(key);
    await mkdir(V2_CACHE_DIR, { recursive: true });
    const metadataRaw = await readFileOrDefault(metadataPath, "");
    const metadata = metadataRaw.length > 0 ? (JSON.parse(metadataRaw) as ExternalCacheMetadata) : undefined;
    const headers = new Headers();
    if (metadata?.etag) {
        headers.set("If-None-Match", metadata.etag);
    }
    if (metadata?.lastModified) {
        headers.set("If-Modified-Since", metadata.lastModified);
    }
    try {
        const response = await fetch(url, { headers });
        if (response.status === 304) {
            return JSON.parse(await readFileOrDefault(dataPath, "null")) as T;
        }
        assert(response.ok, `Failed to fetch ${url}: ${response.status}`);
        const body = await response.text();
        await writeFile(dataPath, body, "utf-8");
        const nextMetadata: ExternalCacheMetadata = {
            etag: response.headers.get("etag") ?? undefined,
            lastModified: response.headers.get("last-modified") ?? undefined,
            url
        };
        await writeFile(metadataPath, JSON.stringify(nextMetadata), "utf-8");
        return JSON.parse(body) as T;
    } catch (error) {
        const cached = await readFileOrDefault(dataPath, "");
        if (cached.length > 0) {
            return JSON.parse(cached) as T;
        }
        throw error;
    }
}

function resolveContainerItemId(nameToId: Map<string, number>, item: { id: string; name: string }) {
    return (
        nameToId.get(item.id) ??
        nameToId.get(item.id.replace("_st", "")) ??
        nameToId.get(item.name) ??
        nameToId.get(item.name.replace("★ ", ""))
    );
}

export async function populateContainerContents(itemName: string, contents: number[], itemNames: Map<number, string>) {
    const crates = await fetchCachedExternalJson<CrateEntry[]>("container");
    const crate = crates.find((entry) => entry.original.item_name === itemName);
    if (crate === undefined) {
        return;
    }
    const nameToId = new Map(Array.from(itemNames.entries()).map(([id, name]) => [name, id]));
    for (const item of crate.contains) {
        const id = ensure(resolveContainerItemId(nameToId, item));
        if (!contents.includes(id)) {
            contents.push(id);
        }
    }
}

export async function populateContainerSpecials(itemName: string, specials: number[], itemNames: Map<number, string>) {
    const crates = await fetchCachedExternalJson<CrateEntry[]>("container");
    const crate = crates.find((entry) => entry.original.item_name === itemName);
    if (crate === undefined) {
        return;
    }
    const nameToId = new Map(Array.from(itemNames.entries()).map(([id, name]) => [name, id]));
    for (const item of crate.contains_rare) {
        const id = ensure(resolveContainerItemId(nameToId, item));
        if (!specials.includes(id)) {
            specials.push(id);
        }
    }
}

export async function findFallbackImage(source: ExternalSourceKey, imagePath: string) {
    const entries = await fetchCachedExternalJson<SourceEntry[]>(source);
    const normalizedPath = imagePath.toLowerCase();
    const entry = entries.find((candidate) => candidate.original.image_inventory.toLowerCase() === normalizedPath);
    if (entry === undefined) {
        return undefined;
    }
    const response = await fetch(entry.image);
    if (response.status === 404) {
        return undefined;
    }
    assert(response.ok, `Failed to download fallback image: ${entry.image}`);
    const filename = `${basename(imagePath)}.png`;
    const localPath = join(STATIC_IMAGES_DIR, filename);
    await writeFile(localPath, Buffer.from(await response.arrayBuffer()));
    return localPath;
}
