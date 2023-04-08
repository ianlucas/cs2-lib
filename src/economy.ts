/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { CS_Team } from "./teams";
import { compare } from "./util";

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
    musicid?: number;
    paintid?: number;
    stickerid?: number;
}

type CS_EconomyPredicate = Partial<CS_Item> & { team?: CS_Team };
function filterItems(predicate: CS_EconomyPredicate) {
    return function filter(item: CS_Item) {
        return (
            compare(predicate.type, item.type) &&
            compare(predicate.free, item.free) &&
            compare(predicate.model, item.model) &&
            compare(predicate.base, item.base) &&
            (predicate.team === undefined ||
                predicate.teams === undefined ||
                predicate.teams.includes(predicate.team))
        );
    };
}

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
