/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const RARITY_COMMON_COLOR = "#b0c3d9";
export const RARITY_UNCOMMON_COLOR = "#5e98d9";
export const RARITY_RARE_COLOR = "#4b69ff";
export const RARITY_MYTHICAL_COLOR = "#8847ff";
export const RARITY_LEGENDARY_COLOR = "#d32ce6";
export const RARITY_ANCIENT_COLOR = "#eb4b4b";
export const RARITY_IMMORTAL_COLOR = "#e4ae39";

export const RARITY_COLORS: Record<string, string> = {
    [RARITY_COMMON_COLOR]: "common",
    [RARITY_UNCOMMON_COLOR]: "uncommon",
    [RARITY_RARE_COLOR]: "rare",
    [RARITY_MYTHICAL_COLOR]: "mythical",
    [RARITY_LEGENDARY_COLOR]: "legendary",
    [RARITY_ANCIENT_COLOR]: "ancient",
    [RARITY_IMMORTAL_COLOR]: "immortal"
};

export const RARITY_FOR_SOUNDS: Record<string, string> = {
    [RARITY_COMMON_COLOR]: "common",
    [RARITY_UNCOMMON_COLOR]: "uncommon",
    [RARITY_RARE_COLOR]: "rare",
    [RARITY_MYTHICAL_COLOR]: "mythical",
    [RARITY_LEGENDARY_COLOR]: "legendary",
    [RARITY_ANCIENT_COLOR]: "ancient",
    [RARITY_IMMORTAL_COLOR]: "ancient" // immortal
};

export const RARITY_COLOR_DEFAULT = 0;

export const RARITY_COLOR_ORDER: Record<string, number | undefined> = {
    [RARITY_COMMON_COLOR]: 1,
    [RARITY_UNCOMMON_COLOR]: 2,
    [RARITY_RARE_COLOR]: 3,
    [RARITY_MYTHICAL_COLOR]: 4,
    [RARITY_LEGENDARY_COLOR]: 5,
    [RARITY_ANCIENT_COLOR]: 6,
    [RARITY_IMMORTAL_COLOR]: 7
};

export const RARITIES = ["common", "uncommon", "rare", "mythical", "legendary", "ancient", "immortal"] as const;

export const RARITY_ORDER = [...RARITIES, "special"] as const;

export const BASE_ODD = 0.8;
export const STATTRAK_ODD = 0.1;

export function randomFloat(min: number, max: number) {
    return Math.random() * (max - min) + min;
}

export function randomInt(min: number, max: number) {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min + 1)) + min;
}
