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
    CS_hasSeed,
    CS_hasStatTrak,
    CS_hasWear
} from "./economy.js";

export const CS_RARITY_COLORS: Record<string, string> = {
    "#b0c3d9": "common",
    "#5e98d9": "common", // uncommon
    "#4b69ff": "common", // rare
    "#8847ff": "mythical",
    "#d32ce6": "legendary",
    "#eb4b4b": "ancient",
    "#e4ae39": "ancient" // immortal
};

export const CS_RARITY_ODDS: Record<string, number> = {
    common: 0.8,
    mythical: 0.16,
    legendary: 0.032,
    ancient: 0.0064,
    special: 0.0016
};

export const CS_RARITY_ORDER = ["common", "mythical", "legendary", "ancient", "special"];

export function CS_randomFloat(min: number, max: number) {
    return Math.random() * (max - min + 1) + min;
}

export function CS_randomInt(min: number, max: number): number {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function CS_roll({ type, contents, rarecontents }: CS_Item) {
    if (type !== "case") {
        throw new Error("item is not a case");
    }
    const items: Record<string, CS_Item[]> = {};
    for (const id of contents!) {
        const csItem = CS_Economy.getById(id);
        const rarity = CS_RARITY_COLORS[csItem.rarity];
        if (!items[rarity]) {
            items[rarity] = [];
        }
        items[rarity].push(csItem);
    }
    if (rarecontents) {
        for (const id of rarecontents) {
            const csItem = CS_Economy.getById(id);
            const rarity = "special";
            if (!items[rarity]) {
                items[rarity] = [];
            }
            items[rarity].push(csItem);
        }
    }
    const presentRarities = Object.keys(items);
    const total = presentRarities.reduce((acc, rarity) => acc + CS_RARITY_ODDS[rarity], 0);
    const entries = CS_RARITY_ORDER.filter((rarity) => presentRarities.includes(rarity)).map(
        (rarity) => [rarity, CS_RARITY_ODDS[rarity] / total] as const
    );
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
    const csItem = items[rollRarity][Math.floor(Math.random() * items[rollRarity].length)];
    return {
        csItem,
        attributes: {
            seed: CS_hasSeed(csItem) ? CS_randomInt(CS_MIN_SEED, CS_MAX_SEED) : undefined,
            wear: CS_hasWear(csItem) ? CS_randomFloat(CS_MIN_WEAR, CS_MAX_WEAR) : undefined,
            stattrak: CS_hasStatTrak(csItem) ? (Math.random() <= 1 / 10 ? 0 : undefined) : undefined
        },
        special: rollRarity === "special"
    };
}
