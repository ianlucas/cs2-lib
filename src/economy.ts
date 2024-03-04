/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CS_Team } from "./teams.js";
import { compare, safe } from "./util.js";

export interface CS_Item {
    altname?: string;
    base?: boolean;
    category?: string;
    contents?: number[];
    def?: number;
    free?: boolean;
    id: number;
    image?: string;
    index?: number;
    keys?: number[];
    legacy?: boolean;
    model?: string;
    name: string;
    specials?: number[];
    specialsimage?: boolean;
    rarity: string;
    teams?: CS_Team[];
    tint?: number;
    type:
        | "agent"
        | "case"
        | "glove"
        | "graffiti"
        | "key"
        | "melee"
        | "musickit"
        | "patch"
        | "pin"
        | "sticker"
        | "tool"
        | "weapon";
    wearmax?: number;
    wearmin?: number;
}

export const CS_MIN_STATTRAK = 0;
export const CS_MAX_STATTRAK = 999999;
export const CS_WEAR_FACTOR = 0.000001;
export const CS_MIN_WEAR = 0;
export const CS_MAX_WEAR = 1;
export const CS_DEFAULT_MIN_WEAR = 0.06;
export const CS_DEFAULT_MAX_WEAR = 0.8;
export const CS_MIN_FACTORY_NEW_WEAR = CS_MIN_WEAR;
export const CS_MAX_FACTORY_NEW_WEAR = 0.07;
export const CS_MIN_MINIMAL_WEAR_WEAR = 0.070001;
export const CS_MAX_MINIMAL_WEAR_WEAR = 0.15;
export const CS_MIN_FIELD_TESTED_WEAR = 0.150001;
export const CS_MAX_FIELD_TESTED_WEAR = 0.37;
export const CS_MIN_WELL_WORN_WEAR = 0.370001;
export const CS_MAX_WELL_WORN_WEAR = 0.44;
export const CS_MIN_BATTLE_SCARRED_WEAR = 0.440001;
export const CS_MAX_BATTLE_SCARRED_WEAR = CS_MAX_WEAR;
export const CS_MIN_SEED = 1;
export const CS_MAX_SEED = 1000;
export const CS_WEARABLE_ITEMS = ["glove", "melee", "weapon"];
export const CS_NAMETAGGABLE_ITEMS = ["melee", "weapon"];
export const CS_SEEDABLE_ITEMS = ["weapon", "melee"];
export const CS_STATTRAKABLE_ITEMS = ["melee", "weapon", "musickit"];
export const CS_STICKERABLE_ITEMS = ["weapon"];
export const CS_NAMETAG_RE =
    /^[A-Za-z0-9`!@#$%^&*-+=(){}\[\]\/\|\\,.?:;'_\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\s]{0,20}$/u;
export const CS_STICKER_WEAR_FACTOR = 0.1;
export const CS_MIN_STICKER_WEAR = 0;
export const CS_MAX_STICKER_WEAR = 0.9;
export const CS_NAMETAG_TOOL_DEF = 1200;
export const CS_STATTRAK_SWAP_TOOL_DEF = 1324;
export const CS_STORAGE_UNIT_TOOL_DEF = 1201;
export const CS_NO_STICKER = 0;
export const CS_NO_STICKER_WEAR = 0;

type CS_EconomyPredicate = Partial<CS_Item> & { team?: CS_Team };

function filterItems(predicate: CS_EconomyPredicate) {
    return function filter(item: CS_Item) {
        return (
            compare(predicate.type, item.type) &&
            compare(predicate.free, item.free) &&
            compare(predicate.model, item.model) &&
            compare(predicate.base, item.base) &&
            compare(predicate.category, item.category) &&
            (predicate.team === undefined || item.teams === undefined || item.teams.includes(predicate.team))
        );
    };
}

export class CS_Economy {
    static items: CS_Item[] = [];
    static itemMap: Map<number, CS_Item> = new Map();

    static categories: Set<string> = new Set();
    static stickers: CS_Item[] = [];

    static initialize(items: CS_Item[]) {
        CS_Economy.categories.clear();
        CS_Economy.items = items;
        CS_Economy.itemMap.clear();
        CS_Economy.stickers = [];
        items.forEach((item) => {
            CS_Economy.itemMap.set(item.id, item);
            if (item.type === "sticker" && item.category !== undefined) {
                CS_Economy.stickers.push(item);
                CS_Economy.categories.add(item.category);
            }
        });
    }

    static getById(id: number) {
        const item = CS_Economy.itemMap.get(id);
        if (item === undefined) {
            throw new Error("item not found");
        }
        return item;
    }

    static get(idOrItem: number | CS_Item) {
        return typeof idOrItem === "number" ? CS_Economy.getById(idOrItem) : idOrItem;
    }
}

export function CS_findItem(predicate: CS_EconomyPredicate): CS_Item {
    const item = CS_Economy.items.find(filterItems(predicate));
    if (item === undefined) {
        throw new Error("item not found");
    }
    return item;
}

export function CS_filterItems(predicate: CS_EconomyPredicate): CS_Item[] {
    const items = CS_Economy.items.filter(filterItems(predicate));
    if (items.length === 0) {
        throw new Error("items not found");
    }
    return items;
}

export function CS_isC4(item: number | CS_Item): boolean {
    return CS_Economy.get(item).category === "c4";
}

export function CS_isSticker(item: number | CS_Item): boolean {
    return CS_Economy.get(item).type === "sticker";
}

export function CS_expectSticker(item: number | CS_Item) {
    if (!CS_isSticker(item)) {
        throw new Error("item is not a sticker");
    }
}

export function CS_hasWear(item: CS_Item): boolean {
    return CS_WEARABLE_ITEMS.includes(item.type) && !item.free && item.index !== 0;
}

export function CS_validateWear(wear?: number, forItem?: CS_Item): boolean {
    if (wear === undefined) {
        return true;
    }
    if (Number.isNaN(wear)) {
        throw new Error("invalid wear.");
    }
    if (forItem !== undefined && !CS_hasWear(forItem)) {
        throw new Error("item does not have wear");
    }
    if (String(wear).length > String(CS_WEAR_FACTOR).length) {
        throw new Error("invalid wear length");
    }
    if (wear < CS_MIN_WEAR || wear > CS_MAX_WEAR) {
        throw new Error("invalid wear");
    }
    if (forItem !== undefined) {
        if (forItem.wearmin !== undefined && wear < forItem.wearmin) {
            throw new Error("invalid wear");
        }
        if (forItem.wearmax !== undefined && wear > forItem.wearmax) {
            throw new Error("invalid wear");
        }
    }
    return true;
}

export const CS_safeValidateWear = safe(CS_validateWear);

export function CS_hasSeed(item: CS_Item): boolean {
    return CS_SEEDABLE_ITEMS.includes(item.type) && !item.free && item.index !== 0;
}

export function CS_validateSeed(seed?: number, forItem?: CS_Item): boolean {
    if (seed === undefined) {
        return true;
    }
    if (Number.isNaN(seed)) {
        throw new Error("invalid seed.");
    }
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

export const CS_safeValidateSeed = safe(CS_validateSeed);

export function CS_hasStickers(item: CS_Item): boolean {
    return CS_STICKERABLE_ITEMS.includes(item.type) && !CS_isC4(item);
}

export function CS_validateStickers(item: CS_Item, stickers?: number[], stickerswear?: number[]): boolean {
    if (stickers === undefined) {
        if (stickerswear !== undefined) {
            throw new Error("invalid stickers");
        }
        return true;
    }
    if (!CS_hasStickers(item)) {
        throw new Error("item does not have seed");
    }
    if (stickers.length !== 4) {
        throw new Error("invalid stickers");
    }
    if (stickerswear !== undefined && stickerswear.length !== 4) {
        throw new Error("invalid stickers wear");
    }
    for (const [index, sticker] of stickers.entries()) {
        if (sticker === CS_NO_STICKER) {
            if (stickerswear !== undefined && stickerswear[index] !== CS_NO_STICKER_WEAR) {
                throw new Error("invalid wear");
            }
            continue;
        }
        if (Number.isNaN(sticker)) {
            throw new Error("invalid sticker");
        }
        if (CS_Economy.getById(sticker).type !== "sticker") {
            throw new Error("invalid sticker");
        }
        if (stickerswear === undefined) {
            continue;
        }
        const wear = stickerswear[index];
        if (typeof wear === "number") {
            if (Number.isNaN(wear)) {
                throw new Error("invalid sticker wear");
            }
            if (String(wear).length > String(CS_STICKER_WEAR_FACTOR).length) {
                throw new Error("invalid sticker wear length");
            }
            if (wear < CS_MIN_STICKER_WEAR && wear > CS_MAX_STICKER_WEAR) {
                throw new Error("invalid sticker wear wear");
            }
        }
    }
    return true;
}

export function CS_hasNametag(item: CS_Item): boolean {
    return CS_NAMETAGGABLE_ITEMS.includes(item.type) || CS_isStorageUnitTool(item);
}

export function CS_trimNametag(nametag?: string) {
    const trimmed = nametag?.trim();
    return trimmed === "" ? undefined : trimmed;
}

export function CS_validateNametag(nametag?: string, forItem?: CS_Item): boolean {
    if (nametag === undefined) {
        return true;
    }
    if (forItem !== undefined && !CS_hasNametag(forItem)) {
        throw new Error("invalid nametag");
    }
    if (nametag[0] === " " || !CS_NAMETAG_RE.test(nametag)) {
        throw new Error("invalid nametag");
    }
    return true;
}

export const CS_safeValidateNametag = safe(CS_validateNametag);

export function CS_requireNametag(nametag?: string, forItem?: CS_Item): boolean {
    if (nametag === undefined || nametag.trim().length === 0) {
        throw new Error("item requires a nametag");
    }
    return CS_validateNametag(nametag, forItem);
}

export const CS_safeRequireNametag = safe(CS_requireNametag);

export function CS_hasStatTrak(item: CS_Item): boolean {
    return CS_STATTRAKABLE_ITEMS.includes(item.type) && !item.free;
}

export function CS_validateStatTrak(stattrak?: number, forItem?: CS_Item): boolean {
    if (stattrak === undefined) {
        return true;
    }
    if (Number.isNaN(stattrak)) {
        throw new Error("invalid stattrak");
    }
    if (forItem !== undefined && !CS_hasStatTrak(forItem)) {
        throw new Error("invalid stattrak");
    }
    if (stattrak < CS_MIN_STATTRAK || stattrak > CS_MAX_STATTRAK) {
        throw new Error("invalid stattrak");
    }
    return true;
}

export const CS_safeValidateStatTrak = safe(CS_validateStatTrak);

export function CS_isStorageUnitTool(item: number | CS_Item): boolean {
    const { def, type } = CS_Economy.get(item);
    return type === "tool" && def === CS_STORAGE_UNIT_TOOL_DEF;
}

export function CS_expectStorageUnitTool(item: CS_Item) {
    if (!CS_isStorageUnitTool(item)) {
        throw new Error("item is not a storage unit");
    }
    return true;
}

export const CS_safeValidateStorageToolUnit = safe(CS_expectStorageUnitTool);

export function CS_isNametagTool(toolItem: number | CS_Item): boolean {
    const { def, type } = CS_Economy.get(toolItem);
    return type === "tool" && def === CS_NAMETAG_TOOL_DEF;
}

export function CS_expectNametagTool(item: CS_Item) {
    if (!CS_isNametagTool(item)) {
        throw new Error("item is not a nametag tool");
    }
    return true;
}

export function isStatTrakSwapTool(item: number | CS_Item): boolean {
    const { def, type } = CS_Economy.get(item);
    return type === "tool" && def === CS_STATTRAK_SWAP_TOOL_DEF;
}

export function expectStatTrakSwapTool(item: CS_Item) {
    if (!isStatTrakSwapTool(item)) {
        throw new Error("item is not a stattrak swap tool");
    }
    return true;
}

export function CS_getWearLabel(wear: number): string {
    if (wear <= CS_MAX_FACTORY_NEW_WEAR) {
        return "FN";
    }
    if (wear <= CS_MAX_MINIMAL_WEAR_WEAR) {
        return "MW";
    }
    if (wear <= CS_MAX_FIELD_TESTED_WEAR) {
        return "FT";
    }
    if (wear <= CS_MAX_WELL_WORN_WEAR) {
        return "WW";
    }
    return "BS";
}

export function CS_getStickerCategories(): string[] {
    return Array.from(CS_Economy.categories).sort();
}

export function CS_getStickers(): CS_Item[] {
    return CS_Economy.stickers;
}

export function CS_resolveItemImage(baseUrl: string, item: number | CS_Item, wear?: number): string {
    item = CS_Economy.get(item);
    const { id, image } = item;

    if (CS_hasWear(item) && wear !== undefined) {
        switch (true) {
            case wear < 1 / 3:
                return `${baseUrl}/${id}_light.png`;
            case wear < 2 / 3:
                return `${baseUrl}/${id}_medium.png`;
            default:
                return `${baseUrl}/${id}_heavy.png`;
        }
    }

    if (image === undefined) {
        return `${baseUrl}/${id}.png`;
    }

    if (image.charAt(0) === "/") {
        return `${baseUrl}${image}`;
    }

    return image;
}

export function CS_resolveCaseSpecialsImage(baseUrl: string, item: number | CS_Item): string {
    const { id, type, specialsimage, specials } = CS_Economy.get(item);
    if (type !== "case") {
        throw new Error("item is not a case");
    }
    if (specials === undefined) {
        throw new Error("case does not have special items");
    }
    if (specialsimage) {
        return `${baseUrl}/${id}_rare.png`;
    }
    return `${baseUrl}/default_rare_item.png`;
}
