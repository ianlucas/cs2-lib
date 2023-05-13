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
    model?: string;
    name: string;
    rarity: string;
    teams?: CS_Team[];
    type: "glove" | "melee" | "musickit" | "sticker" | "weapon";
}

/**
 * The CS_ItemDefinition interface contains more technical information about an
 * item and can be used for integration with Sourcemod.
 */
export interface CS_ItemDefinition {
    classname?: string;
    def?: number;
    id: number;
    isglove?: boolean;
    ismelee?: boolean;
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

    static setItems(items: CS_Item[]) {
        CS_Economy.items = items;
        CS_Economy.itemsMap.clear();
        items.forEach((item) => CS_Economy.itemsMap.set(item.id, item));
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
}
