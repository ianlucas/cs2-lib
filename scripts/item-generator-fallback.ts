/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { writeFile } from "fs/promises";
import { basename, join } from "path";
import { assert, ensure } from "../src/utils.ts";
import { SCRIPTS_DIR } from "./cs2.ts";

const sources = {
    // { image: string; original: { image_inventory: string; } }
    collectible: "https://raw.githubusercontent.com/ByMykel/CSGO-API/refs/heads/main/public/api/en/collectibles.json",
    container: "https://raw.githubusercontent.com/ByMykel/CSGO-API/refs/heads/main/public/api/en/crates.json",
    keychain: "https://raw.githubusercontent.com/ByMykel/CSGO-API/refs/heads/main/public/api/en/sticker_slabs.json"
};

type SourceKey = keyof typeof sources;

interface SourceEntry {
    image: string;
    original: { image_inventory: string };
}

export class FallbackImageHelper {
    private cache = new Map<SourceKey, SourceEntry[]>();

    private async fetchSource(source: SourceKey): Promise<SourceEntry[]> {
        if (this.cache.has(source)) {
            return ensure(this.cache.get(source));
        }
        const response = await fetch(sources[source]);
        const data = (await response.json()) as SourceEntry[];
        this.cache.set(source, data);
        return data;
    }

    async find(source: SourceKey, imagePath: string): Promise<string | undefined> {
        const normalizedPath = imagePath.toLowerCase();
        const entries = await this.fetchSource(source);
        const entry = entries.find((e) => e.original.image_inventory.toLowerCase() === normalizedPath);
        if (entry === undefined) {
            return undefined;
        }
        const filename = `${basename(imagePath)}.png`;
        const localPath = join(SCRIPTS_DIR, "images", filename);
        const response = await fetch(entry.image);
        if (response.status === 404) {
            return undefined;
        }
        assert(response.ok, `FallbackImageSource: failed to download ${entry.image}`);
        const buffer = Buffer.from(await response.arrayBuffer());
        await writeFile(localPath, buffer);
        return localPath;
    }
}
