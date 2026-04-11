/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CS2ContainerType, CS2ItemType, CS2ItemTypeValues } from "../../../src/economy-types.ts";
import { assert } from "../../../src/utils.ts";
import { tryAddTranslation } from "./translations.ts";
import { ItemGeneratorContext } from "../types.ts";

export function getCollection(ctx: ItemGeneratorContext, itemId: number, collection?: string) {
    let collectionImage: string | undefined;
    if (collection !== undefined) {
        const itemSet = ctx.gameItems.item_sets[collection];
        assert(itemSet);
        assert(itemSet.name);
        tryAddTranslation(ctx, itemId, "collectionName", itemSet.name);
        tryAddTranslation(ctx, itemId, "collectionDesc", itemSet.set_description);
        collectionImage = ctx.itemSetImage[collection];
    }
    return { collection, collectionImage };
}

export function getItemCollection(ctx: ItemGeneratorContext, itemId: number, itemKey: string) {
    return getCollection(ctx, itemId, ctx.itemSetItemKey[itemKey]);
}

export function addContainerItem(ctx: ItemGeneratorContext, itemKey: string, id: number) {
    if (!ctx.containerItems.has(itemKey)) {
        ctx.containerItems.set(itemKey, id);
    }
}

export function getClientLootListItems(ctx: ItemGeneratorContext, clientLootListKey: string, items: string[] = []) {
    if (!ctx.gameItems.client_loot_lists[clientLootListKey]) {
        return [];
    }
    for (const itemOrClientLootListKey of Object.keys(ctx.gameItems.client_loot_lists[clientLootListKey])) {
        if (ctx.containerItems.has(itemOrClientLootListKey)) {
            items.push(itemOrClientLootListKey);
        } else {
            getClientLootListItems(ctx, itemOrClientLootListKey, items);
        }
    }
    return items;
}

export function getContainerType(name?: string, type?: CS2ItemTypeValues) {
    switch (true) {
        case name?.includes("Souvenir"):
            return CS2ContainerType.SouvenirCase;
        case type === CS2ItemType.Weapon:
            return CS2ContainerType.WeaponCase;
        case type === CS2ItemType.Sticker:
            return CS2ContainerType.StickerCapsule;
        case type === CS2ItemType.Graffiti:
            return CS2ContainerType.GraffitiBox;
        default:
            return undefined;
    }
}
