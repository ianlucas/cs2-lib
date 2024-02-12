/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CS_unlockCase, CS_validateUnlockedItem } from "./economy-case.js";
import {
    CS_Economy,
    CS_MAX_STATTRAK,
    CS_MAX_WEAR,
    CS_NAMETAG_TOOL_DEF,
    CS_NO_STICKER,
    CS_NO_STICKER_WEAR,
    CS_STICKER_WEAR_FACTOR,
    CS_STORAGE_UNIT_TOOL_DEF,
    CS_SWAP_STATTRAK_TOOL_DEF,
    CS_hasNametag,
    CS_hasStickers,
    CS_validateNametag,
    CS_validateSeed,
    CS_validateStatTrak,
    CS_validateStickers,
    CS_validateWear
} from "./economy.js";
import { CS_TEAM_CT, CS_TEAM_T, CS_Team } from "./teams.js";
import { float } from "./util.js";

export const CS_INVENTORY_EQUIPPABLE_ITEMS = [
    "agent",
    "glove",
    "graffiti",
    "melee",
    "musickit",
    "patch",
    "pin",
    "weapon"
];

export const CS_INVENTORY_TIMESTAMP = 1707696138408;

function timestamp() {
    return Math.ceil((Date.now() - CS_INVENTORY_TIMESTAMP) / 1000);
}

export function CS_validateInventoryItem({
    id,
    nametag,
    seed,
    stattrak,
    stickers,
    stickerswear,
    wear
}: CS_InventoryItem) {
    const item = CS_Economy.getById(id);
    if (wear !== undefined) {
        CS_validateWear(wear, item);
    }
    if (seed !== undefined) {
        CS_validateSeed(seed, item);
    }
    if (stickers !== undefined) {
        CS_validateStickers(item, stickers, stickerswear);
    }
    if (nametag !== undefined) {
        CS_validateNametag(nametag, item);
    }
    if (stattrak !== undefined) {
        CS_validateStatTrak(stattrak, item);
    }
}

export interface CS_InventoryItem {
    equipped?: boolean;
    equippedCT?: boolean;
    equippedT?: boolean;
    id: number;
    nametag?: string;
    seed?: number;
    stattrak?: number;
    stickers?: number[];
    stickerswear?: number[];
    storage?: CS_InventoryItem[];
    updatedat?: number;
    wear?: number;
}

export interface CS_InventoryOptions {
    items?: CS_InventoryItem[];
    limit?: number;
    storageUnitLimit?: number;
}

export class CS_Inventory {
    private items: CS_InventoryItem[];
    private limit: number;
    private storageUnitLimit: number;

    constructor({ items, limit, storageUnitLimit }: CS_InventoryOptions) {
        this.items = items ?? [];
        this.limit = limit ?? 256;
        this.storageUnitLimit = storageUnitLimit ?? 32;
    }

    full(): boolean {
        return this.items.length === this.limit;
    }

    add(inventoryItem: CS_InventoryItem) {
        if (this.full()) {
            return this;
        }
        CS_validateInventoryItem(inventoryItem);
        this.items.unshift({
            ...inventoryItem,
            equipped: undefined,
            equippedCT: undefined,
            equippedT: undefined,
            updatedat: timestamp()
        });
        return this;
    }

    addWithNametag(toolIndex: number, itemId: number, nametag: string) {
        if (nametag === "") {
            throw new Error("invalid nametag");
        }
        const toolItem = CS_Economy.getById(this.items[toolIndex].id);
        if (toolItem.type !== "tool" || toolItem.def !== CS_NAMETAG_TOOL_DEF) {
            throw new Error("tool must be name tag");
        }
        const targetItem = CS_Economy.getById(itemId);
        if (!CS_hasNametag(targetItem)) {
            throw new Error("item does not have nametag");
        }
        this.items.splice(toolIndex, 1);
        this.add({
            id: itemId,
            nametag
        });
        return this;
    }

    edit(index: number, changes: Partial<CS_InventoryItem>) {
        if (!this.items[index]) {
            throw new Error("invalid inventory item");
        }
        if (changes.id !== undefined && this.items[index].id !== changes.id) {
            throw new Error("item id cannot be modified");
        }
        const inventoryItem = {
            ...this.items[index],
            ...changes
        };
        CS_validateInventoryItem(inventoryItem);
        this.items[index] = {
            ...inventoryItem,
            updatedat: timestamp()
        };
        return this;
    }

    equip(index: number, team?: CS_Team) {
        const inventoryItem = this.items[index];
        if (!inventoryItem) {
            return this;
        }
        if (inventoryItem.equipped) {
            return this;
        }
        if (team === CS_TEAM_CT && inventoryItem.equippedCT) {
            return this;
        }
        if (team === CS_TEAM_T && inventoryItem.equippedT) {
            return this;
        }
        const item = CS_Economy.getById(inventoryItem.id);
        if (!CS_INVENTORY_EQUIPPABLE_ITEMS.includes(item.type)) {
            return this;
        }
        if (team === undefined && item.teams !== undefined) {
            return this;
        }
        if (team !== undefined && !item.teams?.includes(team)) {
            return this;
        }
        for (let other = 0; other < this.items.length; other++) {
            const current = this.items[other];
            if (index === other) {
                current.equipped = team === undefined ? true : undefined;
                current.equippedCT = team === CS_TEAM_CT ? true : current.equippedCT;
                current.equippedT = team === CS_TEAM_T ? true : current.equippedT;
            } else {
                const currentItem = CS_Economy.getById(current.id);
                if (currentItem.type === item.type && (item.type !== "weapon" || currentItem.model === item.model)) {
                    current.equipped = team === undefined ? undefined : current.equipped;
                    current.equippedCT = team === CS_TEAM_CT ? undefined : current.equippedCT;
                    current.equippedT = team === CS_TEAM_T ? undefined : current.equippedT;
                }
            }
        }
        return this;
    }

    unequip(index: number, team?: CS_Team) {
        if (!this.items[index]) {
            return this;
        }
        const item = this.items[index];
        item.equipped = team === undefined ? undefined : item.equipped;
        item.equippedCT = team === CS_TEAM_CT ? undefined : item.equippedCT;
        item.equippedT = team === CS_TEAM_T ? undefined : item.equippedT;
        return this;
    }

    unlockCase(unlockedItem: ReturnType<typeof CS_unlockCase>, caseIndex: number, keyIndex?: number) {
        if (!this.items[caseIndex] || (keyIndex !== undefined && !this.items[keyIndex])) {
            throw new Error("invalid inventory item(s)");
        }
        const caseItem = CS_Economy.getById(this.items[caseIndex].id);
        CS_validateUnlockedItem(caseItem, unlockedItem);
        const keyItem = keyIndex !== undefined ? CS_Economy.getById(this.items[keyIndex].id) : undefined;
        if (keyItem !== undefined && keyItem.type !== "key") {
            throw new Error("item is not a key");
        }
        if (caseItem.keys !== undefined && (keyItem === undefined || !caseItem.keys.includes(keyItem.id))) {
            throw new Error("case needs a valid key to be open");
        }
        if (caseItem.keys === undefined && keyItem !== undefined) {
            throw new Error("case does not need a key");
        }
        keyIndex = keyIndex !== undefined ? (keyIndex > caseIndex ? keyIndex - 1 : keyIndex) : undefined;
        this.items.splice(caseIndex, 1);
        if (keyIndex !== undefined) {
            this.items.splice(keyIndex, 1);
        }
        this.items.unshift({
            id: unlockedItem.id,
            ...unlockedItem.attributes,
            updatedat: timestamp()
        });
        return this;
    }

    renameItem(toolIndex: number, targetIndex: number, nametag?: string) {
        nametag = nametag === "" ? undefined : nametag;
        if (!this.items[toolIndex] || !this.items[targetIndex]) {
            throw new Error("invalid inventory item(s)");
        }
        const toolItem = CS_Economy.getById(this.items[toolIndex].id);
        if (toolItem.type !== "tool" || toolItem.def !== CS_NAMETAG_TOOL_DEF) {
            throw new Error("tool must be name tag");
        }
        const targetItem = CS_Economy.getById(this.items[targetIndex].id);
        if (!CS_hasNametag(targetItem)) {
            throw new Error("item does not have nametag");
        }
        if (nametag !== undefined) {
            CS_validateNametag(nametag);
        }
        this.items[targetIndex].nametag = nametag;
        this.items[targetIndex].updatedat = timestamp();
        this.items.splice(toolIndex, 1);
        return this;
    }

    renameStorageUnit(index: number, nametag: string) {
        if (nametag.trim() === "") {
            throw new Error("invalid nametag");
        }
        if (!this.items[index]) {
            throw new Error("invalid inventory item");
        }
        const item = CS_Economy.getById(this.items[index].id);
        if (item.def !== CS_STORAGE_UNIT_TOOL_DEF) {
            throw new Error("item is not a storage unit");
        }
        CS_validateNametag(nametag);
        this.items[index].nametag = nametag;
        this.items[index].updatedat = timestamp();
        return this;
    }

    isStorageUnitFull(index: number) {
        return this.items[index]?.storage?.length === this.storageUnitLimit;
    }

    hasItemsInStorageUnit(index: number) {
        return (this.items[index]?.storage?.length ?? 0) > 0;
    }

    canDepositToStorageUnit(index: number) {
        return this.items[index]?.nametag !== undefined && !this.isStorageUnitFull(index);
    }

    getStorageUnitItems(index: number) {
        return this.items[index]?.storage ?? [];
    }

    depositToStorageUnit(index: number, indexes: number[]) {
        if (!this.items[index]) {
            throw new Error("invalid inventory item");
        }
        const inventoryItem = this.items[index];
        const item = CS_Economy.getById(inventoryItem.id);
        if (item.def !== CS_STORAGE_UNIT_TOOL_DEF) {
            throw new Error("item is not a storage unit");
        }
        if (indexes.length === 0) {
            throw new Error("no items to deposit");
        }
        if (!this.canDepositToStorageUnit(index)) {
            throw new Error("cannot deposit to storage unit");
        }
        for (const index of indexes) {
            if (!this.items[index]) {
                throw new Error("invalid inventory item");
            }
            const item = CS_Economy.getById(this.items[index].id);
            if (item.def === CS_STORAGE_UNIT_TOOL_DEF) {
                throw new Error("cannot deposit storage unit");
            }
        }
        this.items[index].storage = (inventoryItem.storage ?? []).concat(
            indexes.map((index) => {
                return this.items[index];
            })
        );
        this.items[index].updatedat = timestamp();
        this.items = this.items.filter((_, index) => !indexes.includes(index));
        return this;
    }

    retrieveFromStorageUnit(index: number, indexes: number[]) {
        if (!this.items[index]) {
            throw new Error("invalid inventory item");
        }
        const inventoryItem = this.items[index];
        const item = CS_Economy.getById(inventoryItem.id);

        if (item.def !== CS_STORAGE_UNIT_TOOL_DEF) {
            throw new Error("item is not a storage unit");
        }
        const stored = inventoryItem.storage;
        if (!stored || indexes.length === 0) {
            throw new Error("no items to retrieve");
        }
        if (!this.hasItemsInStorageUnit(index)) {
            throw new Error("storage unit is empty");
        }
        for (const index of indexes) {
            if (!stored[index]) {
                throw new Error("invalid storage unit item");
            }
            stored[index].updatedat = timestamp();
        }
        this.items = [...indexes.map((index) => stored[index]), ...this.items];
        const storage = stored.filter((_, index) => !indexes.includes(index));
        this.items[index].storage = storage.length > 0 ? storage : undefined;
        return this;
    }

    applyItemSticker(itemIndex: number, stickerItemIndex: number, stickerIndex: number) {
        if (!this.items[itemIndex] || !this.items[stickerItemIndex]) {
            throw new Error("invalid inventory item(s)");
        }
        const inventoryItem = this.items[itemIndex];
        const item = CS_Economy.getById(inventoryItem.id);
        if (!CS_hasStickers(item)) {
            throw new Error("item does not have stickers");
        }
        const sticker = CS_Economy.getById(this.items[stickerItemIndex].id);
        if (sticker.type !== "sticker") {
            throw new Error("not applying a sticker");
        }
        const stickers = inventoryItem.stickers ?? [CS_NO_STICKER, CS_NO_STICKER, CS_NO_STICKER, CS_NO_STICKER];
        if (stickers[stickerIndex] !== CS_NO_STICKER) {
            throw new Error("cant apply existing sticker");
        }
        stickers[stickerIndex] = sticker.id;
        inventoryItem.stickers = stickers;
        inventoryItem.updatedat = timestamp();
        this.items.splice(stickerItemIndex, 1);
        return this;
    }

    scrapeItemSticker(itemIndex: number, stickerIndex: number) {
        const inventoryItem = this.items[itemIndex];
        if (!inventoryItem || !inventoryItem.stickers) {
            throw new Error("invalid inventory item");
        }
        const { stickers } = inventoryItem;
        if (typeof stickers[stickerIndex] !== "number") {
            throw new Error("invalid sticker index");
        }
        const stickersWear = inventoryItem.stickerswear ?? [
            CS_NO_STICKER_WEAR,
            CS_NO_STICKER_WEAR,
            CS_NO_STICKER_WEAR,
            CS_NO_STICKER_WEAR
        ];
        const stickerWear = stickersWear[stickerIndex] || CS_NO_STICKER_WEAR;
        const nextWear = float(stickerWear + CS_STICKER_WEAR_FACTOR);
        if (nextWear > CS_MAX_WEAR) {
            stickers[stickerIndex] = CS_NO_STICKER;
            stickersWear[stickerIndex] = CS_NO_STICKER_WEAR;
            inventoryItem.stickers = stickers.filter((id) => id !== CS_NO_STICKER).length > 0 ? stickers : undefined;
            inventoryItem.stickerswear =
                stickersWear.filter((wear) => wear !== CS_NO_STICKER_WEAR).length > 0 ? stickersWear : undefined;
            return this;
        }
        stickersWear[stickerIndex] = nextWear;
        inventoryItem.stickerswear = stickersWear;
        inventoryItem.updatedat = timestamp();
        return this;
    }

    incrementItemStatTrak(itemIndex: number) {
        const inventoryItem = this.items[itemIndex];
        if (!inventoryItem || inventoryItem.stattrak === undefined) {
            throw new Error("invalid inventory item");
        }
        if (inventoryItem.stattrak < CS_MAX_STATTRAK) {
            inventoryItem.stattrak++;
            inventoryItem.updatedat = timestamp();
        }
        return this;
    }

    swapItemsStatTrak(toolIndex: number, fromIndex: number, toIndex: number) {
        if (fromIndex === toIndex) {
            throw new Error("indexes must be different");
        }
        const fromInventoryItem = this.items[fromIndex];
        const toInventoryItem = this.items[toIndex];
        if (
            !this.items[toolIndex] ||
            !fromInventoryItem ||
            !toInventoryItem ||
            fromInventoryItem.stattrak === undefined ||
            toInventoryItem.stattrak === undefined
        ) {
            throw new Error("invalid inventory items");
        }
        const toolItem = CS_Economy.getById(this.items[toolIndex].id);
        if (toolItem.def !== CS_SWAP_STATTRAK_TOOL_DEF) {
            throw new Error("tool must be stattrak swap tool");
        }
        const fromItem = CS_Economy.getById(fromInventoryItem.id);
        const toItem = CS_Economy.getById(toInventoryItem.id);
        if (fromItem.type !== toItem.type) {
            throw new Error("items must be of the same type");
        }
        if (fromItem.type !== "musickit" && fromItem.def !== toItem.def) {
            throw new Error("items must be of the same type");
        }
        const fromStattrak = fromInventoryItem.stattrak;
        fromInventoryItem.stattrak = toInventoryItem.stattrak;
        fromInventoryItem.updatedat = timestamp();
        toInventoryItem.stattrak = fromStattrak;
        toInventoryItem.updatedat = timestamp();
        this.items.splice(toolIndex, 1);
        return this;
    }

    get(index: number) {
        if (!this.items[index]) {
            throw new Error("invalid inventory item");
        }
        return this.items[index];
    }

    getItem(index: number) {
        return CS_Economy.getById(this.get(index).id);
    }

    getExtended(index: number) {
        const inventoryItem = this.get(index);
        const item = CS_Economy.getById(inventoryItem.id);
        return { ...inventoryItem, item };
    }

    getAll(): CS_InventoryItem[] {
        return this.items;
    }

    remove(index: number) {
        if (!this.items[index]) {
            return this;
        }
        this.items.splice(index, 1);
        return this;
    }

    removeAll() {
        while (this.items[0]) {
            this.items.splice(0, 1);
        }
    }

    size() {
        return this.items.length;
    }

    copy() {
        return new CS_Inventory({
            items: this.items,
            limit: this.limit
        });
    }
}
