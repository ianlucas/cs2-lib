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
    CS2_STICKER_WEAR_FACTOR
} from "./economy-constants.js";
import { CS2ItemType, CS2ItemTypeValues, CS2UnlockedItem } from "./economy-types.js";
import { CS2Economy, CS2EconomyInstance, CS2EconomyItem } from "./economy.js";
import { resolveInventoryData } from "./inventory-upgrader.js";
import { CS2Team, CS2TeamValues } from "./teams.js";
import { Interface, MapValue, assert, ensure, float } from "./utils.js";

export interface CS2BaseInventoryItem {
    containerId?: number;
    equipped?: boolean;
    equippedCT?: boolean;
    equippedT?: boolean;
    id: number;
    nameTag?: string;
    patches?: Record<number, number>;
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
export const CS2_INVENTORY_EQUIPPABLE_ITEMS: CS2ItemTypeValues[] = [CS2ItemType.Agent, CS2ItemType.Collectible, CS2ItemType.Gloves, CS2ItemType.Graffiti, CS2ItemType.Melee, CS2ItemType.MusicKit, CS2ItemType.Patch, CS2ItemType.Weapon];

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

    static parse(stringValue: string | undefined | null, economy?: CS2EconomyInstance): CS2InventoryData | undefined {
        return resolveInventoryData(stringValue, economy);
    }

    constructor({ economy, data, maxItems, storageUnitMaxItems }: Partial<CS2InventorySpec> = {}) {
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
        for (const [key, { id: stickerId, wear }] of entries) {
            const slot = parseInt(key, 10);
            assert(slot >= 0 && slot <= CS2_MAX_STICKERS - 1);
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
        for (const [key, patchId] of Object.entries(patches)) {
            const slot = parseInt(key, 10);
            assert(slot >= 0 && slot <= CS2_MAX_PATCHES - 1);
            assert(patchId === undefined || this.economy.getById(patchId).isPatch());
        }
    }

    public validateBaseInventoryItem({
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

    private toInventoryItems(items: Record<number, CS2BaseInventoryItem>): Map<number, CS2InventoryItem> {
        return new Map(
            Object.entries(items).map(([key, value]) => {
                const uid = parseInt(key, 10);
                return [uid, new CS2InventoryItem(this, uid, value, this.economy.getById(value.id))] as const;
            })
        );
    }

    private toBaseInventoryItems(items: Map<number, CS2InventoryItem>): Record<number, CS2BaseInventoryItem> {
        return Object.fromEntries(Array.from(items).map(([key, value]) => [key, value.asBase()]));
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
        const economyItem = this.economy.getById(item.id);
        assert(!economyItem.isStub());
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

    addWithNametag(nameTagUid: number, id: number, nameTag: string): this {
        this.get(nameTagUid).expectNameTag();
        this.economy.requireNametag(nameTag);
        this.items.delete(nameTagUid);
        this.add({ id, nameTag });
        return this;
    }

    addWithSticker(stickerUid: number, id: number, stickerIndex: number): this {
        const sticker = this.get(stickerUid).expectSticker();
        this.items.delete(stickerUid);
        this.add({
            id,
            stickers: { [stickerIndex]: { id: sticker.id } }
        });
        return this;
    }

    edit(itemUid: number, properties: Partial<CS2BaseInventoryItem>): this {
        const item = this.get(itemUid);
        assert(properties.id === undefined || properties.id === item.id);
        item.edit(properties, { updatedAt: getTimestamp() });
        return this;
    }

    equip(itemUid: number, team?: CS2TeamValues): this {
        const item = this.get(itemUid);
        assert(item.equipped === undefined);
        assert(team !== CS2Team.CT || item.equippedCT === undefined);
        assert(team !== CS2Team.T || item.equippedT === undefined);
        assert(CS2_INVENTORY_EQUIPPABLE_ITEMS.includes(item.type));
        assert(team === undefined || item.teams?.includes(team));
        assert(team !== undefined || item.teams === undefined);
        for (const [otherUid, otherItem] of this.items) {
            if (itemUid === otherUid) {
                otherItem.equipped = team === undefined ? true : undefined;
                otherItem.equippedCT = team === CS2Team.CT ? true : otherItem.equippedCT;
                otherItem.equippedT = team === CS2Team.T ? true : otherItem.equippedT;
            } else {
                if (
                    otherItem.type === item.type &&
                    (item.type !== CS2ItemType.Weapon || otherItem.model === item.model)
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

    unlockContainer(unlockedItem: CS2UnlockedItem, containerUid: number, keyUid?: number): this {
        const containerItem = this.get(containerUid);
        this.economy.validateUnlockedItem(containerItem, unlockedItem);
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

    renameItem(nameTagUid: number, renameableUid: number, nameTag?: string): this {
        nameTag = this.economy.trimNametag(nameTag);
        this.get(nameTagUid).expectNameTag();
        const renameable = this.get(renameableUid);
        this.economy.validateNametag(nameTag, renameable);
        renameable.nameTag = nameTag;
        renameable.updatedAt = getTimestamp();
        this.items.delete(nameTagUid);
        return this;
    }

    renameStorageUnit(storageUid: number, nameTag: string): this {
        const trimmed = this.economy.trimNametag(nameTag);
        const storageUnit = this.get(storageUid);
        storageUnit.expectStorageUnit();
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
        item.expectStorageUnit();
        assert(depositUids.length > 0);
        assert(this.canDepositToStorageUnit(storageUid, depositUids.length));
        for (const sourceUid of depositUids) {
            assert(!this.get(sourceUid).isStorageUnit());
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

    applyItemSticker(targetUid: number, stickerUid: number, stickerIndex: number): this {
        assert(stickerIndex >= 0 && stickerIndex <= CS2_MAX_STICKERS - 1);
        const target = this.get(targetUid);
        const sticker = this.get(stickerUid);
        assert(target.hasStickers());
        sticker.expectSticker();
        target.stickers ??= new Map();
        assert(target.stickers.get(stickerIndex) === undefined);
        target.stickers.set(stickerIndex, { id: sticker.id });
        target.updatedAt = getTimestamp();
        this.items.delete(stickerUid);
        return this;
    }

    scrapeItemSticker(targetUid: number, stickerIndex: number): this {
        const target = this.get(targetUid);
        assert(target.stickers !== undefined);
        const sticker = ensure(target.stickers.get(stickerIndex));
        const wear = sticker.wear ?? 0;
        const nextWear = float(wear + CS2_STICKER_WEAR_FACTOR);
        if (nextWear > CS2_MAX_WEAR) {
            target.stickers.delete(stickerIndex);
            if (target.stickers.size === 0) {
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
        const target = this.get(targetUid).expectAgent();
        const patch = this.get(patchUid).expectPatch();
        target.patches ??= new Map();
        assert(target.patches.get(patchIndex) === undefined);
        target.patches.set(patchIndex, patch.id);
        target.updatedAt = getTimestamp();
        this.items.delete(patchUid);
        return this;
    }

    removeItemPatch(targetUid: number, patchIndex: number): this {
        const target = this.get(targetUid);
        assert(target.patches !== undefined);
        assert(target.patches.get(patchIndex) !== undefined);
        target.patches.delete(patchIndex);
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
        assert(fromItem.type === CS2ItemType.MusicKit || fromItem.def === toItem.def);
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

export class CS2InventoryItem
    extends CS2EconomyItem
    implements Interface<Omit<CS2BaseInventoryItem, "patches" | "stickers" | "storage">>
{
    containerId: number | undefined;
    equipped: boolean | undefined;
    equippedCT: boolean | undefined;
    equippedT: boolean | undefined;
    nameTag: string | undefined;
    patches: Map<number, number> | undefined;
    seed: number | undefined;
    statTrak: number | undefined;
    stickers:
        | Map<
              number,
              {
                  id: number;
                  wear?: number;
                  x?: number;
                  y?: number;
              }
          >
        | undefined;
    storage: Map<number, CS2InventoryItem> | undefined;
    updatedAt: number | undefined;
    wear: number | undefined;

    private assign({ patches, stickers, storage }: Partial<CS2BaseInventoryItem>): void {
        if (patches !== undefined) {
            this.patches = new Map(Object.entries(patches).map(([key, item]) => [parseInt(key, 10), item]));
        }
        if (stickers !== undefined) {
            this.stickers = new Map(Object.entries(stickers).map(([key, item]) => [parseInt(key, 10), item]));
        }
        if (storage !== undefined) {
            assert(this.isStorageUnit());
            this.storage = new Map(
                Object.entries(storage).map(([key, item]) => {
                    const storedEconomyItem = this.economy.getById(item.id);
                    assert(item.storage === undefined);
                    const uid = parseInt(key, 10);
                    return [uid, new CS2InventoryItem(this.inventory, uid, item, storedEconomyItem)];
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
        for (const source of sources) {
            Object.assign(this, source);
            this.assign(source);
        }
    }

    allStickers(): [number, MapValue<CS2InventoryItem["stickers"]> | undefined][] {
        const entries: [number, MapValue<CS2InventoryItem["stickers"]> | undefined][] = [];
        for (let slot = 0; slot < CS2_MAX_STICKERS; slot++) {
            const sticker = this.stickers?.get(slot);
            entries.push([slot, sticker]);
        }
        return entries;
    }

    someStickers(): [number, MapValue<CS2InventoryItem["stickers"]>][] {
        return this.allStickers().filter(
            (value): value is [number, MapValue<CS2InventoryItem["stickers"]>] => value[1] !== undefined
        );
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

    asBase(): CS2BaseInventoryItem {
        return {
            containerId: this.containerId,
            equipped: this.equipped,
            equippedCT: this.equippedCT,
            equippedT: this.equippedT,
            id: this.id,
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
