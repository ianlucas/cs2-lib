/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { stringify } from "javascript-stringify";
import { type CS2Item } from "../src/economy-types.ts";
import { CS2_ITEMS } from "../src/items.ts";
import { ensure } from "../src/utils.ts";
import { readJson, shouldRun, write } from "./utils.ts";

const repoBaseUrl = "https://raw.githubusercontent.com/ianlucas/cs2-lib/main";

async function fetchFromRepo<T = any>(path: string): Promise<T> {
    return await (await fetch(`${repoBaseUrl}/${path}`)).json();
}

let report = "";
let itemDiffs: string[] = [];

const replacer: Parameters<typeof stringify>[1] = (value, _, stringify) => {
    if (typeof value === "string") {
        return '"' + value.replace(/"/g, '\\"') + '"';
    }
    return stringify(value);
};

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

function isPrimitiveArray(value: any): value is (string | number)[] {
    return Array.isArray(value) && value.every((item) => typeof item === "string" || typeof item === "number");
}

function getArrayDelta(localArr: (string | number)[], repoArr: (string | number)[]) {
    const repoSet = new Set(repoArr);
    const localSet = new Set(localArr);
    return {
        added: localArr.filter((value) => !repoSet.has(value)),
        removed: repoArr.filter((value) => !localSet.has(value))
    };
}

function formatList(values: (string | number)[]) {
    return values.map((value) => (typeof value === "string" ? `"${value}"` : String(value))).join(", ");
}

function getPropChanges(
    title: string,
    localItem: any,
    repoItem: any,
    localNames?: Record<string, { name?: string }>,
    repoNames?: Record<string, { name?: string }>
) {
    let changes = "";
    const addedProperties = Object.keys(localItem).filter((key) => !Object.keys(repoItem).includes(key));
    const repoProperties = Object.keys(repoItem);
    const before: any = {};
    const after: any = {};
    const arrayChanges: string[] = [];

    // Properties like `contents`/`specials`/`keys` hold item ids. Diff them by the referenced
    // item's name so that an internal id change for the same item (e.g. a different Doppler
    // phase id that still exists in items.json) isn't reported as removed + added.
    const resolveRefs = (values: (string | number)[], names?: Record<string, { name?: string }>) =>
        names !== undefined && values.every((value) => typeof value === "number")
            ? values.map((id) => names[id]?.name ?? id)
            : values;

    // Render array properties as added/removed deltas instead of dumping the whole
    // before/after arrays (e.g. container `specials`/`contents` can hold hundreds of ids).
    const addArrayDelta = (property: string, localValue: any, repoValue: any) => {
        const { added, removed } = getArrayDelta(
            resolveRefs(Array.isArray(localValue) ? localValue : [], localNames),
            resolveRefs(Array.isArray(repoValue) ? repoValue : [], repoNames)
        );
        if (added.length === 0 && removed.length === 0) return;
        let block = `**${property}**\n\n`;
        if (added.length > 0) block += `- Added (${added.length}): ${formatList(added)}\n`;
        if (removed.length > 0) block += `- Removed (${removed.length}): ${formatList(removed)}\n`;
        arrayChanges.push(block);
    };

    for (const property of addedProperties) {
        const value = localItem[property];
        if (isPrimitiveArray(value)) {
            addArrayDelta(property, value, []);
        } else {
            after[property] = value;
        }
    }
    for (const property of repoProperties) {
        if (!isDifferent(repoItem[property], localItem[property])) continue;
        const localValue = localItem[property];
        const repoValue = repoItem[property];
        if (isPrimitiveArray(localValue) || isPrimitiveArray(repoValue)) {
            addArrayDelta(property, localValue, repoValue);
        } else {
            before[property] = repoValue;
            after[property] = localValue;
        }
    }

    if (Object.keys(before).length > 0 || Object.keys(after).length > 0 || arrayChanges.length > 0) {
        changes += `### ${title}\n\n`;
        if (Object.keys(before).length > 0) {
            changes += "#### Before\n\n";
            changes += "```javascript\n";
            changes += stringify(before, replacer, 2);
            changes += "\n```\n";
        }
        if (Object.keys(after).length > 0) {
            changes += "#### After\n\n";
            changes += "```javascript\n";
            changes += stringify(after, replacer, 2);
            changes += "\n```\n";
        }
        for (const block of arrayChanges) {
            changes += "\n" + block;
        }
    }
    return changes;
}

async function main() {
    const repoItems = new Map(
        (await fetchFromRepo<CS2Item[]>("scripts/data/items.json")).map((item) => [item.id, item])
    );
    const localItems = new Map(CS2_ITEMS.map((item) => [item.id, item]));
    const repoEnglish = await fetchFromRepo("scripts/data/english.json");
    const localEnglish = readJson<any>("scripts/data/english.json");

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
        const repoTranslation = ensure(repoEnglish[key]);
        const localTranslation = ensure(localEnglish[key]);
        const name = `${repoTranslation.name || localTranslation.name} (id: ${key})`;
        let itemChanges = getPropChanges("Item Changes", localItem, repoItem, localEnglish, repoEnglish);
        let translationChanges = getPropChanges("Translation Changes", localTranslation, repoTranslation);
        if (itemChanges || translationChanges) {
            itemDiffs.push(`## ${name}\n\n${itemChanges}\n${translationChanges}`);
        }
    }

    if (itemDiffs.length > 0) {
        report += "# Item Changes\n\n";
        report += itemDiffs.join("\n\n");
    }

    if (report.trim() !== "") {
        const timestamp = new Date().toISOString().replace(/:/g, "").replace(/-/g, "").split(".")[0];
        write(`scripts/.changelogs/${timestamp}.md`, report);
    }
}

if (shouldRun(import.meta.url)) {
    main().catch(console.error);
}
