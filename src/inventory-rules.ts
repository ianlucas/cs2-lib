/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    CS2_KEYCHAIN_POSITION_FACTOR,
    CS2_MAX_KEYCHAINS,
    CS2_MAX_KEYCHAIN_SEED,
    CS2_MAX_PATCHES,
    CS2_MAX_STATTRAK,
    CS2_MAX_STICKERS,
    CS2_MAX_STICKER_ROTATION,
    CS2_MAX_STICKER_WEAR,
    CS2_MIN_CHARGES,
    CS2_MIN_KEYCHAIN_SEED,
    CS2_MIN_STATTRAK,
    CS2_MIN_STICKER_ROTATION,
    CS2_MIN_STICKER_WEAR,
    CS2_STICKER_OFFSET_FACTOR,
    CS2_STICKER_ROTATION_STEP,
    CS2_STICKER_WEAR_FACTOR
} from "./economy-constants.ts";
import type { CS2Bounds } from "./economy-types.ts";
import type { CS2EconomyInstance, CS2EconomyItem } from "./economy.ts";
import type { CS2InventoryDrop, CS2InventoryDropReason } from "./inventory-format.ts";
import type { CS2BaseInventoryItem, CS2InventoryOptions } from "./inventory-types.ts";
import { CS2InventoryItem, getTimestamp } from "./inventory.ts";
import { type RecordValue, assert, clamp, ensure, isFactorPrecise, truncateToFactor } from "./utils.ts";

export interface CS2InventoryRule<T> {
    check(value: T | undefined, item: CS2EconomyItem): boolean;
    repair(value: T | undefined, item: CS2EconomyItem): T | undefined;
}

function boundedRule(factor: number, getBounds: (item: CS2EconomyItem) => CS2Bounds): CS2InventoryRule<number> {
    return {
        check(value, item) {
            if (value === undefined) {
                return true;
            }
            const { min, max } = getBounds(item);
            return (
                isFactorPrecise(value, factor) &&
                (min === undefined || value >= min) &&
                (max === undefined || value <= max)
            );
        },
        repair(value, item) {
            if (value === undefined || !Number.isFinite(value)) {
                return undefined;
            }
            const { min, max } = getBounds(item);
            const truncated = truncateToFactor(value, factor);
            return clamp(truncated, min ?? truncated, max ?? truncated);
        }
    };
}

function wholeNumberRule(getBounds: (item: CS2EconomyItem) => { min: number; max: number }): CS2InventoryRule<number> {
    return {
        check(value, item) {
            if (value === undefined) {
                return true;
            }
            const { min, max } = getBounds(item);
            return Number.isInteger(value) && value >= min && value <= max;
        },
        repair(value, item) {
            if (value === undefined || !Number.isFinite(value)) {
                return undefined;
            }
            const { min, max } = getBounds(item);
            return clamp(Math.trunc(value), min, max);
        }
    };
}

export function validateStickerRotation(rotation?: number): boolean {
    return (
        rotation === undefined ||
        (Number.isInteger(rotation / CS2_STICKER_ROTATION_STEP) &&
            rotation >= CS2_MIN_STICKER_ROTATION &&
            rotation <= CS2_MAX_STICKER_ROTATION)
    );
}

export function snapStickerRotation(rotation: number): number {
    return Math.round(rotation / CS2_STICKER_ROTATION_STEP) * CS2_STICKER_ROTATION_STEP;
}

const stickerRotationRule: CS2InventoryRule<number> = {
    check: (rotation) => validateStickerRotation(rotation),
    repair(rotation) {
        if (rotation === undefined) {
            return undefined;
        }
        const snapped = snapStickerRotation(rotation);
        return validateStickerRotation(snapped) ? snapped : undefined;
    }
};

export type CS2InventoryRuleName =
    | "itemCharges"
    | "itemSeed"
    | "itemStatTrak"
    | "itemWear"
    | "keychainPositionX"
    | "keychainPositionY"
    | "keychainPositionZ"
    | "keychainSeed"
    | "stickerRotation"
    | "stickerSchema"
    | "stickerWear"
    | "stickerX"
    | "stickerY";

export const CS2_INVENTORY_RULES: Record<CS2InventoryRuleName, CS2InventoryRule<number>> = {
    itemCharges: {
        check: (charges, item) => item.economy.safeValidateCharges(charges, item),
        repair(charges, item) {
            return charges !== undefined && item.hasCharges() && Number.isFinite(charges)
                ? clamp(Math.trunc(charges), CS2_MIN_CHARGES, item.getMaximumCharges())
                : undefined;
        }
    },
    itemSeed: {
        check: (seed, item) => item.economy.safeValidateSeed(seed, item),
        repair(seed, item) {
            return seed !== undefined && item.hasSeed() && Number.isFinite(seed)
                ? clamp(Math.trunc(seed), item.getMinimumSeed(), item.getMaximumSeed())
                : undefined;
        }
    },
    itemStatTrak: {
        check: (statTrak, item) => item.economy.safeValidateStatTrak(statTrak, item),
        repair(statTrak, item) {
            return statTrak !== undefined && item.hasStatTrak() && Number.isFinite(statTrak)
                ? clamp(Math.trunc(statTrak), CS2_MIN_STATTRAK, CS2_MAX_STATTRAK)
                : undefined;
        }
    },
    itemWear: {
        check: (wear, item) => item.economy.safeValidateWear(wear, item),
        repair(wear, item) {
            if (wear === undefined || !item.hasWear()) {
                return undefined;
            }
            const clamped = clamp(wear, item.getMinimumWear(), item.getMaximumWear());
            return item.economy.safeValidateWear(clamped, item) ? clamped : undefined;
        }
    },
    keychainPositionX: boundedRule(CS2_KEYCHAIN_POSITION_FACTOR, (item) => item.getKeychainPositionBounds().x),
    keychainPositionY: boundedRule(CS2_KEYCHAIN_POSITION_FACTOR, (item) => item.getKeychainPositionBounds().y),
    keychainPositionZ: boundedRule(CS2_KEYCHAIN_POSITION_FACTOR, (item) => item.getKeychainPositionBounds().z),
    keychainSeed: wholeNumberRule(() => ({ min: CS2_MIN_KEYCHAIN_SEED, max: CS2_MAX_KEYCHAIN_SEED })),
    stickerRotation: stickerRotationRule,
    stickerSchema: {
        check: (schema, item) => checkStickerSchema(schema, item.getStickerSchemaCount()),
        repair: (schema, item) => (checkStickerSchema(schema, item.getStickerSchemaCount()) ? schema : undefined)
    },
    stickerWear: boundedRule(CS2_STICKER_WEAR_FACTOR, () => ({ min: CS2_MIN_STICKER_WEAR, max: CS2_MAX_STICKER_WEAR })),
    stickerX: boundedRule(CS2_STICKER_OFFSET_FACTOR, (item) => item.getStickerOffsetBounds().x),
    stickerY: boundedRule(CS2_STICKER_OFFSET_FACTOR, (item) => item.getStickerOffsetBounds().y)
};

export function checkStickerSchema(schema: number | undefined, schemaCount: number): boolean {
    return schema === undefined || (Number.isInteger(schema) && schema >= 0 && schema < schemaCount);
}

export function getNextStickerSchema(
    stickers: RecordValue<CS2BaseInventoryItem["stickers"]>[],
    schemaCount: number
): number {
    const used = new Set(stickers.map(({ schema }) => schema));
    for (let schema = 0; schema < schemaCount; schema++) {
        if (!used.has(schema)) {
            return schema;
        }
    }
    return 0;
}

export function checkAddable(item: CS2EconomyItem): boolean {
    return !item.isGloves() || item.isDefault === true || item.isBase !== true;
}

export function assertAddable(item: CS2EconomyItem): void {
    assert(checkAddable(item));
}

export function checkAttachable(item: CS2EconomyItem): boolean {
    return item.isDefault !== true;
}

function checkAttachmentId(
    economy: CS2EconomyInstance,
    id: number,
    checkKind: (item: CS2EconomyItem) => boolean
): boolean {
    if (!economy.items.has(id)) {
        return false;
    }
    const item = economy.getById(id);
    return checkKind(item) && checkAttachable(item);
}

export function checkStickers(
    economy: CS2EconomyInstance,
    stickers: CS2BaseInventoryItem["stickers"],
    item: CS2EconomyItem
): boolean {
    if (stickers === undefined) {
        return true;
    }
    const entries = Object.values(stickers);
    if (entries.length > CS2_MAX_STICKERS || !item.hasStickers()) {
        return false;
    }
    for (const { id: stickerId, wear, rotation, x, y, schema } of entries) {
        if (!economy.items.has(stickerId)) {
            return false;
        }
        const sticker = economy.getById(stickerId);
        if (!sticker.isSticker() || !checkAttachable(sticker)) {
            return false;
        }
        if (
            !CS2_INVENTORY_RULES.stickerWear.check(wear, item) ||
            !CS2_INVENTORY_RULES.stickerRotation.check(rotation, item) ||
            !CS2_INVENTORY_RULES.stickerX.check(x, item) ||
            !CS2_INVENTORY_RULES.stickerY.check(y, item) ||
            !CS2_INVENTORY_RULES.stickerSchema.check(schema, item)
        ) {
            return false;
        }
    }
    return true;
}

export function assertStickers(
    economy: CS2EconomyInstance,
    stickers: CS2BaseInventoryItem["stickers"],
    item: CS2EconomyItem
): void {
    assert(checkStickers(economy, stickers, item));
}

export function checkKeychains(
    economy: CS2EconomyInstance,
    keychains: CS2BaseInventoryItem["keychains"],
    item: CS2EconomyItem
): boolean {
    if (keychains === undefined) {
        return true;
    }
    const entries = Object.entries(keychains);
    if (entries.length > CS2_MAX_KEYCHAINS || !item.hasKeychains()) {
        return false;
    }
    for (const [key, { id: keychainId, seed, x, y, z }] of entries) {
        const slot = parseInt(key, 10);
        if (slot < 0 || slot > CS2_MAX_KEYCHAINS - 1) {
            return false;
        }
        if (!economy.items.has(keychainId)) {
            return false;
        }
        const keychain = economy.getById(keychainId);
        if (!keychain.isKeychain() || !checkAttachable(keychain)) {
            return false;
        }
        if (
            !CS2_INVENTORY_RULES.keychainSeed.check(seed, item) ||
            !CS2_INVENTORY_RULES.keychainPositionX.check(x, item) ||
            !CS2_INVENTORY_RULES.keychainPositionY.check(y, item) ||
            !CS2_INVENTORY_RULES.keychainPositionZ.check(z, item)
        ) {
            return false;
        }
    }
    return true;
}

export function assertKeychains(
    economy: CS2EconomyInstance,
    keychains: CS2BaseInventoryItem["keychains"],
    item: CS2EconomyItem
): void {
    assert(checkKeychains(economy, keychains, item));
}

export function checkPatches(
    economy: CS2EconomyInstance,
    patches: CS2BaseInventoryItem["patches"],
    item: CS2EconomyItem
): boolean {
    if (patches === undefined) {
        return true;
    }
    if (!item.isAgent()) {
        return false;
    }
    for (const [key, patchId] of Object.entries(patches)) {
        const slot = parseInt(key, 10);
        if (slot < 0 || slot > CS2_MAX_PATCHES - 1) {
            return false;
        }
        if (!economy.items.has(patchId)) {
            return false;
        }
        const patch = economy.getById(patchId);
        if (!patch.isPatch() || !checkAttachable(patch)) {
            return false;
        }
    }
    return true;
}

export function assertPatches(
    economy: CS2EconomyInstance,
    patches: CS2BaseInventoryItem["patches"],
    item: CS2EconomyItem
): void {
    assert(checkPatches(economy, patches, item));
}

export function checkStorage(
    economy: CS2EconomyInstance,
    storage: CS2BaseInventoryItem["storage"],
    item: CS2EconomyItem
): boolean {
    if (storage === undefined) {
        return true;
    }
    if (!item.isStorageUnit()) {
        return false;
    }
    for (const stored of Object.values(storage)) {
        if (
            stored.storage !== undefined ||
            !economy.items.has(stored.id) ||
            !isStorableInStorageUnit(stored, economy.getById(stored.id)) ||
            !checkInventoryItem(economy, stored)
        ) {
            return false;
        }
    }
    return true;
}

export function isStorableInStorageUnit(
    { charges }: Pick<CS2BaseInventoryItem, "charges">,
    item: CS2EconomyItem
): boolean {
    return (
        !item.isStorageUnit() &&
        !item.isCharmDetachment() &&
        !item.isCharmDetachmentPack() &&
        (!item.hasCharges() || charges === undefined)
    );
}

export function checkInventoryItem(
    economy: CS2EconomyInstance,
    { charges, id, keychains, nameTag, patches, seed, statTrak, stickers, storage, wear }: CS2BaseInventoryItem
): boolean {
    if (!economy.items.has(id)) {
        return false;
    }
    const item = economy.getById(id);
    return (
        CS2_INVENTORY_RULES.itemWear.check(wear, item) &&
        CS2_INVENTORY_RULES.itemCharges.check(charges, item) &&
        CS2_INVENTORY_RULES.itemSeed.check(seed, item) &&
        CS2_INVENTORY_RULES.itemStatTrak.check(statTrak, item) &&
        economy.safeRequireNameTag(nameTag, item) &&
        checkAddable(item) &&
        checkPatches(economy, patches, item) &&
        checkStickers(economy, stickers, item) &&
        checkKeychains(economy, keychains, item) &&
        checkStorage(economy, storage, item)
    );
}

export function assertInventoryItem(economy: CS2EconomyInstance, item: CS2BaseInventoryItem): void {
    assert(checkInventoryItem(economy, item));
}

function repairSlots(slots: Record<string, unknown>, maximum: number): void {
    const keys = Object.keys(slots)
        .map((key) => [key, parseInt(key, 10)] as const)
        .sort(([, a], [, b]) => a - b);
    let kept = 0;
    for (const [key, slot] of keys) {
        if (!Number.isInteger(slot) || slot < 0 || slot >= maximum || kept === maximum) {
            delete slots[key];
        } else {
            kept++;
        }
    }
}

export function getDropReason(economy: CS2EconomyInstance, id: number): CS2InventoryDropReason {
    return economy.items.has(id) ? "unrepairable" : "unknown-item";
}

export interface CS2InventoryStorageDrops {
    dropped: CS2InventoryDrop[];
    storageUid: number;
}

export function repairInventoryItem(
    economy: CS2EconomyInstance,
    item: CS2BaseInventoryItem,
    storageDrops?: CS2InventoryStorageDrops
): boolean {
    if (!economy.items.has(item.id)) {
        return false;
    }
    const economyItem = economy.getById(item.id);
    if (item.patches !== undefined) {
        if (!economyItem.hasPatches()) {
            item.patches = undefined;
        } else {
            repairSlots(item.patches, CS2_MAX_PATCHES);
            for (const [slot, patchId] of Object.entries(item.patches)) {
                if (!checkAttachmentId(economy, patchId, (patch) => patch.isPatch())) {
                    delete item.patches[slot];
                }
            }
        }
    }
    if (item.stickers !== undefined) {
        if (!economyItem.hasStickers()) {
            item.stickers = undefined;
        } else {
            const schemaCount = economyItem.getStickerSchemaCount();
            let rebuild = Object.keys(item.stickers).length > CS2_MAX_STICKERS;
            for (const [slot, sticker] of Object.entries(item.stickers)) {
                if (!checkAttachmentId(economy, sticker.id, (attachment) => attachment.isSticker())) {
                    delete item.stickers[slot];
                    rebuild = true;
                    continue;
                }
                if (!checkStickerSchema(sticker.schema, schemaCount)) {
                    rebuild = true;
                }
                sticker.wear = CS2_INVENTORY_RULES.stickerWear.repair(sticker.wear, economyItem);
                sticker.rotation = CS2_INVENTORY_RULES.stickerRotation.repair(sticker.rotation, economyItem);
                sticker.x = CS2_INVENTORY_RULES.stickerX.repair(sticker.x, economyItem);
                sticker.y = CS2_INVENTORY_RULES.stickerY.repair(sticker.y, economyItem);
            }
            if (rebuild) {
                item.stickers = CS2InventoryItem.stickersFromArray(
                    CS2InventoryItem.stickersToArray(item.stickers, schemaCount)
                );
            }
        }
    }
    if (item.keychains !== undefined) {
        if (!economyItem.hasKeychains()) {
            item.keychains = undefined;
        } else {
            repairSlots(item.keychains, CS2_MAX_KEYCHAINS);
            for (const [slot, keychain] of Object.entries(item.keychains)) {
                if (!checkAttachmentId(economy, keychain.id, (attachment) => attachment.isKeychain())) {
                    delete item.keychains[slot];
                    continue;
                }
                keychain.seed = CS2_INVENTORY_RULES.keychainSeed.repair(keychain.seed, economyItem);
                keychain.x = CS2_INVENTORY_RULES.keychainPositionX.repair(keychain.x, economyItem);
                keychain.y = CS2_INVENTORY_RULES.keychainPositionY.repair(keychain.y, economyItem);
                keychain.z = CS2_INVENTORY_RULES.keychainPositionZ.repair(keychain.z, economyItem);
            }
        }
    }
    if (item.storage !== undefined) {
        if (!economyItem.isStorageUnit()) {
            item.storage = undefined;
        } else {
            for (const [slot, stored] of Object.entries(item.storage)) {
                const uid = parseInt(slot, 10);
                stored.storage = undefined;
                if (economy.items.has(stored.id) && !isStorableInStorageUnit(stored, economy.getById(stored.id))) {
                    storageDrops?.dropped.push({
                        uid,
                        id: stored.id,
                        reason: "policy",
                        storageUid: storageDrops.storageUid
                    });
                    delete item.storage[uid];
                    continue;
                }
                if (!repairInventoryItem(economy, stored)) {
                    storageDrops?.dropped.push({
                        uid,
                        id: stored.id,
                        reason: getDropReason(economy, stored.id),
                        storageUid: storageDrops.storageUid
                    });
                    delete item.storage[uid];
                }
            }
            if (Object.keys(item.storage).length === 0) {
                item.storage = undefined;
            }
        }
    }
    item.nameTag = economy.trimNameTag(item.nameTag);
    if (!economy.safeRequireNameTag(item.nameTag, economyItem)) {
        item.nameTag = undefined;
    }
    item.seed = CS2_INVENTORY_RULES.itemSeed.repair(item.seed, economyItem);
    item.statTrak = CS2_INVENTORY_RULES.itemStatTrak.repair(item.statTrak, economyItem);
    item.charges = CS2_INVENTORY_RULES.itemCharges.repair(item.charges, economyItem);
    if (
        item.charges === undefined &&
        economyItem.isGraffiti() &&
        (item.equipped === true || item.equippedCT === true || item.equippedT === true)
    ) {
        item.charges = economyItem.getDefaultCharges();
    }
    item.wear = CS2_INVENTORY_RULES.itemWear.repair(item.wear, economyItem);
    return checkInventoryItem(economy, item);
}

function checkEmptyDefaultItem(economy: CS2EconomyInstance, item: CS2BaseInventoryItem): boolean {
    return (
        economy.items.has(item.id) &&
        economy.getById(item.id).isDefault === true &&
        item.nameTag === undefined &&
        item.charges === undefined &&
        Object.keys(item.stickers ?? {}).length === 0 &&
        Object.keys(item.keychains ?? {}).length === 0 &&
        Object.keys(item.patches ?? {}).length === 0
    );
}

function trimToMaximum(
    items: Record<number, CS2BaseInventoryItem>,
    maximum: number,
    dropped: CS2InventoryDrop[],
    storageUid?: number
): void {
    const uids = Object.keys(items)
        .map((key) => parseInt(key, 10))
        .sort((a, b) => a - b);
    for (const uid of uids.slice(maximum)) {
        const drop: CS2InventoryDrop = { uid, id: ensure(items[uid]).id, reason: "policy" };
        if (storageUid !== undefined) {
            drop.storageUid = storageUid;
        }
        dropped.push(drop);
        delete items[uid];
    }
}

export function reconcileInventoryItems(
    economy: CS2EconomyInstance,
    items: Record<number, CS2BaseInventoryItem>,
    options: Readonly<CS2InventoryOptions>
): CS2InventoryDrop[] {
    const dropped: CS2InventoryDrop[] = [];
    for (const [key, item] of Object.entries(items)) {
        if (item.storage === undefined) {
            continue;
        }
        const storageUid = parseInt(key, 10);
        for (const [slot, stored] of Object.entries(item.storage)) {
            if (!economy.items.has(stored.id)) {
                continue;
            }
            const economyItem = economy.getById(stored.id);
            if (!isStorableInStorageUnit(stored, economyItem)) {
                const uid = parseInt(slot, 10);
                dropped.push({ uid, id: stored.id, reason: "policy", storageUid });
                delete item.storage[uid];
            }
        }
        if (Object.keys(item.storage).length === 0) {
            item.storage = undefined;
        }
    }
    const detachments = Object.entries(items)
        .map(([key, value]) => [parseInt(key, 10), value] as const)
        .filter(([, { id }]) => economy.items.has(id) && economy.getById(id).isCharmDetachment())
        .sort(([a], [b]) => a - b);
    if (detachments.length > 1) {
        const [survivorUid, survivor] = ensure(detachments[0]);
        const economyItem = economy.getById(survivor.id);
        let charges = 0;
        for (const [uid, item] of detachments) {
            charges += item.charges ?? economyItem.getDefaultCharges();
            if (uid !== survivorUid) {
                delete items[uid];
            }
        }
        survivor.charges = Math.min(charges, economyItem.getMaximumCharges());
        survivor.updatedAt = getTimestamp();
    }
    if (options.dropEmptyDefaultItems === true) {
        for (const [key, item] of Object.entries(items)) {
            if (checkEmptyDefaultItem(economy, item)) {
                const uid = parseInt(key, 10);
                dropped.push({ uid, id: item.id, reason: "policy" });
                delete items[uid];
            }
        }
    }
    for (const [key, item] of Object.entries(items)) {
        if (item.storage !== undefined && Object.keys(item.storage).length > options.storageUnitMaxItems) {
            trimToMaximum(item.storage, options.storageUnitMaxItems, dropped, parseInt(key, 10));
        }
    }
    if (Object.keys(items).length > options.maxItems) {
        trimToMaximum(items, options.maxItems, dropped);
    }
    return dropped;
}
