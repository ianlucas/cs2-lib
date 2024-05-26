/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const CS2_RARITY_COMMON_COLOR = "#b0c3d9";
export const CS2_RARITY_UNCOMMON_COLOR = "#5e98d9";
export const CS2_RARITY_RARE_COLOR = "#4b69ff";
export const CS2_RARITY_MYTHICAL_COLOR = "#8847ff";
export const CS2_RARITY_LEGENDARY_COLOR = "#d32ce6";
export const CS2_RARITY_ANCIENT_COLOR = "#eb4b4b";
export const CS2_RARITY_IMMORTAL_COLOR = "#e4ae39";

export const CS2_RARITY_COLORS: Record<string, string> = {
    [CS2_RARITY_COMMON_COLOR]: "common",
    [CS2_RARITY_UNCOMMON_COLOR]: "uncommon",
    [CS2_RARITY_RARE_COLOR]: "rare",
    [CS2_RARITY_MYTHICAL_COLOR]: "mythical",
    [CS2_RARITY_LEGENDARY_COLOR]: "legendary",
    [CS2_RARITY_ANCIENT_COLOR]: "ancient",
    [CS2_RARITY_IMMORTAL_COLOR]: "immortal"
};

export const CS2_RARITY_FOR_SOUNDS: Record<string, string> = {
    [CS2_RARITY_COMMON_COLOR]: "common",
    [CS2_RARITY_UNCOMMON_COLOR]: "uncommon",
    [CS2_RARITY_RARE_COLOR]: "rare",
    [CS2_RARITY_MYTHICAL_COLOR]: "mythical",
    [CS2_RARITY_LEGENDARY_COLOR]: "legendary",
    [CS2_RARITY_ANCIENT_COLOR]: "ancient",
    [CS2_RARITY_IMMORTAL_COLOR]: "ancient" // immortal
};

export const CS2_RARITY_COLOR_DEFAULT = 0;

export const CS2_RARITY_COLOR_ORDER: Record<string, number | undefined> = {
    [CS2_RARITY_COMMON_COLOR]: 1,
    [CS2_RARITY_UNCOMMON_COLOR]: 2,
    [CS2_RARITY_RARE_COLOR]: 3,
    [CS2_RARITY_MYTHICAL_COLOR]: 4,
    [CS2_RARITY_LEGENDARY_COLOR]: 5,
    [CS2_RARITY_ANCIENT_COLOR]: 6,
    [CS2_RARITY_IMMORTAL_COLOR]: 7
};

export const CS2_RARITIES = ["common", "uncommon", "rare", "mythical", "legendary", "ancient", "immortal"] as const;

export const CS2_RARITY_ORDER = [...CS2_RARITIES, "special"] as const;

export const CS2_BASE_ODD = 0.8;
export const CS2_STATTRAK_ODD = 0.1;

export function CS2_randomFloat(min: number, max: number) {
    return Math.random() * (max - min) + min;
}

export function CS2_randomInt(min: number, max: number) {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min + 1)) + min;
}
