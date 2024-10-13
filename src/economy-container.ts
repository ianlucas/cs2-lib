/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EnumValues } from "./utils.js";

export const CS2Rarity = {
    Common: "common",
    Uncommon: "uncommon",
    Rare: "rare",
    Mythical: "mythical",
    Legendary: "legendary",
    Ancient: "ancient",
    Immortal: "immortal"
} as const;

export type CS2RarityKeys = keyof typeof CS2Rarity;
export type CS2RarityValues = EnumValues<typeof CS2Rarity>;

export const CS2RarityColor = {
    Common: "#b0c3d9",
    Uncommon: "#5e98d9",
    Rare: "#4b69ff",
    Mythical: "#8847ff",
    Legendary: "#d32ce6",
    Ancient: "#eb4b4b",
    Immortal: "#e4ae39"
} as const;

export type CS2RarityColorValues = EnumValues<typeof CS2RarityColor>;

export const CS2_RARITIES = Object.values(CS2Rarity);
export const CS2_RARITY_ORDER = [...CS2_RARITIES, "special"] as const;

export const CS2RarityColorName = {
    [CS2RarityColor.Common]: CS2Rarity.Common,
    [CS2RarityColor.Uncommon]: CS2Rarity.Uncommon,
    [CS2RarityColor.Rare]: CS2Rarity.Rare,
    [CS2RarityColor.Mythical]: CS2Rarity.Mythical,
    [CS2RarityColor.Legendary]: CS2Rarity.Legendary,
    [CS2RarityColor.Ancient]: CS2Rarity.Ancient,
    [CS2RarityColor.Immortal]: CS2Rarity.Immortal
} as const;

export const CS2RaritySoundName = {
    [CS2RarityColor.Common]: CS2Rarity.Common,
    [CS2RarityColor.Uncommon]: CS2Rarity.Uncommon,
    [CS2RarityColor.Rare]: CS2Rarity.Rare,
    [CS2RarityColor.Mythical]: CS2Rarity.Mythical,
    [CS2RarityColor.Legendary]: CS2Rarity.Legendary,
    [CS2RarityColor.Ancient]: CS2Rarity.Ancient,
    [CS2RarityColor.Immortal]: CS2Rarity.Ancient
} as const;

export type CS2RaritySoundNameValues = EnumValues<typeof CS2RaritySoundName>;

export const CS2RarityColorOrder = {
    [CS2RarityColor.Common]: 1,
    [CS2RarityColor.Uncommon]: 2,
    [CS2RarityColor.Rare]: 3,
    [CS2RarityColor.Mythical]: 4,
    [CS2RarityColor.Legendary]: 5,
    [CS2RarityColor.Ancient]: 6,
    [CS2RarityColor.Immortal]: 6.55
} as const;

export const CS2_RARITY_COLOR_DEFAULT = 0;
export const CS2_BASE_ODD = 0.8;
export const CS2_STATTRAK_ODD = 0.1;

export function randomFloat(min: number, max: number): number {
    return Math.random() * (max - min) + min;
}

export function randomInt(min: number, max: number): number {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function randomBoolean(): boolean {
    return Math.random() >= 0.5;
}
