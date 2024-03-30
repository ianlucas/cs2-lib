/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

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

export const CS_RARITIES = ["common", "uncommon", "rare", "mythical", "legendary", "ancient", "immortal"] as const;

export const CS_RARITY_ORDER = [...CS_RARITIES, "special"] as const;

export const CS_BASE_ODD = 0.8;
export const CS_STATTRAK_ODD = 0.1;

export function CS_randomFloat(min: number, max: number) {
    return Math.random() * (max - min) + min;
}

export function CS_randomInt(min: number, max: number) {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min + 1)) + min;
}
