/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    CS2_CHARM_DETACHMENT_PACK_CHARGES,
    CS2_MAX_KEYCHAINS,
    CS2_MAX_PATCHES,
    CS2_MAX_STATTRAK,
    CS2_MAX_STICKERS,
    CS2_MAX_STICKER_WEAR,
    CS2_MIN_CHARGES,
    CS2_MIN_KEYCHAIN_SEED,
    CS2_MIN_STICKER_WEAR,
    CS2_MIN_WEAR,
    CS2_STICKER_SCRAPE_FACTOR,
    CS2_STICKER_WEAR_FACTOR
} from "./economy-constants.ts";
import { CS2ItemType, type CS2UnlockedItem } from "./economy-types.ts";
import { CS2Economy, CS2EconomyInstance, CS2EconomyItem } from "./economy.ts";
import {
    assertInventoryItem,
    assertKeychains,
    assertStickers,
    getNextStickerSchema,
    repairInventoryItem,
    snapStickerRotation,
    validateStickerRotation
} from "./inventory-rules.ts";
import type {
    CS2BaseInventoryItem,
    CS2InventoryData,
    CS2InventoryOptions,
    CS2InventorySpec
} from "./inventory-types.ts";
import { resolveInventoryData } from "./inventory-upgrader.ts";
import { CS2Team } from "./teams.ts";
import { type Interface, type MapValue, type RecordValue, assert, ensure, roundToFactor } from "./utils.ts";

export const CS2_INVENTORY_VERSION = 1;
export const CS2_INVENTORY_TIMESTAMP = 1707696138408;
// prettier-ignore
export const CS2_INVENTORY_EQUIPPABLE_ITEMS: CS2ItemType[] = [CS2ItemType.Agent, CS2ItemType.Collectible, CS2ItemType.Gloves, CS2ItemType.Graffiti, CS2ItemType.Melee, CS2ItemType.MusicKit, CS2ItemType.Weapon];

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

export function stickerMapToArray(
    stickers: Map<number, RecordValue<CS2BaseInventoryItem["stickers"]>> | undefined
): RecordValue<CS2BaseInventoryItem["stickers"]>[] {
    return CS2InventoryItem.stickersToArray(stickers !== undefined ? Object.fromEntries(stickers) : undefined);
}

export function toStickerMap(
    stickers: CS2BaseInventoryItem["stickers"]
): Map<number, RecordValue<CS2BaseInventoryItem["stickers"]>> | undefined {
    return stickers !== undefined
        ? new Map(Object.entries(stickers).map(([key, value]) => [parseInt(key, 10), value]))
        : undefined;
}

export class CS2Inventory {
    private economy: CS2EconomyInstance;
    private items: Map<number, CS2InventoryItem>;
    readonly options: Readonly<CS2InventoryOptions>;

    static parse(stringValue: string | undefined | null, economy?: CS2EconomyInstance): CS2InventoryData | undefined {
        return resolveInventoryData(stringValue ?? undefined, economy);
    }

    constructor({ economy, data, maxItems, storageUnitMaxItems }: Partial<CS2InventorySpec> = {}) {
        this.economy = economy ?? CS2Economy;
        this.items = data !== undefined ? this.toInventoryItems(data.items) : new Map();
        this.options = {
            maxItems: maxItems ?? 256,
            storageUnitMaxItems: storageUnitMaxItems ?? 32
        };
    }

    // Kept as a delegate while `CS2InventoryItem` still reaches back through the inventory to
    // validate; group 6 moves those call sites onto `assertInventoryItem` directly.
    public validateBaseInventoryItem(item: CS2BaseInventoryItem): void {
        assertInventoryItem(this.economy, item);
    }

    private reconcileChargeableItems(items: Record<number, CS2BaseInventoryItem>): void {
        for (const item of Object.values(items)) {
            if (item.storage === undefined) {
                continue;
            }
            for (const [slot, stored] of Object.entries(item.storage)) {
                if (!this.economy.items.has(stored.id)) {
                    continue;
                }
                const economyItem = this.economy.getById(stored.id);
                if (economyItem.isCharmDetachment() || economyItem.isCharmDetachmentPack()) {
                    delete item.storage[parseInt(slot, 10)];
                } else if (economyItem.hasCharges()) {
                    stored.charges = undefined;
                }
            }
            if (Object.keys(item.storage).length === 0) {
                item.storage = undefined;
            }
        }
        const entries = Object.entries(items)
            .map(([key, value]) => [parseInt(key, 10), value] as const)
            .filter(([, { id }]) => this.economy.items.has(id) && this.economy.getById(id).isCharmDetachment())
            .sort(([a], [b]) => a - b);
        if (entries.length <= 1) {
            return;
        }
        const [survivorUid, survivor] = ensure(entries[0]);
        const economyItem = this.economy.getById(survivor.id);
        let charges = 0;
        for (const [uid, item] of entries) {
            charges += item.charges ?? economyItem.getDefaultCharges();
            if (uid !== survivorUid) {
                delete items[uid];
            }
        }
        survivor.charges = Math.min(charges, economyItem.getMaximumCharges());
        survivor.updatedAt = getTimestamp();
    }

    private toInventoryItems(items: Record<number, CS2BaseInventoryItem>): Map<number, CS2InventoryItem> {
        for (const value of Object.values(items)) {
            repairInventoryItem(this.economy, value);
        }
        this.reconcileChargeableItems(items);
        return new Map(
            Object.entries(items)
                .filter(([, { id }]) => this.economy.items.has(id))
                .map(([key, value]) => {
                    const uid = parseInt(key, 10);
                    return [uid, new CS2InventoryItem(this, uid, value, this.economy.getById(value.id))] as const;
                })
        );
    }

    private toBaseInventoryItems(items: Map<number, CS2InventoryItem>): Record<number, CS2BaseInventoryItem> {
        return Object.fromEntries(Array.from(items).map(([key, value]) => [key, value.asBase()]));
    }

    stringify(): string {
        return JSON.stringify(this.getData());
    }

    isFull(): boolean {
        return this.items.size >= this.options.maxItems;
    }

    private findChargeableUid(id: number): number | undefined {
        let found: number | undefined;
        for (const [uid, item] of this.items) {
            if (item.id === id && (found === undefined || uid < found)) {
                found = uid;
            }
        }
        return found;
    }

    private addCharges(economyItem: CS2EconomyItem, amount: number): this {
        assert(economyItem.hasCharges());
        const maximum = economyItem.getMaximumCharges();
        const uid = this.findChargeableUid(economyItem.id);
        if (uid !== undefined) {
            const item = this.get(uid);
            item.charges = Math.min((item.charges ?? economyItem.getDefaultCharges()) + amount, maximum);
            item.updatedAt = getTimestamp();
            return this;
        }
        assert(!this.isFull());
        const nextUid = getNextUid(this.items);
        this.items.set(
            nextUid,
            new CS2InventoryItem(
                this,
                nextUid,
                { id: economyItem.id, charges: Math.min(amount, maximum), updatedAt: getTimestamp() },
                economyItem
            )
        );
        return this;
    }

    add(item: CS2BaseInventoryItem): this {
        const economyItem = this.economy.getById(item.id);
        assert(!economyItem.isStub());
        assert(item.charges === undefined);
        if (economyItem.isCharmDetachment()) {
            return this.addCharges(economyItem, CS2_MIN_CHARGES);
        }
        assert(!this.isFull());
        const uid = getNextUid(this.items);
        this.items.set(
            uid,
            new CS2InventoryItem(
                this,
                uid,
                Object.assign(item, {
                    equipped: undefined,
                    equippedCT: undefined,
                    equippedT: undefined,
                    updatedAt: getTimestamp()
                }),
                economyItem
            )
        );
        return this;
    }

    private addInventoryItem(item: CS2InventoryItem): this {
        assert(!this.isFull());
        const uid = getNextUid(this.items);
        item.equipped = undefined;
        item.equippedCT = undefined;
        item.equippedT = undefined;
        item.uid = uid;
        item.updatedAt = getTimestamp();
        this.items.set(uid, item);
        return this;
    }

    addWithNameTag(nameTagUid: number, id: number, nameTag: string): this {
        this.get(nameTagUid).expectNameTag();
        this.economy.requireNameTag(nameTag);
        this.items.delete(nameTagUid);
        this.add({ id, nameTag });
        return this;
    }

    addWithSticker(
        stickerUid: number,
        id: number,
        attributes: Omit<RecordValue<CS2BaseInventoryItem["stickers"]>, "id"> = {}
    ): this {
        const sticker = this.get(stickerUid).expectSticker();
        const { schema, x, y, rotation, wear } = attributes;
        const stickers = { 0: { id: sticker.id, schema, x, y, rotation, wear } };
        assertStickers(this.economy, stickers, this.economy.getById(id));
        this.items.delete(stickerUid);
        this.add({ id, stickers });
        return this;
    }

    addWithKeychain(
        keychainUid: number,
        id: number,
        attributes: Omit<RecordValue<CS2BaseInventoryItem["keychains"]>, "id"> = {}
    ): this {
        const keychain = this.get(keychainUid).expectKeychain();
        const { seed, x, y, z } = attributes;
        const keychains = { 0: { id: keychain.id, seed, x, y, z } };
        assertKeychains(this.economy, keychains, this.economy.getById(id));
        this.items.delete(keychainUid);
        this.add({ id, keychains });
        return this;
    }

    edit(itemUid: number, properties: Partial<CS2BaseInventoryItem>): this {
        const item = this.get(itemUid);
        assert(properties.id === undefined || properties.id === item.id);
        assert(properties.charges === undefined || properties.charges === item.charges);
        item.edit(properties, { updatedAt: getTimestamp() });
        return this;
    }

    equip(itemUid: number, team?: CS2Team): this {
        const item = this.get(itemUid);
        assert(item.equipped === undefined);
        assert(team !== CS2Team.CT || item.equippedCT === undefined);
        assert(team !== CS2Team.T || item.equippedT === undefined);
        assert(CS2_INVENTORY_EQUIPPABLE_ITEMS.includes(item.type));
        assert(!item.isSealed());
        assert(team === undefined || item.teams?.includes(team));
        assert(team !== undefined || item.teams === undefined);
        for (const [otherUid, otherItem] of this.items) {
            if (itemUid === otherUid) {
                otherItem.equipped = team === undefined ? true : undefined;
                otherItem.equippedCT = team === CS2Team.CT ? true : otherItem.equippedCT;
                otherItem.equippedT = team === CS2Team.T ? true : otherItem.equippedT;
            } else {
                if (otherItem.type === item.type && (!item.isWeapon() || otherItem.modelKey === item.modelKey)) {
                    otherItem.equipped = team === undefined ? undefined : otherItem.equipped;
                    otherItem.equippedCT = team === CS2Team.CT ? undefined : otherItem.equippedCT;
                    otherItem.equippedT = team === CS2Team.T ? undefined : otherItem.equippedT;
                }
            }
        }
        return this;
    }

    unequip(uid: number, team?: CS2Team): this {
        const item = this.get(uid);
        item.equipped = team === undefined ? undefined : item.equipped;
        item.equippedCT = team === CS2Team.CT ? undefined : item.equippedCT;
        item.equippedT = team === CS2Team.T ? undefined : item.equippedT;
        return this;
    }

    unlockContainer(unlockedItem: CS2UnlockedItem, containerUid: number, keyUid?: number): this {
        const containerItem = this.get(containerUid);
        this.economy.expectUnlockedItem(containerItem, unlockedItem);
        const keyItem = keyUid !== undefined ? this.get(keyUid) : undefined;
        this.economy.validateContainerAndKey(containerItem, keyItem);
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

    unsealItem(uid: number): this {
        const item = this.get(uid);
        assert(item.isSealed());
        item.charges = item.getDefaultCharges();
        item.updatedAt = getTimestamp();
        return this;
    }

    unpackItem(packUid: number): this {
        this.get(packUid).expectCharmDetachmentPack();
        this.items.delete(packUid);
        return this.addCharges(this.economy.getCharmDetachment(), CS2_CHARM_DETACHMENT_PACK_CHARGES);
    }

    consumeItemCharges(uid: number, amount = 1): this {
        const item = this.get(uid);
        assert(item.hasCharges());
        assert(!item.isSealed());
        assert(Number.isInteger(amount) && amount > 0);
        const remaining = item.getCharges() - amount;
        assert(remaining >= 0);
        if (remaining === 0) {
            this.items.delete(uid);
            return this;
        }
        item.charges = remaining;
        item.updatedAt = getTimestamp();
        return this;
    }

    renameItem(nameTagUid: number, renameableUid: number, nameTag?: string): this {
        nameTag = this.economy.trimNameTag(nameTag);
        this.get(nameTagUid).expectNameTag();
        const renameable = this.get(renameableUid);
        this.economy.validateNameTag(nameTag, renameable);
        renameable.nameTag = nameTag;
        renameable.updatedAt = getTimestamp();
        this.items.delete(nameTagUid);
        return this;
    }

    renameStorageUnit(storageUid: number, nameTag: string): this {
        const trimmed = this.economy.trimNameTag(nameTag);
        const storageUnit = this.get(storageUid);
        storageUnit.expectStorageUnit();
        this.economy.requireNameTag(trimmed);
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
        item.expectStorageUnit();
        assert(depositUids.length > 0);
        assert(this.canDepositToStorageUnit(storageUid, depositUids.length));
        for (const sourceUid of depositUids) {
            const source = this.get(sourceUid);
            assert(!source.isStorageUnit());
            assert(!source.isCharmDetachment() && !source.isCharmDetachmentPack());
            assert(!source.hasCharges() || source.isSealed());
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
        item.expectStorageUnit();
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

    applyItemSticker(
        targetUid: number,
        stickerUid: number,
        attributes: Omit<RecordValue<CS2BaseInventoryItem["stickers"]>, "id"> = {}
    ): this {
        const target = this.get(targetUid);
        const sticker = this.get(stickerUid).expectSticker();
        assert(target.hasStickers());
        const stickers = stickerMapToArray(target.stickers);
        assert(stickers.length < CS2_MAX_STICKERS);
        const { schema, x, y, rotation, wear } = attributes;
        stickers.push({
            id: sticker.id,
            schema: schema ?? getNextStickerSchema(stickers, target.getStickerSchemaCount()),
            x,
            y,
            rotation,
            wear
        });
        const record = CS2InventoryItem.stickersFromArray(stickers);
        assertStickers(this.economy, record, target);
        target.stickers = toStickerMap(record);
        target.updatedAt = getTimestamp();
        this.items.delete(stickerUid);
        return this;
    }

    removeItemSticker(targetUid: number, index: number): this {
        const target = this.get(targetUid);
        const stickers = stickerMapToArray(target.stickers);
        assert(stickers[index] !== undefined);
        stickers.splice(index, 1);
        target.stickers = toStickerMap(CS2InventoryItem.stickersFromArray(stickers));
        target.updatedAt = getTimestamp();
        return this;
    }

    moveItemSticker(targetUid: number, fromIndex: number, toIndex: number): this {
        const target = this.get(targetUid);
        const stickers = stickerMapToArray(target.stickers);
        const sticker = ensure(stickers[fromIndex]);
        assert(Number.isInteger(toIndex) && toIndex >= 0 && toIndex < stickers.length);
        stickers.splice(fromIndex, 1);
        stickers.splice(toIndex, 0, sticker);
        target.stickers = toStickerMap(CS2InventoryItem.stickersFromArray(stickers));
        target.updatedAt = getTimestamp();
        return this;
    }

    editItemSticker(
        targetUid: number,
        index: number,
        patch: Partial<RecordValue<CS2BaseInventoryItem["stickers"]>>
    ): this {
        const target = this.get(targetUid);
        const stickers = stickerMapToArray(target.stickers);
        assert(stickers[index] !== undefined);
        stickers[index] = { ...stickers[index], ...patch };
        const record = CS2InventoryItem.stickersFromArray(stickers);
        assertStickers(this.economy, record, target);
        target.stickers = toStickerMap(record);
        target.updatedAt = getTimestamp();
        return this;
    }

    scrapeItemSticker(targetUid: number, index: number, wear?: number): this {
        const target = this.get(targetUid);
        const stickers = stickerMapToArray(target.stickers);
        const sticker = ensure(stickers[index]);
        const currentWear = sticker.wear ?? CS2_MIN_STICKER_WEAR;
        let nextWear: number;
        if (wear !== undefined) {
            assert(Number.isFinite(wear));
            assert(wear > currentWear && wear <= CS2_MAX_STICKER_WEAR);
            nextWear = roundToFactor(wear, CS2_STICKER_WEAR_FACTOR);
        } else {
            nextWear = roundToFactor(currentWear + CS2_STICKER_SCRAPE_FACTOR, CS2_STICKER_WEAR_FACTOR);
        }
        const gone = wear === undefined ? nextWear > CS2_MAX_STICKER_WEAR : nextWear >= CS2_MAX_STICKER_WEAR;
        if (gone) {
            stickers.splice(index, 1);
        } else {
            stickers[index] = { ...sticker, wear: nextWear };
        }
        target.stickers = toStickerMap(CS2InventoryItem.stickersFromArray(stickers));
        target.updatedAt = getTimestamp();
        return this;
    }

    applyItemPatch(targetUid: number, patchUid: number, slot: number): this {
        assert(slot >= 0 && slot <= CS2_MAX_PATCHES - 1);
        const target = this.get(targetUid).expectAgent();
        const patch = this.get(patchUid).expectPatch();
        target.patches ??= new Map();
        assert(target.patches.get(slot) === undefined);
        target.patches.set(slot, patch.id);
        target.updatedAt = getTimestamp();
        this.items.delete(patchUid);
        return this;
    }

    removeItemPatch(targetUid: number, slot: number): this {
        const target = this.get(targetUid);
        assert(target.patches !== undefined);
        assert(target.patches.get(slot) !== undefined);
        target.patches.delete(slot);
        if (target.patches.size === 0) {
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
        this.get(statTrakSwapToolUid).expectStatTrakSwapTool();
        const fromItem = this.get(fromUid);
        const toItem = this.get(toUid);
        assert(fromItem.statTrak !== undefined && toItem.statTrak !== undefined);
        assert(fromItem.type === toItem.type);
        assert(fromItem.isMusicKit() || fromItem.definitionIndex === toItem.definitionIndex);
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

    getAllAsBase(): CS2BaseInventoryItem[] {
        return Object.values(this.toBaseInventoryItems(this.items));
    }

    setAll(items: Map<number, CS2InventoryItem>): this {
        this.items = items;
        return this;
    }

    getData(): CS2InventoryData {
        return {
            items: this.toBaseInventoryItems(this.items),
            version: CS2_INVENTORY_VERSION
        };
    }

    size(): number {
        return this.items.size;
    }

    move(options: Partial<CS2InventorySpec> = {}): CS2Inventory {
        return new CS2Inventory({
            ...this.options,
            economy: this.economy,
            ...options
        }).setAll(this.items);
    }
}

export class CS2InventoryItem
    extends CS2EconomyItem
    implements Interface<Omit<CS2BaseInventoryItem, "keychains" | "patches" | "stickers" | "storage">>
{
    charges: number | undefined;
    containerId: number | undefined;
    equipped: boolean | undefined;
    equippedCT: boolean | undefined;
    equippedT: boolean | undefined;
    keychains: Map<number, RecordValue<CS2BaseInventoryItem["keychains"]>> | undefined;
    nameTag: string | undefined;
    patches: Map<number, number> | undefined;
    seed: number | undefined;
    statTrak: number | undefined;
    stickers: Map<number, RecordValue<CS2BaseInventoryItem["stickers"]>> | undefined;
    storage: Map<number, CS2InventoryItem> | undefined;
    updatedAt: number | undefined;
    wear: number | undefined;

    private assign({ keychains, patches, stickers, storage }: Partial<CS2BaseInventoryItem>): void {
        if (patches !== undefined) {
            this.patches = new Map(
                Object.entries(patches)
                    .filter(([, patchId]) => this.economy.items.has(patchId))
                    .map(([slot, patchId]) => [parseInt(slot, 10), patchId])
            );
        }
        if (stickers !== undefined) {
            this.stickers = toStickerMap(
                CS2InventoryItem.stickersFromArray(
                    CS2InventoryItem.stickersToArray(stickers, this.getStickerSchemaCount()).filter(({ id }) =>
                        this.economy.items.has(id)
                    )
                )
            );
        }
        if (keychains !== undefined) {
            this.keychains = new Map(
                Object.entries(keychains)
                    .filter(([, { id }]) => this.economy.items.has(id))
                    .map(([slot, keychain]) => [parseInt(slot, 10), keychain])
            );
        }
        if (storage !== undefined) {
            assert(this.isStorageUnit());
            this.storage = new Map(
                Object.entries(storage)
                    .filter(([, { id }]) => this.economy.items.has(id))
                    .map(([key, value]) => {
                        repairInventoryItem(this.economy, value);
                        const economyItem = this.economy.getById(value.id);
                        assert(value.storage === undefined);
                        const uid = parseInt(key, 10);
                        return [uid, new CS2InventoryItem(this.inventory, uid, value, economyItem)];
                    })
            );
        }
    }

    constructor(
        private inventory: CS2Inventory,
        public uid: number,
        baseInventoryItem: CS2BaseInventoryItem,
        { economy, item, language }: CS2EconomyItem
    ) {
        super(economy, item, language);
        inventory.validateBaseInventoryItem(baseInventoryItem);
        Object.assign(this, baseInventoryItem);
        this.assign(baseInventoryItem);
    }

    edit(...sources: Partial<CS2BaseInventoryItem>[]): void {
        const merged: CS2BaseInventoryItem = this.asBase();
        for (const source of sources) {
            Object.assign(merged, source);
        }
        this.inventory.validateBaseInventoryItem(merged);
        for (const source of sources) {
            Object.assign(this, source);
            this.assign(source);
        }
    }

    static stickersToArray(
        stickers: CS2BaseInventoryItem["stickers"],
        schemaCount?: number
    ): RecordValue<CS2BaseInventoryItem["stickers"]>[] {
        if (stickers === undefined) {
            return [];
        }
        const sorted = Object.entries(stickers)
            .map(([key, sticker]) => [parseInt(key, 10), sticker] as const)
            .sort(([a], [b]) => a - b)
            .slice(0, CS2_MAX_STICKERS);
        const result: RecordValue<CS2BaseInventoryItem["stickers"]>[] = [];
        for (const [key, sticker] of sorted) {
            let schema = sticker.schema ?? key;
            if (schemaCount !== undefined && (!Number.isInteger(schema) || schema < 0 || schema >= schemaCount)) {
                schema = getNextStickerSchema(result, schemaCount);
            }
            result.push({ ...sticker, schema });
        }
        return result;
    }

    static stickersFromArray(
        stickers: RecordValue<CS2BaseInventoryItem["stickers"]>[]
    ): CS2BaseInventoryItem["stickers"] {
        if (stickers.length === 0) {
            return undefined;
        }
        return Object.fromEntries(
            stickers.slice(0, CS2_MAX_STICKERS).map((sticker, index) => [
                index,
                {
                    id: sticker.id,
                    schema: sticker.schema ?? index,
                    wear: sticker.wear || undefined,
                    rotation: sticker.rotation || undefined,
                    x: sticker.x || undefined,
                    y: sticker.y || undefined
                }
            ])
        );
    }

    allStickers(): [number, MapValue<CS2InventoryItem["stickers"]>][] {
        return stickerMapToArray(this.stickers).map((sticker, index) => [index, sticker]);
    }

    someStickers(): [number, MapValue<CS2InventoryItem["stickers"]>][] {
        return this.allStickers();
    }

    getStickersCount(): number {
        return this.stickers?.size ?? 0;
    }

    allKeychains(): [number, MapValue<CS2InventoryItem["keychains"]> | undefined][] {
        const entries: [number, MapValue<CS2InventoryItem["keychains"]> | undefined][] = [];
        for (let slot = 0; slot < CS2_MAX_KEYCHAINS; slot++) {
            const keychain = this.keychains?.get(slot);
            entries.push([slot, keychain]);
        }
        return entries;
    }

    someKeychains(): [number, MapValue<CS2InventoryItem["keychains"]>][] {
        return this.allKeychains().filter(
            (value): value is [number, MapValue<CS2InventoryItem["keychains"]>] => value[1] !== undefined
        );
    }

    getKeychainsCount(): number {
        return this.keychains?.size ?? 0;
    }

    allPatches(): [number, number | undefined][] {
        const entries: [number, number | undefined][] = [];
        for (let slot = 0; slot < CS2_MAX_PATCHES; slot++) {
            const patch = this.patches?.get(slot);
            entries.push([slot, patch]);
        }
        return entries;
    }

    somePatches(): [number, number][] {
        return this.allPatches().filter((value): value is [number, number] => value[1] !== undefined);
    }

    getPatchesCount(): number {
        return this.patches?.size ?? 0;
    }

    getCharges(): number {
        return this.charges ?? 0;
    }

    isSealed(): boolean {
        return this.hasCharges() && this.charges === undefined;
    }

    getWear(): number {
        return this.wear ?? this.wearMin ?? CS2_MIN_WEAR;
    }

    getStickerWear(slot: number): number {
        return this.stickers?.get(slot)?.wear ?? CS2_MIN_STICKER_WEAR;
    }

    getKeychainSeed(slot: number): number {
        return this.keychains?.get(slot)?.seed ?? CS2_MIN_KEYCHAIN_SEED;
    }

    override getImageUrl(wear?: number): string {
        return super.getImageUrl(wear ?? this.getWear());
    }

    asBase(): CS2BaseInventoryItem {
        return {
            charges: this.charges,
            containerId: this.containerId,
            equipped: this.equipped,
            equippedCT: this.equippedCT,
            equippedT: this.equippedT,
            id: this.id,
            keychains: this.keychains !== undefined ? Object.fromEntries(this.keychains) : undefined,
            nameTag: this.nameTag,
            patches: this.patches !== undefined ? Object.fromEntries(this.patches) : undefined,
            seed: this.seed,
            statTrak: this.statTrak,
            stickers: this.stickers !== undefined ? Object.fromEntries(this.stickers) : undefined,
            storage:
                this.storage !== undefined
                    ? Object.fromEntries(Array.from(this.storage).map(([key, value]) => [key, value.asBase()]))
                    : undefined,
            updatedAt: this.updatedAt,
            wear: this.wear
        } satisfies Interface<CS2BaseInventoryItem>;
    }
}
