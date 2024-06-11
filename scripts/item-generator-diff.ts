/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CS2Item } from "../src/economy-types";
import { CS2_ITEMS } from "../src/items";
import { ensure } from "../src/utils";
import { readJson, shouldRun, write } from "./utils";

const repoBaseUrl = "https://raw.githubusercontent.com/ianlucas/cs2-lib/main";

async function fetchFromRepo<T = any>(path: string): Promise<T> {
    return await (await fetch(`${repoBaseUrl}/${path}`)).json();
}

let report = "";
let itemDiffs: string[] = [];

function isDifferent(a: any, b: any) {
    if (Array.isArray(a) && Array.isArray(b)) {
        return a.length !== b.length || a.some((value, index) => value !== b[index]);
    } else if (typeof a === "object" && typeof b === "object") {
        const aKeys = Object.keys(a);
        const bKeys = Object.keys(b);
        if (aKeys.length !== bKeys.length) {
            return true;
        }
        for (const key of aKeys) {
            if (isDifferent(a[key], b[key])) {
                return true;
            }
        }
        return false;
    }
    return a !== b;
}

function jsToString(a: any) {
    if (a === undefined) {
        return "undefined";
    }
    return JSON.stringify(a, null, 2);
}

function getPropChanges(localItem: any, repoItem: any) {
    let propchanges = "";
    const addedProperties = Object.keys(localItem).filter((key) => !Object.keys(repoItem).includes(key));
    const repoProperties = Object.keys(repoItem);
    for (const property of addedProperties) {
        propchanges += `### ${property}\n\n`;
        propchanges += "Before:\n\n";
        propchanges += "```javascript\n";
        propchanges += "undefined";
        propchanges += "\n```\n\n";
        propchanges += "After:\n\n";
        propchanges += "```javascript\n";
        propchanges += jsToString(localItem[property]);
        propchanges += "\n```\n";
    }
    for (const property of repoProperties) {
        if (isDifferent(repoItem[property], localItem[property])) {
            propchanges += `### ${property}\n\n`;
            propchanges += "Before:\n\n";
            propchanges += "```javascript\n";
            propchanges += jsToString(repoItem[property]);
            propchanges += "```\n\n";
            propchanges += "After:\n\n";
            propchanges += "\n```javascript\n";
            propchanges += jsToString(localItem[property]);
            propchanges += "\n```\n";
        }
    }
    return propchanges;
}

async function main() {
    const repoItems = new Map(
        (await fetchFromRepo<CS2Item[]>("assets/data/items.json")).map((item) => [item.id, item])
    );
    const localItems = new Map(CS2_ITEMS.map((item) => [item.id, item]));
    const repoEnglish = await fetchFromRepo("assets/localizations/items-english.json");
    const localEnglish = readJson<any>("assets/localizations/items-english.json");

    const addedKeys = Array.from(localItems.keys()).filter((key) => !repoItems.has(key));
    const removedKeys = Array.from(repoItems.keys()).filter((key) => !localItems.has(key));
    const repoKeysWithoutRemovedKeys = Array.from(repoItems.keys()).filter((key) => !removedKeys.includes(key));

    if (addedKeys.length > 0) {
        report += "# Added Items\n\n";
        for (const addedKey of addedKeys) {
            const name = ensure(localEnglish[addedKey]).name;
            report += `* ${name} (id: ${addedKey})\n`;
        }
        report += "\n";
    }

    if (removedKeys.length > 0) {
        report += "# Removed Items\n\n";
        for (const removedKey of removedKeys) {
            const name = ensure(repoEnglish[removedKey]).name;
            report += `* ${name} (id: ${removedKey})\n`;
        }
        report += "\n";
    }

    for (const key of repoKeysWithoutRemovedKeys) {
        const repoItem = ensure(repoItems.get(key));
        const localItem = ensure(localItems.get(key));
        const repoLocalization = ensure(repoEnglish[key]);
        const localLocalization = ensure(localEnglish[key]);
        const name = `${repoLocalization.name || localLocalization.name} (id: ${key})`;
        let itemChanges = getPropChanges(localItem, repoItem);
        let localizationChanges = getPropChanges(localLocalization, repoLocalization);
        if (itemChanges || localizationChanges) {
            itemDiffs.push(`## ${name}\n\n${itemChanges}\n${localizationChanges}`);
        }
    }

    if (itemDiffs.length > 0) {
        report += "# Item Changes\n\n";
        report += itemDiffs.join("\n\n");
    }

    if (report.trim() !== "") {
        const timestamp = new Date().toISOString().replace(/:/g, "-").replace("T", "-").split(".")[0];
        write(`scripts/item-diffs/${timestamp}.md`, report);
    }
}

if (shouldRun(import.meta.url)) {
    main().catch(console.error);
}
