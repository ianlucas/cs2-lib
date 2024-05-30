/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    CS2_MAX_PATCHES,
    CS2_MAX_STATTRAK,
    CS2_MAX_STICKERS,
    CS2_MAX_STICKER_WEAR,
    CS2_MAX_WEAR,
    CS2_MIN_STICKER_WEAR,
    CS2_NONE,
    CS2_STICKER_WEAR_FACTOR
} from "./economy-constants.js";
import { CS2ItemType, CS2ItemTypeValues } from "./economy-types.js";
import { CS2Economy, CS2EconomyInstance, CS2EconomyItem } from "./economy.js";
import { CS2Team, CS2TeamValues } from "./teams.js";
import { assert, ensure, float } from "./utils.js";

export interface CS2BaseInventoryItem {
    containerId?: number;
    equipped?: boolean;
    equippedCT?: boolean;
    equippedT?: boolean;
    id: number;
    nameTag?: string;
    patches?: Record<number, number | undefined>;
    seed?: number;
    statTrak?: number;
    stickers?: Record<
        number,
        {
            id: number;
            wear?: number;
            x?: number;
            y?: number;
        }
    >;
    storage?: Record<number, CS2BaseInventoryItem>;
    updatedAt?: number;
    wear?: number;
}

export interface CS2InventoryItem extends Omit<CS2BaseInventoryItem, "storage"> {
    props: CS2EconomyItem;
    storage?: Map<number, CS2InventoryItem>;
    uid: number;
}

export interface CS2InventoryData {
    items: Record<number, CS2BaseInventoryItem>;
    version: number;
}

export interface CS2InventoryOptions {
    maxItems: number;
    storageUnitMaxItems: number;
}

export interface CS2InventorySpec extends CS2InventoryOptions {
    economy: CS2EconomyInstance;
    data: CS2InventoryData;
}

export const CS2_INVENTORY_VERSION = 1;
export const CS2_INVENTORY_TIMESTAMP = 1707696138408;
// prettier-ignore
export const CS_INVENTORY_EQUIPPABLE_ITEMS: CS2ItemTypeValues[] = [CS2ItemType.Agent, CS2ItemType.Collectible, CS2ItemType.Gloves, CS2ItemType.Graffiti, CS2ItemType.Melee, CS2ItemType.MusicKit, CS2ItemType.Patch, CS2ItemType.Weapon];

export function getTimestamp(): number {
    return Math.ceil((Date.now() - CS2_INVENTORY_TIMESTAMP) / 1000);
}

export function getNextUid(map: Map<number, unknown>): number {
    let uid = 0;
    while (true) {
        if (!map.has(uid)) {
            return uid;
        }
        uid++;
    }
}

export class CS2Inventory {
    private economy: CS2EconomyInstance;
    private items: Map<number, CS2InventoryItem>;
    readonly options: Readonly<CS2InventoryOptions>;

    constructor({ economy, data, maxItems, storageUnitMaxItems }: Partial<CS2InventorySpec>) {
        this.economy = economy ?? CS2Economy;
        this.items = data !== undefined ? this.toInventoryItems(data.items) : new Map();
        this.options = {
            maxItems: maxItems ?? 256,
            storageUnitMaxItems: storageUnitMaxItems ?? 32
        };
    }

    private validateEquippable(item: CS2EconomyItem): void {
        if (item.isGloves()) {
            assert(!item.base);
        }
    }

    private validateStickers(stickers?: CS2BaseInventoryItem["stickers"], item?: CS2EconomyItem): void {
        if (stickers === undefined) {
            return;
        }
        const entries = Object.entries(stickers);
        assert(entries.length <= CS2_MAX_STICKERS);
        assert(item === undefined || item.hasStickers());
        for (const [slot, { id: stickerId, wear }] of entries) {
            const slotNumber = parseInt(slot, 10);
            assert(slotNumber >= 0 && slotNumber <= CS2_MAX_STICKERS - 1);
            this.economy.getById(stickerId).expectSticker();
            if (wear !== undefined) {
                assert(!Number.isNaN(wear));
                assert(String(wear).length <= String(CS2_STICKER_WEAR_FACTOR).length);
                assert(wear >= CS2_MIN_STICKER_WEAR && wear <= CS2_MAX_STICKER_WEAR);
            }
        }
    }

    private validatePatches(patches?: CS2BaseInventoryItem["patches"], item?: CS2EconomyItem): void {
        if (patches === undefined) {
            return;
        }
        assert(item === undefined || item.isAgent());
        for (const [slot, patchId] of Object.entries(patches)) {
            const slotNumber = parseInt(slot, 10);
            assert(slotNumber >= 0 && slotNumber <= CS2_MAX_PATCHES - 1);
            assert(patchId === undefined || this.economy.getById(patchId).isPatch());
        }
    }

    private validateBaseInventoryItem({
        id,
        nameTag,
        patches,
        seed,
        statTrak,
        stickers,
        wear
    }: CS2BaseInventoryItem): void {
        const item = this.economy.getById(id);
        this.economy.validateWear(wear, item);
        this.economy.validateSeed(seed, item);
        this.economy.validateNametag(nameTag, item);
        this.economy.validateStatTrak(statTrak, item);
        this.validateEquippable(item);
        this.validatePatches(patches, item);
        this.validateStickers(stickers, item);
    }

    private toInventoryItem(
        uid: number,
        { storage, ...base }: CS2BaseInventoryItem,
        isStorageUnitItem = false
    ): CS2InventoryItem {
        assert(storage === undefined || this.economy.getById(base.id).isStorageUnit());
        assert(!isStorageUnitItem || storage === undefined);
        this.validateBaseInventoryItem(base);
        const item: CS2InventoryItem = {
            ...base,
            props: this.economy.getById(base.id),
            uid
        };
        if (storage !== undefined) {
            item.storage = this.toInventoryItems(storage, true);
        }
        return item;
    }

    private toInventoryItems(
        items: Record<number, CS2BaseInventoryItem>,
        isStorageUnitItem = false
    ): Map<number, CS2InventoryItem> {
        return new Map(
            Object.entries(items).map(([key, value]) => {
                const uid = parseInt(key, 10);
                return [uid, this.toInventoryItem(uid, value, isStorageUnitItem)] as const;
            })
        );
    }

    private toBaseInventoryItem({ props: econ, storage, ...value }: CS2InventoryItem): CS2BaseInventoryItem {
        return {
            ...value,
            storage: storage !== undefined ? this.toBaseInventoryItems(storage) : undefined
        };
    }

    private toBaseInventoryItems(items: Map<number, CS2InventoryItem>): Record<number, CS2BaseInventoryItem> {
        return Object.fromEntries(Array.from(items).map(([key, value]) => [key, this.toBaseInventoryItem(value)]));
    }

    stringify(): string {
        return JSON.stringify({
            items: this.toBaseInventoryItems(this.items),
            version: CS2_INVENTORY_VERSION
        });
    }

    isFull(): boolean {
        return this.items.size >= this.options.maxItems;
    }

    add(item: CS2BaseInventoryItem): this {
        assert(!this.isFull());
        const uid = getNextUid(this.items);
        this.items.set(
            uid,
            this.toInventoryItem(
                uid,
                Object.assign(item, {
                    equipped: undefined,
                    equippedCT: undefined,
                    equippedT: undefined,
                    updatedAt: getTimestamp()
                })
            )
        );
        return this;
    }

    private addInventoryItem(item: CS2InventoryItem): this {
        assert(!this.isFull());
        const uid = getNextUid(this.items);
        this.items.set(uid, {
            ...item,
            equipped: undefined,
            equippedCT: undefined,
            equippedT: undefined,
            updatedAt: getTimestamp()
        });
        return this;
    }

    addWithNametag(nameTagUid: number, id: number, nameTag: string): this {
        this.get(nameTagUid).props.expectNameTag();
        this.economy.requireNametag(nameTag);
        this.items.delete(nameTagUid);
        this.add({ id, nameTag });
        return this;
    }

    addWithSticker(stickerUid: number, id: number, stickerIndex: number): this {
        const sticker = this.get(stickerUid).props.expectSticker();
        this.items.delete(stickerUid);
        this.add({
            id,
            stickers: { [stickerIndex]: { id: sticker.id } }
        });
        return this;
    }

    edit(itemUid: number, attributes: Partial<CS2BaseInventoryItem>): this {
        const item = this.get(itemUid);
        assert(attributes.id === undefined || attributes.id === item.id);
        attributes.id = item.id;
        Object.assign(item, this.toInventoryItem(itemUid, attributes as CS2BaseInventoryItem), {
            updatedAt: getTimestamp()
        });
        return this;
    }

    equip(itemUid: number, team?: CS2TeamValues): this {
        const item = this.get(itemUid);
        assert(item.equipped === undefined);
        assert(team !== CS2Team.CT || item.equippedCT === undefined);
        assert(team !== CS2Team.T || item.equippedT === undefined);
        assert(CS_INVENTORY_EQUIPPABLE_ITEMS.includes(item.props.type));
        assert(team === undefined || item.props.teams?.includes(team));
        assert(team !== undefined || item.props.teams === undefined);
        for (const [otherUid, otherItem] of this.items) {
            if (itemUid === otherUid) {
                otherItem.equipped = team === undefined ? true : undefined;
                otherItem.equippedCT = team === CS2Team.CT ? true : otherItem.equippedCT;
                otherItem.equippedT = team === CS2Team.T ? true : otherItem.equippedT;
            } else {
                if (
                    otherItem.props.type === item.props.type &&
                    (item.props.type !== CS2ItemType.Weapon || otherItem.props.model === item.props.model)
                ) {
                    otherItem.equipped = team === undefined ? undefined : otherItem.equipped;
                    otherItem.equippedCT = team === CS2Team.CT ? undefined : otherItem.equippedCT;
                    otherItem.equippedT = team === CS2Team.T ? undefined : otherItem.equippedT;
                }
            }
        }
        return this;
    }

    unequip(uid: number, team?: CS2TeamValues): this {
        const item = this.get(uid);
        item.equipped = team === undefined ? undefined : item.equipped;
        item.equippedCT = team === CS2Team.CT ? undefined : item.equippedCT;
        item.equippedT = team === CS2Team.T ? undefined : item.equippedT;
        return this;
    }

    unlockContainer(
        unlockedItem: ReturnType<InstanceType<typeof CS2EconomyItem>["unlock"]>,
        containerUid: number,
        keyUid?: number
    ): this {
        const containerItem = this.get(containerUid);
        this.economy.validateUnlockedItem(containerItem.props, unlockedItem);
        const keyItem = keyUid !== undefined ? this.get(keyUid) : undefined;
        this.economy.validateContainerAndKey(containerItem.props, keyItem?.props);
        this.items.delete(containerUid);
        if (keyUid !== undefined) {
            this.items.delete(keyUid);
        }
        this.add({
            ...unlockedItem.attributes,
            id: unlockedItem.id,
            updatedAt: getTimestamp()
        });
        return this;
    }

    renameItem(nameTagUid: number, renameableUid: number, nameTag?: string): this {
        nameTag = this.economy.trimNametag(nameTag);
        this.get(nameTagUid).props.expectNameTag();
        const renameable = this.get(renameableUid);
        this.economy.validateNametag(nameTag, renameable.props);
        renameable.nameTag = nameTag;
        renameable.updatedAt = getTimestamp();
        this.items.delete(nameTagUid);
        return this;
    }

    renameStorageUnit(storageUid: number, nameTag: string): this {
        const trimmed = this.economy.trimNametag(nameTag);
        const storageUnit = this.get(storageUid);
        storageUnit.props.expectStorageUnit();
        this.economy.requireNametag(trimmed);
        storageUnit.nameTag = trimmed;
        storageUnit.updatedAt = getTimestamp();
        return this;
    }

    isStorageUnitFull(storageUid: number): boolean {
        return this.get(storageUid).storage?.size === this.options.storageUnitMaxItems;
    }

    getStorageUnitSize(storageUid: number): number {
        return this.get(storageUid).storage?.size ?? 0;
    }

    isStorageUnitFilled(storageUid: number): boolean {
        return this.getStorageUnitSize(storageUid) > 0;
    }

    canDepositToStorageUnit(storageUid: number, size = 1): boolean {
        return (
            this.get(storageUid).nameTag !== undefined &&
            this.getStorageUnitSize(storageUid) + size <= this.options.storageUnitMaxItems
        );
    }

    canRetrieveFromStorageUnit(storageUid: number, size = 1): boolean {
        return this.getStorageUnitSize(storageUid) - size >= 0 && this.size() + size <= this.options.maxItems;
    }

    getStorageUnitItems(storageUid: number): CS2InventoryItem[] {
        return Array.from(this.get(storageUid).storage?.values() ?? []);
    }

    depositToStorageUnit(storageUid: number, depositUids: number[]): this {
        const item = this.get(storageUid);
        item.props.expectStorageUnit();
        assert(depositUids.length > 0);
        assert(this.canDepositToStorageUnit(storageUid, depositUids.length));
        for (const sourceUid of depositUids) {
            assert(!this.get(sourceUid).props.isStorageUnit());
        }
        const storage = item.storage ?? new Map<number, CS2InventoryItem>();
        for (const sourceUid of depositUids) {
            const uid = getNextUid(storage);
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
        item.updatedAt = getTimestamp();
        return this;
    }

    retrieveFromStorageUnit(storageUid: number, retrieveUids: number[]): this {
        const item = this.get(storageUid);
        item.props.expectStorageUnit();
        const storage = item.storage;
        assert(storage !== undefined);
        assert(retrieveUids.length > 0);
        assert(this.canRetrieveFromStorageUnit(storageUid, retrieveUids.length));
        for (const uid of retrieveUids) {
            assert(storage.has(uid));
        }
        for (const uid of retrieveUids) {
            const item = ensure(storage.get(uid));
            this.addInventoryItem(item);
            storage.delete(uid);
        }
        item.storage = storage.size > 0 ? storage : undefined;
        item.updatedAt = getTimestamp();
        return this;
    }

    applyItemSticker(targetUid: number, stickerUid: number, stickerIndex: number): this {
        assert(stickerIndex >= 0 && stickerIndex <= CS2_MAX_STICKERS - 1);
        const target = this.get(targetUid);
        const sticker = this.get(stickerUid);
        assert(target.props.hasStickers());
        sticker.props.expectSticker();
        const stickers = target.stickers ?? {};
        assert(stickers[stickerIndex] === undefined);
        stickers[stickerIndex] = { id: sticker.id };
        target.stickers = stickers;
        target.updatedAt = getTimestamp();
        this.items.delete(stickerUid);
        return this;
    }

    scrapeItemSticker(targetUid: number, stickerIndex: number): this {
        const target = this.get(targetUid);
        assert(target.stickers !== undefined);
        const sticker = ensure(target.stickers[stickerIndex]);
        const wear = sticker.wear ?? CS2_NONE;
        const nextWear = float(wear + CS2_STICKER_WEAR_FACTOR);
        if (nextWear > CS2_MAX_WEAR) {
            delete target.stickers[stickerIndex];
            if (Object.keys(target.stickers).length === 0) {
                target.stickers = undefined;
            }
            return this;
        }
        sticker.wear = nextWear;
        target.updatedAt = getTimestamp();
        return this;
    }

    applyItemPatch(targetUid: number, patchUid: number, patchIndex: number): this {
        assert(patchIndex >= 0 && patchIndex <= CS2_MAX_PATCHES - 1);
        const target = this.get(targetUid);
        const patch = this.get(patchUid);
        target.props.expectAgent();
        patch.props.expectPatch();
        const patches = target.patches ?? {};
        assert(patches[patchIndex] === undefined);
        patches[patchIndex] = patch.id;
        target.patches = patches;
        target.updatedAt = getTimestamp();
        this.items.delete(patchUid);
        return this;
    }

    removeItemPatch(targetUid: number, patchIndex: number): this {
        const target = this.get(targetUid);
        assert(target.patches !== undefined);
        assert(target.patches[patchIndex] !== undefined);
        delete target.patches[patchIndex];
        if (Object.keys(target.patches).length === 0) {
            target.patches = undefined;
        }
        target.updatedAt = getTimestamp();
        return this;
    }

    incrementItemStatTrak(targetUid: number): this {
        const target = this.get(targetUid);
        assert(target.statTrak !== undefined);
        if (target.statTrak < CS2_MAX_STATTRAK) {
            target.statTrak++;
            target.updatedAt = getTimestamp();
        }
        return this;
    }

    swapItemsStatTrak(statTrakSwapToolUid: number, fromUid: number, toUid: number): this {
        assert(fromUid !== toUid);
        this.get(statTrakSwapToolUid).props.expectStatTrakSwapTool();
        const fromItem = this.get(fromUid);
        const toItem = this.get(toUid);
        assert(fromItem.statTrak !== undefined && toItem.statTrak !== undefined);
        assert(fromItem.props.type === toItem.props.type);
        assert(fromItem.props.type === CS2ItemType.MusicKit || fromItem.props.def === toItem.props.def);
        const fromStattrak = fromItem.statTrak;
        fromItem.statTrak = toItem.statTrak;
        fromItem.updatedAt = getTimestamp();
        toItem.statTrak = fromStattrak;
        toItem.updatedAt = getTimestamp();
        this.items.delete(statTrakSwapToolUid);
        return this;
    }

    remove(uid: number): this {
        this.items.delete(uid);
        return this;
    }

    removeAll(): this {
        this.items.clear();
        return this;
    }

    get(uid: number): CS2InventoryItem {
        return ensure(this.items.get(uid));
    }

    getAll(): CS2InventoryItem[] {
        return Array.from(this.items.values());
    }

    setAll(items: Map<number, CS2InventoryItem>): this {
        this.items = items;
        return this;
    }

    size(): number {
        return this.items.size;
    }

    move(): CS2Inventory {
        return new CS2Inventory({
            ...this.options,
            economy: this.economy
        }).setAll(this.items);
    }
}
