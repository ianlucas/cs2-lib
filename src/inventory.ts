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

export function CS_getTimestamp() {
    return Math.ceil((Date.now() - CS_INVENTORY_TIMESTAMP) / 1000);
}

export class CS_InventoryUids {
    private items: Map<number, CS_InventoryItem>;

    constructor(items: Map<number, CS_InventoryItem> | CS_InventoryItem[]) {
        this.items = items instanceof Map ? items : new Map(items.map((item) => [item.uid, item]));
    }

    add(item: Omit<CS_InventoryItem, "uid">) {
        let uid = 0;
        while (true) {
            if (!this.items.has(uid)) {
                const newItem = { ...item, uid };
                this.items.set(uid, newItem);
                return newItem;
            }
            uid++;
        }
    }
}

export function CS_validateInventoryItem({
    id,
    nametag,
    seed,
    stattrak,
    stickers,
    stickerswear,
    wear
}: Omit<CS_InventoryItem, "uid">) {
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
    uid: number;
    updatedat?: number;
    wear?: number;
}

export interface CS_InventoryOptions {
    items?: CS_InventoryItem[];
    limit?: number;
    storageUnitLimit?: number;
}

export class CS_Inventory {
    private items = new Map<number, CS_InventoryItem>();
    private limit: number;
    private storageUnitLimit: number;
    private uids: CS_InventoryUids;

    constructor({ items, limit, storageUnitLimit }: CS_InventoryOptions) {
        this.items = new Map((items ?? []).map((item) => [item.uid, item]));
        this.limit = limit ?? 256;
        this.storageUnitLimit = storageUnitLimit ?? 32;
        this.uids = new CS_InventoryUids(this.items);
    }

    full(): boolean {
        return this.items.size === this.limit;
    }

    add(
        inventoryItem: Omit<CS_InventoryItem, "uid"> & {
            uid?: number;
        }
    ) {
        if (this.full()) {
            return this;
        }
        CS_validateInventoryItem(inventoryItem);
        this.uids.add({
            ...inventoryItem,
            equipped: undefined,
            equippedCT: undefined,
            equippedT: undefined,
            updatedat: CS_getTimestamp()
        });
        return this;
    }

    addWithNametag(toolUid: number, itemId: number, nametag: string) {
        if (nametag === "") {
            throw new Error("invalid nametag");
        }
        const toolItem = CS_Economy.getById(this.get(toolUid).id);
        if (toolItem.type !== "tool" || toolItem.def !== CS_NAMETAG_TOOL_DEF) {
            throw new Error("tool must be name tag");
        }
        const targetItem = CS_Economy.getById(itemId);
        if (!CS_hasNametag(targetItem)) {
            throw new Error("item does not have nametag");
        }
        this.items.delete(toolUid);
        this.add({
            id: itemId,
            nametag
        });
        return this;
    }

    edit(itemUid: number, attributes: Partial<CS_InventoryItem>) {
        const inventoryItem = this.get(itemUid);
        if (attributes.id !== undefined && inventoryItem.id !== attributes.id) {
            throw new Error("item id cannot be modified");
        }
        const changes = {
            ...inventoryItem,
            ...attributes
        };
        CS_validateInventoryItem(changes);
        this.items.set(itemUid, {
            ...changes,
            updatedat: CS_getTimestamp()
        });
        return this;
    }

    equip(itemUid: number, team?: CS_Team) {
        const inventoryItem = this.get(itemUid);
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
        for (const [otherUid, otherInventoryItem] of this.items) {
            if (itemUid === otherUid) {
                otherInventoryItem.equipped = team === undefined ? true : undefined;
                otherInventoryItem.equippedCT = team === CS_TEAM_CT ? true : otherInventoryItem.equippedCT;
                otherInventoryItem.equippedT = team === CS_TEAM_T ? true : otherInventoryItem.equippedT;
            } else {
                const currentItem = CS_Economy.getById(otherInventoryItem.id);
                if (currentItem.type === item.type && (item.type !== "weapon" || currentItem.model === item.model)) {
                    otherInventoryItem.equipped = team === undefined ? undefined : otherInventoryItem.equipped;
                    otherInventoryItem.equippedCT = team === CS_TEAM_CT ? undefined : otherInventoryItem.equippedCT;
                    otherInventoryItem.equippedT = team === CS_TEAM_T ? undefined : otherInventoryItem.equippedT;
                }
            }
        }
        return this;
    }

    unequip(uid: number, team?: CS_Team) {
        const inventoryItem = this.get(uid);
        inventoryItem.equipped = team === undefined ? undefined : inventoryItem.equipped;
        inventoryItem.equippedCT = team === CS_TEAM_CT ? undefined : inventoryItem.equippedCT;
        inventoryItem.equippedT = team === CS_TEAM_T ? undefined : inventoryItem.equippedT;
        return this;
    }

    unlockCase(unlockedItem: ReturnType<typeof CS_unlockCase>, caseUid: number, keyUid?: number) {
        const caseItem = CS_Economy.getById(this.get(caseUid).id);
        CS_validateUnlockedItem(caseItem, unlockedItem);
        const keyItem = keyUid !== undefined ? CS_Economy.getById(this.get(keyUid).id) : undefined;
        if (keyItem !== undefined && keyItem.type !== "key") {
            throw new Error("item is not a key");
        }
        if (caseItem.keys !== undefined && (keyItem === undefined || !caseItem.keys.includes(keyItem.id))) {
            throw new Error("case needs a valid key to be open");
        }
        if (caseItem.keys === undefined && keyItem !== undefined) {
            throw new Error("case does not need a key");
        }
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

    renameItem(toolUid: number, targetUid: number, nametag?: string) {
        nametag = nametag === "" ? undefined : nametag;
        const toolItem = CS_Economy.getById(this.get(toolUid).id);
        if (toolItem.type !== "tool" || toolItem.def !== CS_NAMETAG_TOOL_DEF) {
            throw new Error("tool must be name tag");
        }
        const targetInventoryItem = this.get(targetUid);
        const targetItem = CS_Economy.getById(targetInventoryItem.id);
        if (!CS_hasNametag(targetItem)) {
            throw new Error("item does not have nametag");
        }
        if (nametag !== undefined) {
            CS_validateNametag(nametag);
        }
        targetInventoryItem.nametag = nametag;
        targetInventoryItem.updatedat = CS_getTimestamp();
        this.items.delete(toolUid);
        return this;
    }

    renameStorageUnit(storageUid: number, nametag: string) {
        if (nametag.trim() === "") {
            throw new Error("invalid nametag");
        }
        const storageInventoryItem = this.get(storageUid);
        const storageItem = CS_Economy.getById(storageInventoryItem.id);
        if (storageItem.def !== CS_STORAGE_UNIT_TOOL_DEF) {
            throw new Error("item is not a storage unit");
        }
        CS_validateNametag(nametag);
        storageInventoryItem.nametag = nametag;
        storageInventoryItem.updatedat = CS_getTimestamp();
        return this;
    }

    isStorageUnitFull(storageUid: number) {
        return this.get(storageUid).storage?.length === this.storageUnitLimit;
    }

    hasItemsInStorageUnit(storageUid: number) {
        return (this.get(storageUid).storage?.length ?? 0) > 0;
    }

    canDepositToStorageUnit(storageUid: number) {
        return this.get(storageUid).nametag !== undefined && !this.isStorageUnitFull(storageUid);
    }

    getStorageUnitItems(storageUid: number) {
        return this.get(storageUid).storage ?? [];
    }

    depositToStorageUnit(storageUid: number, depositUids: number[]) {
        const storageInventoryItem = this.get(storageUid);
        const item = CS_Economy.getById(storageInventoryItem.id);
        if (item.def !== CS_STORAGE_UNIT_TOOL_DEF) {
            throw new Error("item is not a storage unit");
        }
        if (depositUids.length === 0) {
            throw new Error("no items to deposit");
        }
        if (!this.canDepositToStorageUnit(storageUid)) {
            throw new Error("cannot deposit to storage unit");
        }
        for (const uid of depositUids) {
            const item = CS_Economy.getById(this.get(uid).id);
            if (item.def === CS_STORAGE_UNIT_TOOL_DEF) {
                throw new Error("cannot deposit storage unit");
            }
        }
        const storage = storageInventoryItem.storage ?? [];
        const uids = new CS_InventoryUids(storage);
        storageInventoryItem.storage = storage.concat(
            depositUids.map((index) => {
                return uids.add({
                    ...this.get(index),
                    equipped: undefined,
                    equippedCT: undefined,
                    equippedT: undefined
                });
            })
        );
        storageInventoryItem.updatedat = CS_getTimestamp();
        for (const uid of depositUids) {
            this.items.delete(uid);
        }
        return this;
    }

    retrieveFromStorageUnit(storageUid: number, retrieveUids: number[]) {
        const storageInventoryItem = this.get(storageUid);
        const storageItem = CS_Economy.getById(storageInventoryItem.id);

        if (storageItem.def !== CS_STORAGE_UNIT_TOOL_DEF) {
            throw new Error("item is not a storage unit");
        }
        const stored = storageInventoryItem.storage;
        if (stored === undefined || retrieveUids.length === 0) {
            throw new Error("no items to retrieve");
        }
        if (!this.hasItemsInStorageUnit(storageUid)) {
            throw new Error("storage unit is empty");
        }
        for (const inventoryItem of stored) {
            if (retrieveUids.includes(inventoryItem.uid)) {
                inventoryItem.updatedat = CS_getTimestamp();
                this.add(inventoryItem);
            }
        }
        const storage = stored.filter(({ uid }) => !retrieveUids.includes(uid));
        storageInventoryItem.storage = storage.length > 0 ? storage : undefined;
        return this;
    }

    applyItemSticker(targetUid: number, stickerUid: number, stickerIndex: number) {
        const targetInventoryItem = this.get(targetUid);
        const item = CS_Economy.getById(targetInventoryItem.id);
        if (!CS_hasStickers(item)) {
            throw new Error("item does not have stickers");
        }
        const sticker = CS_Economy.getById(this.get(stickerUid).id);
        if (sticker.type !== "sticker") {
            throw new Error("not applying a sticker");
        }
        const stickers = targetInventoryItem.stickers ?? [CS_NO_STICKER, CS_NO_STICKER, CS_NO_STICKER, CS_NO_STICKER];
        if (stickers[stickerIndex] !== CS_NO_STICKER) {
            throw new Error("cant apply existing sticker");
        }
        stickers[stickerIndex] = sticker.id;
        targetInventoryItem.stickers = stickers;
        targetInventoryItem.updatedat = CS_getTimestamp();
        this.items.delete(stickerUid);
        return this;
    }

    scrapeItemSticker(targetUid: number, stickerIndex: number) {
        const inventoryItem = this.get(targetUid);
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
        inventoryItem.updatedat = CS_getTimestamp();
        return this;
    }

    incrementItemStatTrak(targetUid: number) {
        const inventoryItem = this.get(targetUid);
        if (!inventoryItem || inventoryItem.stattrak === undefined) {
            throw new Error("invalid inventory item");
        }
        if (inventoryItem.stattrak < CS_MAX_STATTRAK) {
            inventoryItem.stattrak++;
            inventoryItem.updatedat = CS_getTimestamp();
        }
        return this;
    }

    swapItemsStatTrak(toolUid: number, fromUid: number, toUid: number) {
        if (fromUid === toUid) {
            throw new Error("uids must be different");
        }
        const fromInventoryItem = this.get(fromUid);
        const toInventoryItem = this.get(toUid);
        if (fromInventoryItem.stattrak === undefined || toInventoryItem.stattrak === undefined) {
            throw new Error("invalid inventory items");
        }
        const toolItem = CS_Economy.getById(this.get(toolUid).id);
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
        fromInventoryItem.updatedat = CS_getTimestamp();
        toInventoryItem.stattrak = fromStattrak;
        toInventoryItem.updatedat = CS_getTimestamp();
        this.items.delete(toolUid);
        return this;
    }

    get(uid: number) {
        const inventoryItem = this.items.get(uid);
        if (inventoryItem === undefined) {
            throw new Error("invalid inventory item");
        }
        return inventoryItem;
    }

    getItem(uid: number) {
        return CS_Economy.getById(this.get(uid).id);
    }

    getExtended(uid: number) {
        const inventoryItem = this.get(uid);
        const item = CS_Economy.getById(inventoryItem.id);
        return { ...inventoryItem, item };
    }

    getAll(): CS_InventoryItem[] {
        return Array.from(this.items.values());
    }

    remove(uid: number) {
        this.items.delete(uid);
        return this;
    }

    removeAll() {
        this.items.clear();
    }

    size() {
        return this.items.size;
    }

    copy() {
        return new CS_Inventory({
            items: this.getAll(),
            limit: this.limit
        });
    }
}
