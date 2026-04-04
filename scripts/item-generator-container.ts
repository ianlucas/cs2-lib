/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ensure } from "../src/utils.ts";
import { log, warning } from "./utils.ts";

const CRATES_URL = "https://raw.githubusercontent.com/ByMykel/CSGO-API/refs/heads/main/public/api/en/crates.json";

interface CrateEntry {
    contains: { name: string; id: string }[];
    contains_rare: { name: string; id: string }[];
    original: { item_name: string };
}

export class ContainerHelper {
    private nameToId: Map<string, number>;
    private cache: CrateEntry[] | undefined;

    constructor(itemNames: Map<number, string>) {
        this.nameToId = new Map(Array.from(itemNames.entries()).map(([id, name]) => [name, id]));
    }

    private resolveId({ id, name }: { id: string; name: string }): number | undefined {
        return (
            this.nameToId.get(id) ??
            this.nameToId.get(id.replace("_st", "")) ??
            this.nameToId.get(name) ??
            this.nameToId.get(name.replace("★ ", ""))
        );
    }

    private async fetchCrates(): Promise<CrateEntry[]> {
        if (this.cache !== undefined) {
            return this.cache;
        }
        const response = await fetch(CRATES_URL);
        this.cache = (await response.json()) as CrateEntry[];
        return this.cache;
    }

    private findCrate(itemName: string, crates: CrateEntry[]): CrateEntry | undefined {
        return crates.find((c) => c.original.item_name === itemName);
    }

    async populateContents(itemName: string, contents: number[]): Promise<void> {
        const crates = await this.fetchCrates();
        const crate = this.findCrate(itemName, crates);
        if (crate === undefined) {
            warning(`ContainerHelper: container not found in source for ${itemName}`);
            return;
        }
        let added = 0;
        for (const item of crate.contains) {
            const id = ensure(this.resolveId(item), `ContainerHelper: failed to find "${item.name}" in parsed items.`);
            if (!contents.includes(id)) {
                contents.push(id);
                added++;
            }
        }
        if (added > 0) {
            log(`ContainerHelper: added ${added} missing item(s) to ${itemName}`);
        }
    }

    async populateSpecials(itemName: string, specials: number[]): Promise<void> {
        const crates = await this.fetchCrates();
        const crate = this.findCrate(itemName, crates);
        if (crate === undefined) {
            return;
        }
        let added = 0;
        for (const item of crate.contains_rare) {
            const id = ensure(this.resolveId(item), `ContainerHelper: failed to find "${item.name}" in parsed items.`);
            if (!specials.includes(id)) {
                specials.push(id);
                added++;
            }
        }
        if (added > 0) {
            log(`ContainerHelper: added ${added} special(s) to ${itemName}`);
        }
    }
}
