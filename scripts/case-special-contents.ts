/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Looks like it's not possible to obtain this data from the game itself (no
// public way I'm aware of), so we are dumping from csgostash.com or manually
// adding them.

import { CS_Item } from "../src/economy.js";
import { readJson } from "./util.js";

export class CaseSpecialContents {
    cases: Record<string, string[]> = {};
    populated: Record<string, number[]> = {};

    load() {
        this.cases = readJson<typeof this.cases>("assets/data/dump-case-special-contents.json");
    }

    populate(baseItems: CS_Item[], generatedItems: CS_Item[]) {
        const rareItems: Record<string, number> = {};
        for (const item of [...baseItems, ...generatedItems]) {
            if (["melee", "glove"].includes(item.type)) {
                const rareItemKey = item.base ? `${item.name} | ★ (Vanilla)` : item.name;
                rareItems[rareItemKey] = item.id;
            }
        }
        for (const [caseKey, caseItems] of Object.entries(this.cases)) {
            this.populated[caseKey] = caseItems.map((rareItemKey) => {
                const id = rareItems[rareItemKey];
                if (!id) {
                    throw new Error(`item ${rareItemKey} not found.`);
                }
                return id;
            });
        }
    }

    get(caseKey: string) {
        const items = this.populated[caseKey];
        if (!items) {
            console.log(`case ${caseKey} does not have rare items.`);
            return undefined;
        }
        return items;
    }
}
