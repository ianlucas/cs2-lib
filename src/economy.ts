/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { CS_Team } from "./teams.js";
import { compare } from "./util.js";

/**
 * The CS_Item interface is designed for use in client-facing interfaces and
 * contains generic information about a particular item.
 */
export interface CS_Item {
    base?: boolean;
    category: string;
    free?: boolean;
    id: number;
    image: string;
    localimage?: number;
    model?: string;
    name: string;
    rarity: string;
    teams?: CS_Team[];
    type: "glove" | "melee" | "musickit" | "sticker" | "weapon";
}

/**
 * The CS_ItemDefinition interface contains more technical information about an
 * item and can be used for integration with SourceMod.
 */
export interface CS_ItemDefinition {
    def?: number;
    id: number;
    musicid?: number;
    paintid?: number;
    stickerid?: number;
}

export const CS_MIN_FLOAT = 0.000001;
export const CS_MAX_FLOAT = 0.999999;
export const CS_MIN_FACTORY_NEW_FLOAT = CS_MIN_FLOAT;
export const CS_MAX_FACTORY_NEW_FLOAT = 0.07;
export const CS_MIN_MINIMAL_WEAR_FLOAT = 0.070001;
export const CS_MAX_MINIMAL_WEAR_FLOAT = 0.15;
export const CS_MIN_FIELD_TESTED_FLOAT = 0.150001;
export const CS_MAX_FIELD_TESTED_FLOAT = 0.37;
export const CS_MIN_WELL_WORN_FLOAT = 0.370001;
export const CS_MAX_WELL_WORN_FLOAT = 0.44;
export const CS_MIN_BATTLE_SCARRED_FLOAT = 0.440001;
export const CS_MAX_BATTLE_SCARRED_FLOAT = CS_MAX_FLOAT;
export const CS_MIN_SEED = 1;
export const CS_MAX_SEED = 1000;
export const CS_FLOATABLE_ITEMS = ["glove", "melee", "weapon"];
export const CS_NAMETAGGABLE_ITEMS = ["melee", "weapon"];
export const CS_SEEDABLE_ITEMS = ["weapon", "melee"];
export const CS_STATTRAKABLE_ITEMS = ["melee", "weapon"];
export const CS_STICKERABLE_ITEMS = ["weapon"];
export const CS_nametagRE = /^[A-Za-z0-9|][A-Za-z0-9|\s]{0,19}$/;
export const CS_MIN_STICKER_FLOAT = 0;
export const CS_MAX_STICKER_FLOAT = 0.9;
export const CS_DEFAULT_GENERATED_HEAVY = 0b001;
export const CS_DEFAULT_GENERATED_MEDIUM = 0b010;
export const CS_DEFAULT_GENERATED_LIGHT = 0b100;

type CS_EconomyPredicate = Partial<CS_Item> & { team?: CS_Team };
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

export interface CS_CategoryMenuItem {
    category: string;
    label: string;
    unique: boolean;
}

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
        label: "Music Kit",
        category: "musickit",
        unique: true
    }
];

export class CS_Economy {
    static items: CS_Item[] = [];
    static itemsDef: CS_ItemDefinition[] = [];
    static itemsMap: Map<number, CS_Item> = new Map();
    static itemsDefMap: Map<number, CS_ItemDefinition> = new Map();
    static stickerCategories: string[] = [];
    static stickers: CS_Item[];

    static setItems(items: CS_Item[]) {
        CS_Economy.stickers = [];
        CS_Economy.stickerCategories = [];
        CS_Economy.items = items;
        CS_Economy.itemsMap.clear();
        items.forEach((item) => {
            CS_Economy.itemsMap.set(item.id, item);
            if (item.type === "sticker") {
                CS_Economy.stickers.push(item);
                if (
                    CS_Economy.stickerCategories.indexOf(item.category) === -1
                ) {
                    CS_Economy.stickerCategories.push(item.category);
                }
            }
        });
        CS_Economy.stickerCategories.sort();
    }

    static setItemsDef(itemDefs: CS_ItemDefinition[]) {
        CS_Economy.itemsDef = itemDefs;
        CS_Economy.itemsDefMap.clear();
        itemDefs.forEach((item) => CS_Economy.itemsDefMap.set(item.id, item));
    }

    static getById(id: number) {
        const item = CS_Economy.itemsMap.get(id);
        if (item === undefined) {
            throw new Error("item not found");
        }
        return item;
    }

    static getDefById(id: number) {
        const item = CS_Economy.itemsDefMap.get(id);
        if (item === undefined) {
            throw new Error("item not found");
        }
        return item;
    }

    static find(predicate: CS_EconomyPredicate) {
        const item = CS_Economy.items.find(filterItems(predicate));
        if (item === undefined) {
            throw new Error("item not found");
        }
        return item;
    }

    static filter(predicate: CS_EconomyPredicate) {
        const items = CS_Economy.items.filter(filterItems(predicate));
        if (items.length === 0) {
            throw new Error("items not found");
        }
        return items;
    }

    static hasFloat(item: CS_Item) {
        return CS_FLOATABLE_ITEMS.includes(item.type);
    }

    static validateFloat(item: CS_Item, float: number) {
        if (!CS_Economy.hasFloat(item)) {
            throw new Error("invalid float");
        }
        if (float < CS_MIN_FLOAT || float > CS_MAX_FLOAT) {
            throw new Error("invalid float");
        }
    }

    static hasSeed(item: CS_Item) {
        return CS_SEEDABLE_ITEMS.includes(item.type);
    }

    static validateSeed(item: CS_Item, seed: number) {
        if (!CS_Economy.hasSeed(item)) {
            throw new Error("invalid seed");
        }
        if (seed < CS_MIN_SEED || seed > CS_MAX_SEED) {
            throw new Error("invalid seed");
        }
    }

    static hasStickers(item: CS_Item) {
        return CS_STICKERABLE_ITEMS.includes(item.type);
    }

    static validateStickers(
        item: CS_Item,
        stickers: (number | null)[],
        stickerswear: (number | null)[] = []
    ) {
        if (!CS_Economy.hasStickers(item)) {
            throw new Error("invalid stickers");
        }
        if (stickers.length > 4) {
            throw new Error("invalid stickers");
        }
        for (const [index, sticker] of stickers.entries()) {
            if (sticker === null) {
                if (stickerswear[index] !== undefined) {
                    throw new Error("invalid stickers");
                }
                continue;
            }
            if (CS_Economy.getById(sticker).type !== "sticker") {
                throw new Error("invalid stickers");
            }
            const wear = stickerswear[index];
            if (
                typeof wear === "number" &&
                wear < CS_MIN_STICKER_FLOAT &&
                wear > CS_MAX_STICKER_FLOAT
            ) {
                throw new Error("invalid stickers");
            }
        }
    }

    static hasNametag(item: CS_Item) {
        return CS_NAMETAGGABLE_ITEMS.includes(item.type);
    }

    static validateNametag(item: CS_Item, nametag: string) {
        if (!CS_Economy.hasNametag(item)) {
            throw new Error("invalid nametag");
        }
        if (!CS_nametagRE.test(nametag.trim())) {
            throw new Error("invalid nametag");
        }
    }

    static hasStattrak(item: CS_Item) {
        return CS_STATTRAKABLE_ITEMS.includes(item.type);
    }

    static validateStattrak(item: CS_Item, stattrak: boolean) {
        if (stattrak === true && !CS_Economy.hasStattrak(item)) {
            throw new Error("invalid stattrak");
        }
    }

    static getFloatLabel(float: number) {
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

    static getStickerCategories() {
        return CS_Economy.stickerCategories;
    }

    static getStickers() {
        return CS_Economy.stickers;
    }

    static resolveImageSrc(baseUrl: string, id: number, float?: number) {
        const csItem = CS_Economy.getById(id);
        if (csItem.localimage === undefined) {
            if (csItem.image.charAt(0) === "/") {
                return `${baseUrl}${csItem.image}`;
            }
            return csItem.image;
        }
        if (csItem.base) {
            return `${baseUrl}/${id}.png`;
        }
        const hasLight = csItem.localimage & CS_DEFAULT_GENERATED_LIGHT;
        const url = `${baseUrl}/${id}`;
        if (float === undefined) {
            if (hasLight) {
                return `${url}_light.png`;
            }
            return csItem.image;
        }
        const hasMedium = csItem.localimage & CS_DEFAULT_GENERATED_MEDIUM;
        const hasHeavy = csItem.localimage & CS_DEFAULT_GENERATED_HEAVY;
        if (float < CS_MAX_MINIMAL_WEAR_FLOAT && hasLight) {
            return `${url}_light.png`;
        }
        if (float < CS_MAX_FIELD_TESTED_FLOAT && hasMedium) {
            return `${url}_medium.png`;
        }
        if (hasHeavy) {
            return `${url}_heavy.png`;
        }
        return csItem.image;
    }
}
