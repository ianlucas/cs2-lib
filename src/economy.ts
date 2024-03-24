/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CS_Team } from "./teams.js";
import { assert, compare, safe } from "./util.js";

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

export type CS_ItemTranslations = Record<string, Record<number, Record<string, string>>>;

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
export const CS_SEEDABLE_ITEMS = ["weapon", "melee", "glove"];
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
export const CS_NONE = 0;

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
    static categories = new Set<string>();
    static items = new Map<number, CS_Item>();
    static itemsAsArray: CS_Item[] = [];
    static stickers = new Set<CS_Item>();

    static use(items: CS_Item[]) {
        CS_Economy.categories.clear();
        CS_Economy.items.clear();
        CS_Economy.itemsAsArray = [];
        CS_Economy.stickers.clear();
        for (const item of items) {
            const clone = { ...item };
            CS_Economy.itemsAsArray.push(clone);
            CS_Economy.items.set(item.id, clone);
            if (CS_isSticker(item)) {
                assert(item.category, `Sticker item '${item.id}' does not have a category.`);
                CS_Economy.stickers.add(clone);
                CS_Economy.categories.add(item.category);
            }
        }
    }

    static getById(id: number) {
        const item = CS_Economy.items.get(id);
        assert(item, `The given id '${id}' was not present in CS_Economy.items.`);
        return item;
    }

    static get(idOrItem: number | CS_Item) {
        return typeof idOrItem === "number" ? CS_Economy.getById(idOrItem) : idOrItem;
    }

    static applyTranslation(translation: CS_ItemTranslations[number]) {
        CS_Economy.categories.clear();
        for (const [id, fields] of Object.entries(translation)) {
            const item = CS_Economy.items.get(Number(id));
            if (item === undefined) {
                continue;
            }
            Object.assign(item, fields);
            if (fields.category !== undefined && item.type === "sticker") {
                CS_Economy.categories.add(fields.category);
            }
        }
    }
}

export function CS_findItem(predicate: CS_EconomyPredicate): CS_Item {
    const item = CS_Economy.itemsAsArray.find(filterItems(predicate));
    assert(item, "No items found.");
    return item;
}

export function CS_filterItems(predicate: CS_EconomyPredicate): CS_Item[] {
    const items = CS_Economy.itemsAsArray.filter(filterItems(predicate));
    assert(items.length > 0, "No items found.");
    return items;
}

export function CS_isC4(item: number | CS_Item): boolean {
    return CS_Economy.get(item).category === "c4";
}

export function CS_isSticker(item: number | CS_Item): boolean {
    return CS_Economy.get(item).type === "sticker";
}

export function CS_isGlove(item: number | CS_Item): boolean {
    return CS_Economy.get(item).type === "glove";
}

export function CS_expectSticker(item: number | CS_Item) {
    assert(CS_isSticker(item), `Item is not a sticker.`);
    return true;
}

export function CS_hasWear(item: CS_Item): boolean {
    return CS_WEARABLE_ITEMS.includes(item.type) && !item.free && item.index !== 0;
}

export function CS_validateWear(wear?: number, item?: CS_Item): boolean {
    if (wear === undefined) {
        return true;
    }
    assert(!Number.isNaN(wear), "Wear must be a number.");
    assert(String(wear).length <= String(CS_WEAR_FACTOR).length, "Wear value is too long.");
    assert(wear >= CS_MIN_WEAR && wear <= CS_MAX_WEAR, "Wear value must be between CS_MIN_WEAR and CS_MAX_WEAR.");
    if (item !== undefined) {
        assert(CS_hasWear(item), "Item does not have wear.");
        assert(item.wearmin === undefined || wear >= item.wearmin, "Wear value is below the minimum allowed.");
        assert(item.wearmax === undefined || wear <= item.wearmax, "Wear value is above the maximum allowed.");
    }
    return true;
}

export const CS_safeValidateWear = safe(CS_validateWear);

export function CS_hasSeed(item: CS_Item): boolean {
    return CS_SEEDABLE_ITEMS.includes(item.type) && !item.free && item.index !== 0;
}

export function CS_validateSeed(seed?: number, item?: CS_Item): boolean {
    if (seed === undefined) {
        return true;
    }
    assert(!Number.isNaN(seed), "Seed must be a valid number.");
    assert(item === undefined || CS_hasSeed(item), "Item does not have a seed.");
    assert(Number.isInteger(seed), "Seed must be an integer.");
    assert(seed >= CS_MIN_SEED && seed <= CS_MAX_SEED, `Seed must be between CS_MIN_SEED and CS_MAX_SEED.`);
    return true;
}

export const CS_safeValidateSeed = safe(CS_validateSeed);

export function CS_hasStickers(item: CS_Item): boolean {
    return CS_STICKERABLE_ITEMS.includes(item.type) && !CS_isC4(item);
}

export function CS_validateStickers(stickers?: number[], wears?: number[], item?: CS_Item): boolean {
    if (stickers === undefined) {
        assert(wears === undefined, "Stickers array is undefined.");
        return true;
    }
    assert(stickers.length === 4, "Stickers array must contain exactly 4 elements.");
    assert(wears === undefined || wears.length === 4, "Stickers wear array must contain exactly 4 elements.");
    assert(item === undefined || CS_hasStickers(item), "The provided item does not have stickers.");
    for (const [index, stickerId] of stickers.entries()) {
        if (stickerId === CS_NONE) {
            assert(wears === undefined || wears[index] === CS_NONE, "Sticker wear value is invalid.");
            continue;
        }
        assert(CS_isSticker(stickerId), "The provided ID does not correspond to a sticker.");
        if (wears !== undefined) {
            const wear = wears[index];
            assert(!Number.isNaN(wear), "Sticker wear value must be a valid number.");
            assert(String(wear).length <= String(CS_STICKER_WEAR_FACTOR).length, "Sticker wear value is too long.");
            assert(
                wear >= CS_MIN_STICKER_WEAR && wear <= CS_MAX_STICKER_WEAR,
                "Sticker wear value must be between CS_MIN_STICKER_WEAR and CS_MAX_STICKER_WEAR."
            );
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

export function CS_validateNametag(nametag?: string, item?: CS_Item): boolean {
    if (nametag !== undefined) {
        assert(item === undefined || CS_hasNametag(item), "The provided item does not have a nametag.");
        assert(nametag[0] !== " " && CS_NAMETAG_RE.test(nametag), "Invalid nametag format.");
    }
    return true;
}

export const CS_safeValidateNametag = safe(CS_validateNametag);

export function CS_requireNametag(nametag?: string, item?: CS_Item): boolean {
    assert(nametag === undefined || nametag.trim().length > 0, "Nametag is required.");
    return CS_validateNametag(nametag, item);
}

export const CS_safeRequireNametag = safe(CS_requireNametag);

export function CS_hasStatTrak(item: CS_Item): boolean {
    return CS_STATTRAKABLE_ITEMS.includes(item.type) && !item.free;
}

export function CS_validateStatTrak(stattrak?: number, item?: CS_Item): boolean {
    if (stattrak === undefined) {
        return true;
    }
    assert(item === undefined || CS_hasStatTrak(item), "The provided item does not support stattrak.");
    assert(Number.isInteger(stattrak), "Stattrak value must be an integer.");
    assert(
        stattrak >= CS_MIN_STATTRAK && stattrak <= CS_MAX_STATTRAK,
        "Stattrak value must be between CS_MIN_STATTRAK and CS_MAX_STATTRAK."
    );
    return true;
}

export const CS_safeValidateStatTrak = safe(CS_validateStatTrak);

export function CS_isStorageUnitTool(item: number | CS_Item): boolean {
    const { def, type } = CS_Economy.get(item);
    return type === "tool" && def === CS_STORAGE_UNIT_TOOL_DEF;
}

export function CS_expectStorageUnitTool(item: CS_Item) {
    assert(CS_isStorageUnitTool(item), "Item is not a storage unit.");
    return true;
}

export function CS_isNametagTool(toolItem: number | CS_Item): boolean {
    const { def, type } = CS_Economy.get(toolItem);
    return type === "tool" && def === CS_NAMETAG_TOOL_DEF;
}

export function CS_expectNametagTool(item: number | CS_Item) {
    assert(CS_isNametagTool(item), "Item is not a nametag tool");
    return true;
}

export function CS_isStatTrakSwapTool(item: number | CS_Item): boolean {
    const { def, type } = CS_Economy.get(item);
    return type === "tool" && def === CS_STATTRAK_SWAP_TOOL_DEF;
}

export function expectStatTrakSwapTool(item: CS_Item) {
    assert(CS_isStatTrakSwapTool(item), "Item is not a stattrak swap tool.");
    return true;
}

export function CS_getWearLabel(wear: number): string {
    switch (true) {
        case wear <= CS_MAX_FACTORY_NEW_WEAR:
            return "FN";
        case wear <= CS_MAX_MINIMAL_WEAR_WEAR:
            return "MW";
        case wear <= CS_MAX_FIELD_TESTED_WEAR:
            return "FT";
        case wear <= CS_MAX_WELL_WORN_WEAR:
            return "WW";
        default:
            return "BS";
    }
}

export function CS_getStickerCategories(): string[] {
    return Array.from(CS_Economy.categories).sort();
}

export function CS_getStickers(): CS_Item[] {
    return Array.from(CS_Economy.stickers);
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
