/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    CS_Economy,
    CS_Item,
    CS_MAX_SEED,
    CS_MAX_WEAR,
    CS_MIN_SEED,
    CS_MIN_WEAR,
    CS_WEAR_FACTOR,
    CS_hasSeed,
    CS_hasStatTrak,
    CS_hasWear
} from "./economy.js";
import { safe } from "./util.js";

export const CS_RARITY_COMMON_COLOR = "#b0c3d9";
export const CS_RARITY_UNCOMMON_COLOR = "#5e98d9";
export const CS_RARITY_RARE_COLOR = "#4b69ff";
export const CS_RARITY_MYTHICAL_COLOR = "#8847ff";
export const CS_RARITY_LEGENDARY_COLOR = "#d32ce6";
export const CS_RARITY_ANCIENT_COLOR = "#eb4b4b";
export const CS_RARITY_IMMORTAL_COLOR = "#e4ae39";

export const CS_RARITY_COLORS: Record<string, string> = {
    [CS_RARITY_COMMON_COLOR]: "common",
    [CS_RARITY_UNCOMMON_COLOR]: "uncommon",
    [CS_RARITY_RARE_COLOR]: "rare",
    [CS_RARITY_MYTHICAL_COLOR]: "mythical",
    [CS_RARITY_LEGENDARY_COLOR]: "legendary",
    [CS_RARITY_ANCIENT_COLOR]: "ancient",
    [CS_RARITY_IMMORTAL_COLOR]: "immortal"
};

export const CS_RARITY_FOR_SOUNDS: Record<string, string> = {
    [CS_RARITY_COMMON_COLOR]: "common",
    [CS_RARITY_UNCOMMON_COLOR]: "uncommon",
    [CS_RARITY_RARE_COLOR]: "rare",
    [CS_RARITY_MYTHICAL_COLOR]: "mythical",
    [CS_RARITY_LEGENDARY_COLOR]: "legendary",
    [CS_RARITY_ANCIENT_COLOR]: "ancient",
    [CS_RARITY_IMMORTAL_COLOR]: "ancient" // immortal
};

export const CS_RARITY_COLOR_DEFAULT = 0;

export const CS_RARITY_COLOR_ORDER: Record<string, number | undefined> = {
    [CS_RARITY_COMMON_COLOR]: 1,
    [CS_RARITY_UNCOMMON_COLOR]: 2,
    [CS_RARITY_RARE_COLOR]: 3,
    [CS_RARITY_MYTHICAL_COLOR]: 4,
    [CS_RARITY_LEGENDARY_COLOR]: 5,
    [CS_RARITY_ANCIENT_COLOR]: 6,
    [CS_RARITY_IMMORTAL_COLOR]: 7
};

export const CS_RARITY_ORDER = [
    "common",
    "uncommon",
    "rare",
    "mythical",
    "legendary",
    "ancient",
    "immortal",
    "special"
];

export const CS_BASE_ODD = 0.8;
export const CS_STATTRAK_ODD = 1 / 10;

export function CS_randomFloat(min: number, max: number) {
    return Math.random() * (max - min) + min;
}

export function CS_randomInt(min: number, max: number) {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function CS_isCase(item: number | CS_Item) {
    return CS_Economy.get(item).type === "case";
}

export function CS_isKey(item: number | CS_Item) {
    return CS_Economy.get(item).type === "key";
}

export function CS_expectCase(item: number | CS_Item) {
    if (!CS_isCase(item)) {
        throw new Error("item is not a case.");
    }
    return true;
}

export function CS_expectKey(item: number | CS_Item) {
    if (!CS_isKey(item)) {
        throw new Error("item is not a key.");
    }
    return true;
}

export function CS_validateCaseKey(caseItem: number | CS_Item, keyItem?: number | CS_Item) {
    caseItem = CS_Economy.get(caseItem);
    keyItem = keyItem !== undefined ? CS_Economy.get(keyItem) : undefined;
    CS_expectCase(caseItem);
    if (keyItem !== undefined) {
        if (caseItem.keys === undefined) {
            throw new Error("case does not need a key");
        }
        CS_expectKey(keyItem);
        if (!caseItem.keys.includes(keyItem.id)) {
            throw new Error("case needs a valid key to be open");
        }
    } else {
        if (caseItem.keys !== undefined) {
            throw new Error("case needs a key");
        }
    }
}

export const CS_safeValidateCaseKey = safe(CS_validateCaseKey);

export function CS_getCaseContents(caseItem: number | CS_Item) {
    caseItem = CS_Economy.get(caseItem);
    CS_expectCase(caseItem);
    const { contents, specials } = caseItem;
    if (contents === undefined) {
        throw new Error("case has no contents.");
    }
    return { contents, specials };
}

export function CS_groupCaseContents(caseItem: number | CS_Item) {
    const { contents, specials } = CS_getCaseContents(caseItem);
    const items: Record<string, CS_Item[]> = {};
    for (const id of contents) {
        const item = CS_Economy.getById(id);
        const rarity = CS_RARITY_COLORS[item.rarity];
        if (!items[rarity]) {
            items[rarity] = [];
        }
        items[rarity].push(item);
    }
    if (specials) {
        for (const id of specials) {
            const item = CS_Economy.getById(id);
            const rarity = "special";
            if (!items[rarity]) {
                items[rarity] = [];
            }
            items[rarity].push(item);
        }
    }
    return items;
}

export function CS_listCaseContents(caseItem: number | CS_Item, hideSpecials = false) {
    const { contents, specials } = CS_getCaseContents(caseItem);
    const items = [...contents, ...(!hideSpecials && specials !== undefined ? specials : [])];
    return items
        .map((id) => CS_Economy.getById(id))
        .sort((a, b) => {
            return (
                (CS_RARITY_COLOR_ORDER[a.rarity] ?? CS_RARITY_COLOR_DEFAULT) -
                (CS_RARITY_COLOR_ORDER[b.rarity] ?? CS_RARITY_COLOR_DEFAULT)
            );
        });
}

/**
 * @see https://www.csgo.com.cn/news/gamebroad/20170911/206155.shtml
 */
export function CS_unlockCase(caseItem: number | CS_Item) {
    const items = CS_groupCaseContents(caseItem);
    const keys = Object.keys(items);
    const rarities = CS_RARITY_ORDER.filter((rarity) => keys.includes(rarity));
    const odds = rarities.map((_, index) => CS_BASE_ODD / Math.pow(5, index));
    const total = odds.reduce((acc, cur) => acc + cur, 0);
    const entries = rarities.map((rarity, index) => [rarity, odds[index] / total] as const);
    const roll = Math.random();
    let [rollRarity] = entries[0];
    let acc = 0;
    for (const [rarity, odd] of entries) {
        acc += odd;
        if (roll <= acc) {
            rollRarity = rarity;
            break;
        }
    }
    const item = items[rollRarity][Math.floor(Math.random() * items[rollRarity].length)];
    const hasStatTrak = item.category !== "StatTrakless";
    const alwaysStatTrak = item.category === "StatTrak-only";
    return {
        attributes: {
            seed: CS_hasSeed(item) ? CS_randomInt(CS_MIN_SEED, CS_MAX_SEED) : undefined,
            stattrak: hasStatTrak
                ? CS_hasStatTrak(item)
                    ? alwaysStatTrak || Math.random() <= CS_STATTRAK_ODD
                        ? 0
                        : undefined
                    : undefined
                : undefined,
            wear: CS_hasWear(item)
                ? Number(
                      CS_randomFloat(item.wearmin ?? CS_MIN_WEAR, item.wearmax ?? CS_MAX_WEAR)
                          .toString()
                          .substring(0, CS_WEAR_FACTOR.toString().length)
                  )
                : undefined
        },
        id: item.id,
        rarity: CS_RARITY_FOR_SOUNDS[item.rarity],
        special: rollRarity === "special"
    };
}

export function CS_validateUnlockedItem(caseItem: number | CS_Item, { id }: ReturnType<typeof CS_unlockCase>) {
    caseItem = CS_Economy.get(caseItem);
    if (caseItem.type !== "case") {
        throw new Error("item is not a case.");
    }
    if (!caseItem.contents?.includes(id) && !caseItem.specials?.includes(id)) {
        throw new Error("unlocked item is not from this case.");
    }
}
