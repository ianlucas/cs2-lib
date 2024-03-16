/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CS_unlockCase, CS_validateCaseKey, CS_validateUnlockedItem } from "./economy-case.js";
import {
    CS_Economy,
    CS_Item,
    CS_MAX_STATTRAK,
    CS_MAX_WEAR,
    CS_NONE,
    CS_STICKER_WEAR_FACTOR,
    CS_expectNametagTool,
    CS_expectSticker,
    CS_expectStorageUnitTool,
    CS_hasStickers,
    CS_isStorageUnitTool,
    CS_requireNametag,
    CS_trimNametag,
    CS_validateNametag,
    CS_validateSeed,
    CS_validateStatTrak,
    CS_validateStickers,
    CS_validateWear,
    expectStatTrakSwapTool
} from "./economy.js";
import { CS_TEAM_CT, CS_TEAM_T, CS_Team } from "./teams.js";
import { assert, float } from "./util.js";

export interface CS_BaseInventoryItem {
    equipped?: boolean;
    equippedCT?: boolean;
    equippedT?: boolean;
    id: number;
    nametag?: string;
    seed?: number;
    stattrak?: number;
    stickers?: number[];
    stickerswear?: number[];
    storage?: CS_BaseInventoryItem[];
    uid: number;
    updatedat?: number;
    wear?: number;
}

export interface CS_InventoryItem extends Omit<CS_BaseInventoryItem, "storage"> {
    data: CS_Item;
    storage?: Map<number, CS_InventoryItem>;
}

export interface CS_InventoryOptions {
    maxItems: number;
    storageUnitMaxItems: number;
}

export interface CS_InventorySpec extends CS_InventoryOptions {
    items: CS_BaseInventoryItem[] | Map<number, CS_InventoryItem>;
}

export const CS_INVENTORY_TIMESTAMP = 1707696138408;
export const CS_INVENTORY_STICKERS = [CS_NONE, CS_NONE, CS_NONE, CS_NONE] as const;
export const CS_INVENTORY_STICKERS_WEAR = [CS_NONE, CS_NONE, CS_NONE, CS_NONE] as const;
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

export function CS_getTimestamp() {
    return Math.ceil((Date.now() - CS_INVENTORY_TIMESTAMP) / 1000);
}

export function CS_getNextUid(map: Map<number, unknown>): number {
    let uid = 0;
    while (true) {
        if (!map.has(uid)) {
            return uid;
        }
        uid++;
    }
}

export function CS_validateStorage(storage?: CS_BaseInventoryItem[]) {
    if (storage !== undefined) {
        let uids = new Set<number>();
        for (const item of storage) {
            assert(!uids.has(item.uid), "Duplicate storage unit item uid.");
            assert(!CS_isStorageUnitTool(item.id), "Storage unit cannot be stored in storage unit.");
            CS_validateBaseInventoryItem(item);
            uids.add(item.uid);
        }
    }
}

export function CS_validateBaseInventoryItem({
    id,
    nametag,
    seed,
    stattrak,
    stickers,
    stickerswear,
    storage,
    wear
}: Omit<CS_BaseInventoryItem, "uid">) {
    const item = CS_Economy.getById(id);
    CS_validateWear(wear, item);
    CS_validateSeed(seed, item);
    CS_validateStickers(stickers, stickerswear, item);
    CS_validateNametag(nametag, item);
    CS_validateStatTrak(stattrak, item);
    if (storage !== undefined) {
        CS_expectStorageUnitTool(item);
        CS_validateStorage(storage);
    }
}

export function CS_storageToMap(storage?: CS_BaseInventoryItem[]) {
    return storage !== undefined ? new Map(storage.map((item) => [item.uid, item])) : undefined;
}

export function CS_asPartialInventoryItem({
    storage,
    ...base
}: Partial<CS_BaseInventoryItem>): Partial<CS_InventoryItem> {
    const item: Partial<CS_InventoryItem> = { ...base };
    if (base.id) {
        item.data = CS_Economy.getById(base.id);
    }
    if (storage) {
        item.storage = new Map(storage.map((item) => [item.uid, CS_asInventoryItem(item)]));
    }
    return item;
}

export function CS_asInventoryItem(base: CS_BaseInventoryItem) {
    return CS_asPartialInventoryItem(base) as CS_InventoryItem;
}

export function CS_asPartialBaseInventoryItem({
    data,
    storage,
    ...rest
}: Partial<CS_InventoryItem>): Partial<CS_BaseInventoryItem> {
    const base: Partial<CS_BaseInventoryItem> = { ...rest };
    if (storage) {
        base.storage = Array.from(storage.values()).map((item) => CS_asBaseInventoryItem(item));
    }
    return base;
}

export function CS_asBaseInventoryItem(item: CS_InventoryItem) {
    return CS_asPartialBaseInventoryItem(item) as CS_BaseInventoryItem;
}

export function CS_asInventoryItemMap(items: CS_BaseInventoryItem[]) {
    const map = new Map<number, CS_InventoryItem>();
    for (const item of items) {
        assert(!map.has(item.uid), "Duplicate inventory item uid.");
        map.set(item.uid, CS_asInventoryItem(item));
    }
    return map;
}

export class CS_Inventory {
    private items: Map<number, CS_InventoryItem>;
    private options: CS_InventoryOptions;

    constructor({ items, maxItems, storageUnitMaxItems }: Partial<CS_InventorySpec>) {
        this.items =
            items !== undefined ? (items instanceof Map ? items : new Map(CS_asInventoryItemMap(items))) : new Map();
        this.options = {
            maxItems: maxItems ?? 256,
            storageUnitMaxItems: storageUnitMaxItems ?? 32
        };
    }

    isFull() {
        return this.items.size >= this.options.maxItems;
    }

    add(
        item: Omit<CS_BaseInventoryItem, "uid"> & {
            uid?: number;
        }
    ) {
        assert(!this.isFull(), "Inventory is full.");
        CS_validateBaseInventoryItem(item);
        const uid = CS_getNextUid(this.items);
        this.items.set(
            uid,
            CS_asInventoryItem(
                Object.assign(item, {
                    equipped: undefined,
                    equippedCT: undefined,
                    equippedT: undefined,
                    uid,
                    updatedat: CS_getTimestamp()
                })
            )
        );
        return this;
    }

    private addInventoryItem(item: CS_InventoryItem) {
        assert(!this.isFull(), "Inventory is full.");
        CS_validateBaseInventoryItem(CS_asBaseInventoryItem(item));
        const uid = CS_getNextUid(this.items);
        this.items.set(
            uid,
            Object.assign(item, {
                equipped: undefined,
                equippedCT: undefined,
                equippedT: undefined,
                uid,
                updatedat: CS_getTimestamp()
            })
        );
        return this;
    }

    addWithNametag(toolUid: number, id: number, nametag: string) {
        const tool = this.get(toolUid);
        CS_expectNametagTool(tool.data);
        CS_requireNametag(nametag);
        this.items.delete(toolUid);
        this.add({ id, nametag });
        return this;
    }

    addWithSticker(stickerUid: number, id: number, stickerIndex: number) {
        const sticker = this.get(stickerUid);
        CS_expectSticker(sticker.data);
        this.items.delete(stickerUid);
        this.add({
            id,
            stickers: CS_INVENTORY_STICKERS.map((_, index) => (index === stickerIndex ? sticker.id : _))
        });
        return this;
    }

    edit(itemUid: number, attributes: Partial<CS_BaseInventoryItem>) {
        const item = this.get(itemUid);
        assert(!attributes.uid || item.uid === attributes.uid, "Item uid cannot be modified.");
        assert(!attributes.id || item.id === attributes.id, "Item id cannot be modified.");
        CS_validateBaseInventoryItem({ ...attributes, id: item.id });
        Object.assign(item, CS_asPartialInventoryItem(attributes), {
            updatedat: CS_getTimestamp()
        });
        return this;
    }

    equip(itemUid: number, team?: CS_Team) {
        const item = this.get(itemUid);
        assert(item.equipped === undefined, "Item is already equipped.");
        assert(team !== CS_TEAM_CT || item.equippedCT === undefined, "Item is already equipped to CT.");
        assert(team !== CS_TEAM_T || item.equippedT === undefined, "Item is already equipped to T.");
        assert(CS_INVENTORY_EQUIPPABLE_ITEMS.includes(item.data.type), "Item is not equippable.");
        assert(team === undefined || item.data.teams?.includes(team), "Item cannot be equipped to this team.");
        assert(team !== undefined || item.data.teams === undefined, "Item cannot be equipped to any team.");
        for (const [otherUid, otherItem] of this.items) {
            if (itemUid === otherUid) {
                otherItem.equipped = team === undefined ? true : undefined;
                otherItem.equippedCT = team === CS_TEAM_CT ? true : otherItem.equippedCT;
                otherItem.equippedT = team === CS_TEAM_T ? true : otherItem.equippedT;
            } else {
                if (
                    otherItem.data.type === item.data.type &&
                    (item.data.type !== "weapon" || otherItem.data.model === item.data.model)
                ) {
                    otherItem.equipped = team === undefined ? undefined : otherItem.equipped;
                    otherItem.equippedCT = team === CS_TEAM_CT ? undefined : otherItem.equippedCT;
                    otherItem.equippedT = team === CS_TEAM_T ? undefined : otherItem.equippedT;
                }
            }
        }
        return this;
    }

    unequip(uid: number, team?: CS_Team) {
        const item = this.get(uid);
        item.equipped = team === undefined ? undefined : item.equipped;
        item.equippedCT = team === CS_TEAM_CT ? undefined : item.equippedCT;
        item.equippedT = team === CS_TEAM_T ? undefined : item.equippedT;
        return this;
    }

    unlockCase(unlockedItem: ReturnType<typeof CS_unlockCase>, caseUid: number, keyUid?: number) {
        const caseItem = this.get(caseUid);
        CS_validateUnlockedItem(caseItem.data, unlockedItem);
        const keyItem = keyUid !== undefined ? this.get(keyUid) : undefined;
        CS_validateCaseKey(caseItem.data, keyItem?.data);
        this.items.delete(caseUid);
        if (keyUid !== undefined) {
            this.items.delete(keyUid);
        }
        this.add({
            id: unlockedItem.id,
            ...unlockedItem.attributes,
            updatedat: CS_getTimestamp()
        });
        return this;
    }

    renameItem(toolUid: number, renameableUid: number, nametag?: string) {
        nametag = CS_trimNametag(nametag);
        const tool = this.get(toolUid);
        CS_expectNametagTool(tool.data);
        const renameable = this.get(renameableUid);
        CS_validateNametag(nametag, renameable.data);
        renameable.nametag = nametag;
        renameable.updatedat = CS_getTimestamp();
        this.items.delete(toolUid);
        return this;
    }

    renameStorageUnit(storageUid: number, nametag: string) {
        const trimmed = CS_trimNametag(nametag);
        const storageUnit = this.get(storageUid);
        CS_expectStorageUnitTool(storageUnit.data);
        CS_requireNametag(trimmed);
        storageUnit.nametag = trimmed;
        storageUnit.updatedat = CS_getTimestamp();
        return this;
    }

    isStorageUnitFull(storageUid: number) {
        return this.get(storageUid).storage?.size === this.options.storageUnitMaxItems;
    }

    isStorageUnitFilled(storageUid: number) {
        return this.get(storageUid).storage?.size ?? 0 > 0;
    }

    canDepositToStorageUnit(storageUid: number) {
        return this.get(storageUid).nametag !== undefined && !this.isStorageUnitFull(storageUid);
    }

    getStorageUnitItems(storageUid: number) {
        return Array.from(this.get(storageUid).storage?.values() ?? []);
    }

    depositToStorageUnit(storageUid: number, depositUids: number[]) {
        const item = this.get(storageUid);
        CS_expectStorageUnitTool(item.data);
        assert(depositUids.length > 0, "No items to deposit.");
        assert(this.canDepositToStorageUnit(storageUid), "Cannot deposit to storage unit.");
        for (const uid of depositUids) {
            const item = CS_Economy.getById(this.get(uid).id);
            assert(!CS_isStorageUnitTool(item), "Cannot deposit storage unit.");
        }
        const storage = item.storage ?? new Map<number, CS_InventoryItem>();
        for (const sourceUid of depositUids) {
            const uid = CS_getNextUid(storage);
            storage.set(
                uid,
                Object.assign(this.get(sourceUid), {
                    equipped: undefined,
                    equippedCT: undefined,
                    equippedT: undefined,
                    uid
                })
            );
            this.items.delete(sourceUid);
        }
        item.storage = storage;
        item.updatedat = CS_getTimestamp();
        return this;
    }

    retrieveFromStorageUnit(storageUid: number, retrieveUids: number[]) {
        const item = this.get(storageUid);
        CS_expectStorageUnitTool(item.data);
        const storage = item.storage;
        assert(storage, "Storage unit is empty.");
        assert(retrieveUids.length > 0, "No items to retrieve.");
        assert(this.isStorageUnitFilled(storageUid), "Storage unit is empty.");
        for (const uid of retrieveUids) {
            const item = storage.get(uid);
            assert(item, "Item not found.");
            this.addInventoryItem(item);
            storage.delete(uid);
        }
        item.storage = storage.size > 0 ? storage : undefined;
        item.updatedat = CS_getTimestamp();
        return this;
    }

    applyItemSticker(targetUid: number, stickerUid: number, stickerIndex: number) {
        const target = this.get(targetUid);
        const sticker = this.get(stickerUid);
        assert(CS_hasStickers(target.data), "Target item does not have stickers.");
        CS_expectSticker(sticker.data);
        const stickers = target.stickers ?? [...CS_INVENTORY_STICKERS];
        assert(stickers[stickerIndex] === CS_NONE, "Sticker already applied.");
        stickers[stickerIndex] = sticker.id;
        target.stickers = stickers;
        target.updatedat = CS_getTimestamp();
        this.items.delete(stickerUid);
        return this;
    }

    scrapeItemSticker(targetUid: number, stickerIndex: number) {
        const target = this.get(targetUid);
        assert(target.stickers !== undefined, "Target item does not have stickers.");
        const { stickers } = target;
        assert(typeof stickers[stickerIndex] === "number", "Invalid sticker index.");
        const wears = target.stickerswear ?? [...CS_INVENTORY_STICKERS_WEAR];
        const wear = wears[stickerIndex] ?? CS_NONE;
        const nextWear = float(wear + CS_STICKER_WEAR_FACTOR);
        if (nextWear > CS_MAX_WEAR) {
            stickers[stickerIndex] = CS_NONE;
            wears[stickerIndex] = CS_NONE;
            target.stickers = stickers.filter((id) => id !== CS_NONE).length > 0 ? stickers : undefined;
            target.stickerswear = wears.filter((wear) => wear !== CS_NONE).length > 0 ? wears : undefined;
            return this;
        }
        wears[stickerIndex] = nextWear;
        target.stickerswear = wears;
        target.updatedat = CS_getTimestamp();
        return this;
    }

    incrementItemStatTrak(targetUid: number) {
        const target = this.get(targetUid);
        assert(target.stattrak !== undefined, "Target item does not have stattrak.");
        if (target.stattrak < CS_MAX_STATTRAK) {
            target.stattrak++;
            target.updatedat = CS_getTimestamp();
        }
        return this;
    }

    swapItemsStatTrak(toolUid: number, fromUid: number, toUid: number) {
        assert(fromUid !== toUid, "Uids must be different.");
        const tool = this.get(toolUid);
        expectStatTrakSwapTool(tool.data);
        const fromItem = this.get(fromUid);
        const toItem = this.get(toUid);
        assert(fromItem.stattrak !== undefined && toItem.stattrak !== undefined, "Invalid inventory items.");
        assert(fromItem.data.type === toItem.data.type, "Items must be of the same type.");
        assert(
            fromItem.data.type === "musickit" || fromItem.data.def === toItem.data.def,
            "Items must be of the same type."
        );
        const fromStattrak = fromItem.stattrak;
        fromItem.stattrak = toItem.stattrak;
        fromItem.updatedat = CS_getTimestamp();
        toItem.stattrak = fromStattrak;
        toItem.updatedat = CS_getTimestamp();
        this.items.delete(toolUid);
        return this;
    }

    remove(uid: number) {
        this.items.delete(uid);
        return this;
    }

    removeAll() {
        this.items.clear();
        return this;
    }

    get(uid: number) {
        const item = this.items.get(uid);
        assert(item !== undefined, "Item not found.");
        return item;
    }

    size() {
        return this.items.size;
    }

    move() {
        return new CS_Inventory({
            ...this.options,
            items: this.items
        });
    }

    export() {
        return Array.from(this.items.values()).map(CS_asBaseInventoryItem);
    }
}
