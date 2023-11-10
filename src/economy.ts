/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CS_Team } from "./teams.js";
import { compare, safe } from "./util.js";

/**
 * The CS_Item interface is designed for use in client-facing interfaces and
 * contains generic information about a particular item.
 */
export interface CS_Item {
    altname?: string;
    base?: boolean;
    category: string;
    contents?: number[];
    def?: number;
    free?: boolean;
    id: number;
    image: string;
    itemid?: number;
    localimage?: boolean;
    model?: string;
    name: string;
    rarecontents?: number[];
    rareimage?: number;
    rarity: string;
    teams?: CS_Team[];
    type:
        | "agent"
        | "case"
        | "glove"
        | "melee"
        | "musickit"
        | "patch"
        | "pin"
        | "sticker"
        | "weapon";
}

/**
 * Minimum allowed float value for Counter-Strike items.
 */
export const CS_MIN_FLOAT = 0.000001;

/**
 * Maximum allowed float value for Counter-Strike items.
 */
export const CS_MAX_FLOAT = 0.999999;

/**
 * Minimum float value for Factory New items.
 */
export const CS_MIN_FACTORY_NEW_FLOAT = CS_MIN_FLOAT;

/**
 * Maximum float value for Factory New items.
 */
export const CS_MAX_FACTORY_NEW_FLOAT = 0.07;

/**
 * Minimum float value for Minimal Wear items.
 */
export const CS_MIN_MINIMAL_WEAR_FLOAT = 0.070001;

/**
 * Maximum float value for Minimal Wear items.
 */
export const CS_MAX_MINIMAL_WEAR_FLOAT = 0.15;

/**
 * Minimum float value for Field Tested items.
 */
export const CS_MIN_FIELD_TESTED_FLOAT = 0.150001;

/**
 * Maximum float value for Field Tested items.
 */
export const CS_MAX_FIELD_TESTED_FLOAT = 0.37;

/**
 * Minimum float value for Well Worn items.
 */
export const CS_MIN_WELL_WORN_FLOAT = 0.370001;

/**
 * Maximum float value for Well Worn items.
 */
export const CS_MAX_WELL_WORN_FLOAT = 0.44;

/**
 * Minimum float value for Battle Scarred items.
 */
export const CS_MIN_BATTLE_SCARRED_FLOAT = 0.440001;

/**
 * Maximum float value for Battle Scarred items.
 */
export const CS_MAX_BATTLE_SCARRED_FLOAT = CS_MAX_FLOAT;

/**
 * Maximum float value for Battle Scarred items.
 */
export const CS_MIN_SEED = 1;

/**
 * Maximum seed value for Counter-Strike items.
 */
export const CS_MAX_SEED = 1000;

/**
 * Array of Counter-Strike item types that have a float value.
 */
export const CS_FLOATABLE_ITEMS = ["glove", "melee", "weapon"];

/**
 * Array of Counter-Strike item types that can have nametags.
 */
export const CS_NAMETAGGABLE_ITEMS = ["melee", "weapon"];

/**
 * Array of Counter-Strike item types that can have seeds.
 */
export const CS_SEEDABLE_ITEMS = ["weapon", "melee"];

/**
 * Array of Counter-Strike item types that can be StatTrak.
 */
export const CS_STATTRAKABLE_ITEMS = ["melee", "weapon", "musickit"];

/**
 * Array of Counter-Strike item types that can have stickers.
 */
export const CS_STICKERABLE_ITEMS = ["weapon"];

/**
 * Regular expression for validating nametags.
 */
export const CS_NAMETAG_RE = /^[A-Za-z0-9|][A-Za-z0-9|\s]{0,19}$/;

/**
 * Minimum float value for stickers.
 */
export const CS_MIN_STICKER_FLOAT = 0;

/**
 * Maximum float value for stickers.
 */
export const CS_MAX_STICKER_FLOAT = 0.9;

/**
 * For cases that don't have custom rare image.
 */
export const CS_RARE_IMAGE_DEFAULT = 1;

/**
 * For cases that have custom rare image.
 */
export const CS_RARE_IMAGE_CUSTOM = 2;

/**
 * A predicate to filter Counter-Strike items based on various attributes.
 */
type CS_EconomyPredicate = Partial<CS_Item> & { team?: CS_Team };

/**
 * A function that filters Counter-Strike items based on a given predicate.
 */
function filterItems(predicate: CS_EconomyPredicate) {
    return function filter(item: CS_Item) {
        return (
            compare(predicate.type, item.type) &&
            compare(predicate.free, item.free) &&
            compare(predicate.model, item.model) &&
            compare(predicate.base, item.base) &&
            compare(predicate.category, item.category) &&
            (predicate.team === undefined ||
                item.teams === undefined ||
                item.teams.includes(predicate.team))
        );
    };
}

/**
 * Represents a Counter-Strike category menu item.
 */
export interface CS_CategoryMenuItem {
    category: string;
    label: string;
    unique: boolean;
}

/**
 * Array of category menu items for Counter-Strike items.
 */
export const CS_CATEGORY_MENU: CS_CategoryMenuItem[] = [
    {
        label: "Pistol",
        category: "secondary",
        unique: false
    },
    {
        label: "SMG",
        category: "smg",
        unique: false
    },
    {
        label: "Heavy",
        category: "heavy",
        unique: false
    },
    {
        label: "Rifle",
        category: "rifle",
        unique: false
    },
    {
        label: "Knife",
        category: "melee",
        unique: true
    },
    {
        label: "Glove",
        category: "glove",
        unique: true
    },
    {
        label: "Sticker",
        category: "sticker",
        unique: true
    },
    {
        label: "Agent",
        category: "agent",
        unique: true
    },
    {
        label: "Patch",
        category: "patch",
        unique: true
    },
    {
        label: "Music Kit",
        category: "musickit",
        unique: true
    },
    {
        label: "Pin",
        category: "pin",
        unique: true
    },
    {
        label: "Case",
        category: "case",
        unique: true
    }
];

/**
 * Represents the Counter-Strike Economy.
 */
export class CS_Economy {
    /**
     * Array of all Counter-Strike items.
     */
    static items: CS_Item[] = [];
    /**
     * Map of Counter-Strike item IDs to their corresponding items.
     */
    static itemMap: Map<number, CS_Item> = new Map();
    /**
     * Set of Counter-Strike sticker categories.
     */
    static categories: Set<string> = new Set();
    /**
     * Array of Counter-Strike sticker items.
     */
    static stickers: CS_Item[] = [];

    /**
     * Set the Counter-Strike items and their definitions.
     * @param {CS_Item[]} items - An array of Counter-Strike items.
     */
    static initialize(items: CS_Item[]) {
        CS_Economy.categories.clear();
        CS_Economy.items = items;
        CS_Economy.itemMap.clear();
        CS_Economy.stickers = [];
        items.forEach((item) => {
            CS_Economy.itemMap.set(item.id, item);
            if (item.type === "sticker") {
                CS_Economy.stickers.push(item);
                CS_Economy.categories.add(item.category);
            }
        });
    }

    /**
     * Get a Counter-Strike item by its ID.
     * @param {number} id - The ID of the Counter-Strike item to retrieve.
     * @returns {CS_Item} - The Counter-Strike item.
     */
    static getById(id: number): CS_Item {
        const item = CS_Economy.itemMap.get(id);
        if (item === undefined) {
            throw new Error("item not found");
        }
        return item;
    }
}

/**
 * Find a Counter-Strike item based on the given predicate.
 * @param {CS_EconomyPredicate} predicate - A predicate to filter Counter-Strike items.
 * @returns {CS_Item} - The Counter-Strike item matching the predicate.
 */
export function CS_findItem(predicate: CS_EconomyPredicate): CS_Item {
    const item = CS_Economy.items.find(filterItems(predicate));
    if (item === undefined) {
        throw new Error("item not found");
    }
    return item;
}

/**
 * Filter Counter-Strike items based on the given predicate.
 * @param {CS_EconomyPredicate} predicate - A predicate to filter Counter-Strike items.
 * @returns {CS_Item[]} - An array of Counter-Strike items matching the predicate.
 */
export function CS_filterItems(predicate: CS_EconomyPredicate): CS_Item[] {
    const items = CS_Economy.items.filter(filterItems(predicate));
    if (items.length === 0) {
        throw new Error("items not found");
    }
    return items;
}

/**
 * Check if a Counter-Strike item has a float value.
 * @param {CS_Item} csItem - The Counter-Strike item to check.
 * @returns {boolean} - `true` if the item has a float value, `false` otherwise.
 */
export function CS_hasFloat(csItem: CS_Item): boolean {
    return CS_FLOATABLE_ITEMS.includes(csItem.type);
}

/**
 * Validate a float value for Counter-Strike items.
 * @param {number} float - The float value to validate.
 * @param {CS_Item} [forItem] - The Counter-Strike item for which the float is being validated (optional).
 * @returns {boolean} - `true` if the float value is valid, otherwise throws an error.
 */
export function CS_validateFloat(float: number, forItem?: CS_Item): boolean {
    if (forItem !== undefined && !CS_hasFloat(forItem)) {
        throw new Error("item does not have float");
    }
    if (String(float).length > String(CS_MAX_FLOAT).length) {
        throw new Error("invalid float length");
    }
    if (float < CS_MIN_FLOAT || float > CS_MAX_FLOAT) {
        throw new Error("invalid float");
    }
    return true;
}

/**
 * Safe version of `CS_validateFloat` wrapped in a try-catch block to handle exceptions.
 * @param {number} float - The float value to validate.
 * @returns {boolean} - `true` if the float value is valid, otherwise returns `false`.
 */
export const CS_safeValidateFloat = safe(CS_validateFloat);

/**
 * Check if a Counter-Strike item has a seed value.
 * @param {CS_Item} csItem - The Counter-Strike item to check.
 * @returns {boolean} - `true` if the item has a seed value, `false` otherwise.
 */
export function CS_hasSeed(csItem: CS_Item): boolean {
    return CS_SEEDABLE_ITEMS.includes(csItem.type);
}

/**
 * Validate a seed value for Counter-Strike items.
 * @param {number} seed - The seed value to validate.
 * @param {CS_Item} [forItem] - The Counter-Strike item for which the seed is being validated (optional).
 * @returns {boolean} - `true` if the seed value is valid, otherwise throws an error.
 */
export function CS_validateSeed(seed: number, forItem?: CS_Item): boolean {
    if (forItem !== undefined && !CS_hasSeed(forItem)) {
        throw new Error("item does not have seed");
    }
    if (String(seed).includes(".")) {
        throw new Error("seed is an integer");
    }
    if (seed < CS_MIN_SEED || seed > CS_MAX_SEED) {
        throw new Error("invalid seed");
    }
    return true;
}

/**
 * Safe version of `CS_validateSeed` wrapped in a try-catch block to handle exceptions.
 * @param {number} seed - The seed value to validate.
 * @returns {boolean} - `true` if the seed value is valid, otherwise returns `false`.
 */
export const CS_safeValidateSeed = safe(CS_validateSeed);

/**
 * Check if a Counter-Strike item can have stickers.
 * @param {CS_Item} csItem - The Counter-Strike item to check.
 * @returns {boolean} - `true` if the item can have stickers, `false` otherwise.
 */
export function CS_hasStickers(csItem: CS_Item): boolean {
    return CS_STICKERABLE_ITEMS.includes(csItem.type);
}

/**
 * Validate stickers for a Counter-Strike item.
 * @param {CS_Item} csItem - The Counter-Strike item for which stickers are being validated.
 * @param {(number | null)[]} stickers - An array of sticker IDs, with null values for empty slots.
 * @param {(number | null)[]} [stickerswear] - An array of sticker wear values (optional).
 * @returns {boolean} - `true` if the stickers are valid, otherwise throws an error.
 */
export function CS_validateStickers(
    csItem: CS_Item,
    stickers: (number | null)[],
    stickerswear: (number | null)[] = []
): boolean {
    if (!CS_hasStickers(csItem)) {
        throw new Error("item does not have seed");
    }
    if (stickers.length > 4) {
        throw new Error("invalid stickers");
    }
    for (const [index, sticker] of stickers.entries()) {
        if (sticker === null) {
            if (stickerswear[index] !== undefined) {
                throw new Error("invalid wear");
            }
            continue;
        }
        if (CS_Economy.getById(sticker).type !== "sticker") {
            throw new Error("invalid sticker");
        }
        const wear = stickerswear[index];
        if (typeof wear === "number") {
            if (String(wear).length > 5) {
                throw new Error("invalid wear length");
            }
            if (wear < CS_MIN_STICKER_FLOAT && wear > CS_MAX_STICKER_FLOAT) {
                throw new Error("invalid wear float");
            }
        }
    }
    return true;
}

/**
 * Check if a Counter-Strike item can have a nametag.
 * @param {CS_Item} csItem - The Counter-Strike item to check.
 * @returns {boolean} - `true` if the item can have a nametag, `false` otherwise.
 */
export function CS_hasNametag(csItem: CS_Item): boolean {
    return CS_NAMETAGGABLE_ITEMS.includes(csItem.type);
}

/**
 * Validate a nametag for a Counter-Strike item.
 * @param {string} nametag - The nametag to validate.
 * @param {CS_Item} [forItem] - The Counter-Strike item for which the nametag is being validated (optional).
 * @returns {boolean} - `true` if the nametag is valid, otherwise throws an error.
 */
export function CS_validateNametag(
    nametag: string,
    forItem?: CS_Item
): boolean {
    if (forItem !== undefined && !CS_hasNametag(forItem)) {
        throw new Error("invalid nametag");
    }
    if (!CS_NAMETAG_RE.test(nametag)) {
        throw new Error("invalid nametag");
    }
    return true;
}

/**
 * Safe version of `CS_validateNametag` wrapped in a try-catch block to handle exceptions.
 * @param {string} nametag - The nametag to validate.
 * @returns {boolean} - `true` if the nametag is valid, otherwise returns `false`.
 */
export const CS_safeValidateNametag = safe(CS_validateNametag);

/**
 * Check if a Counter-Strike item can have StatTrak.
 * @param {CS_Item} csItem - The Counter-Strike item to check.
 * @returns {boolean} - `true` if the item can be StatTrak, `false` otherwise.
 */
export function CS_hasStatTrak(csItem: CS_Item): boolean {
    return CS_STATTRAKABLE_ITEMS.includes(csItem.type);
}

/**
 * Validate StatTrak status for a Counter-Strike item.
 * @param {boolean} stattrak - The StatTrak status to validate.
 * @param {CS_Item} forItem - The Counter-Strike item for which StatTrak status is being validated.
 * @returns {boolean} - `true` if the StatTrak status is valid, otherwise throws an error.
 */
export function CS_validateStatTrak(
    stattrak: boolean,
    forItem: CS_Item
): boolean {
    if (stattrak === true && !CS_hasStatTrak(forItem)) {
        throw new Error("invalid stattrak");
    }
    return true;
}

/**
 * Get the float label for a Counter-Strike item based on its float value.
 * @param {number} float - The float value of the item.
 * @returns {string} - The float label ("FN", "MW", "FT", "WW", or "BS").
 */
export function CS_getFloatLabel(float: number): string {
    if (float <= CS_MAX_FACTORY_NEW_FLOAT) {
        return "FN";
    }
    if (float <= CS_MAX_MINIMAL_WEAR_FLOAT) {
        return "MW";
    }
    if (float <= CS_MAX_FIELD_TESTED_FLOAT) {
        return "FT";
    }
    if (float <= CS_MAX_WELL_WORN_FLOAT) {
        return "WW";
    }
    return "BS";
}

/**
 * Get a list of Counter-Strike sticker categories.
 * @returns {string[]} - An array of Counter-Strike sticker categories.
 */
export function CS_getStickerCategories(): string[] {
    return Array.from(CS_Economy.categories).sort();
}

/**
 * Get an array of Counter-Strike sticker items.
 * @returns {CS_Item[]} - An array of Counter-Strike sticker items.
 */
export function CS_getStickers(): CS_Item[] {
    return CS_Economy.stickers;
}

/**
 * Resolve the image URL for a Counter-Strike item.
 * @param {string} baseUrl - The base URL for images.
 * @param {CS_Item | number} csItem - The Counter-Strike item or its ID.
 * @param {number} [float] - The float value of the item (optional).
 * @returns {string} - The resolved image URL.
 */
export function CS_resolveItemImage(
    baseUrl: string,
    csItem: CS_Item | number,
    float?: number
): string {
    const { base, id, image, localimage } =
        typeof csItem === "number" ? CS_Economy.getById(csItem) : csItem;
    if (!localimage) {
        if (image.charAt(0) === "/") {
            return `${baseUrl}${image}`;
        }
        return image;
    }
    if (base) {
        return `${baseUrl}/${id}.png`;
    }
    const url = `${baseUrl}/${id}`;
    if (float === undefined) {
        return `${url}_light.png`;
    }
    // In the future we need to be more precise on this, I don't think it's
    // correct.  Please let me know if you know which float each image matches.
    if (float < 1 / 3) {
        return `${url}_light.png`;
    }
    if (float < 2 / 3) {
        return `${url}_medium.png`;
    }
    return `${url}_heavy.png`;
}

/**
 * Resolve the rare image URL for a case.
 * @param {string} baseUrl - The base URL for images.
 * @param {CS_Item | number} csItem - The Counter-Strike item or its ID.
 * @returns {string} - The resolved image URL.
 */
export function CS_resolveCaseRareImage(
    baseUrl: string,
    csItem: CS_Item | number
): string {
    csItem = typeof csItem === "number" ? CS_Economy.getById(csItem) : csItem;
    const { id, type, rareimage } = csItem;
    if (type !== "case") {
        throw new Error("item is not a case");
    }
    if (rareimage === undefined) {
        throw new Error("case does not have rare items");
    }
    if (rareimage === 1) {
        return `${baseUrl}/${id}_rare.png`;
    }
    return `${baseUrl}/default_rare_item.png`;
}
