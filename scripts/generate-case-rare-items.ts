/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Ideally we should be able to obtain this information from some game file, but
// as I couldn't find it, we will be using some external sources to identify the
// rare items in all cases.

import fetch from "node-fetch";
import { CS_Item } from "../src/economy";

const spacerulerwill_CS2_API_URL = "https://spacerulerwill.github.io/CS2-API/api/cases.json";

interface SpacerulerwillCS2APIResponse {
    [caseKey: string]: {
        formattedName: string;
        skins: {
            "rare-item"?: string[];
        };
    };
}

export class CaseRareItems {
    cases: Record<string, string[]> = {};
    populated: Record<string, number[]> = {};

    async fetch() {
        console.warn("fetching case rare items dependency...");
        const response = (await (await fetch(spacerulerwill_CS2_API_URL)).json()) as SpacerulerwillCS2APIResponse;
        for (const caseProps of Object.values(response)) {
            if (!caseProps.skins["rare-item"] || caseProps.skins["rare-item"].length === 0) {
                continue;
            }
            this.cases[caseProps.formattedName] = caseProps.skins["rare-item"];
        }
        console.warn("fetch successful.");
    }

    populate(baseItems: CS_Item[], generatedItems: CS_Item[]) {
        const rareItems: Record<string, number> = {};
        for (const item of [...baseItems, ...generatedItems]) {
            if (["melee", "glove"].includes(item.type)) {
                const rareItemKey = item.base
                    ? `${item.name} vanilla`.toLowerCase()
                    : item.name
                          .replace(" | ", " ")
                          .replace(/[^\d\w\s]/g, "")
                          .toLowerCase();
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
