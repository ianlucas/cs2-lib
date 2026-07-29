/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    CS2_KEYCHAIN_POSITION_FACTOR,
    CS2_MAX_KEYCHAINS,
    CS2_MAX_KEYCHAIN_SEED,
    CS2_MAX_PATCHES,
    CS2_MAX_STICKERS,
    CS2_MAX_STICKER_ROTATION,
    CS2_MAX_STICKER_WEAR,
    CS2_MIN_CHARGES,
    CS2_MIN_KEYCHAIN_SEED,
    CS2_MIN_STICKER_ROTATION,
    CS2_MIN_STICKER_WEAR,
    CS2_STICKER_OFFSET_FACTOR,
    CS2_STICKER_ROTATION_STEP,
    CS2_STICKER_WEAR_FACTOR
} from "./economy-constants.ts";
import type { CS2EconomyInstance, CS2EconomyItem } from "./economy.ts";
import type { CS2InventoryDrop } from "./inventory-format.ts";
import type { CS2BaseInventoryItem, CS2InventoryOptions } from "./inventory-types.ts";
import { CS2InventoryItem, getTimestamp } from "./inventory.ts";
import { type RecordValue, assert, clamp, ensure, isFactorPrecise, truncateToFactor } from "./utils.ts";

/**
 * One constrained attribute, written once and read two ways: `check` is what an `assert*` asserts,
 * `repair` is the coercion `repairInventoryItem` applies. Every rule holds `check(repair(value))`,
 * which is what lets repair and assert never drift apart.
 */
export interface CS2InventoryRule<T> {
    check(value: T | undefined, item: CS2EconomyItem): boolean;
    repair(value: T | undefined, item: CS2EconomyItem): T | undefined;
}

type CS2EconomyItemBound = (item: CS2EconomyItem) => number | undefined;

// A numeric attribute quantized to a factor's grid and bounded by the catalog — the shape most of
// the table has. A bound the catalog omits is unbounded on that side, not zero.
function boundedRule(
    factor: number,
    getMinimum: CS2EconomyItemBound,
    getMaximum: CS2EconomyItemBound
): CS2InventoryRule<number> {
    return {
        check(value, item) {
            if (value === undefined) {
                return true;
            }
            const min = getMinimum(item);
            const max = getMaximum(item);
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
            const min = getMinimum(item);
            const max = getMaximum(item);
            const truncated = truncateToFactor(value, factor);
            return clamp(truncated, min ?? truncated, max ?? truncated);
        }
    };
}

type CS2EconomyItemRange = (item: CS2EconomyItem) => number;

// A counted attribute: whole numbers inside a range the catalog always publishes.
function wholeNumberRule(getMinimum: CS2EconomyItemRange, getMaximum: CS2EconomyItemRange): CS2InventoryRule<number> {
    return {
        check(value, item) {
            return (
                value === undefined ||
                (Number.isInteger(value) && value >= getMinimum(item) && value <= getMaximum(item))
            );
        },
        repair(value, item) {
            return value !== undefined && Number.isFinite(value)
                ? clamp(Math.trunc(value), getMinimum(item), getMaximum(item))
                : undefined;
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

// The only rule the item plays no part in: the grid and the range are the game's, not the model's.
// The 0-359 encoding it used to convert is `inventory-migrations/v2.ts`, so what is left here is the
// constraint and nothing else — no reading of a value on which `check` and `repair` disagree.
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

/**
 * Every attribute the catalog constrains, each written once. `check*` and `assert*` read the `check`
 * side, `repairInventoryItem` reads the `repair` side, and `src/inventory-rules.test.ts` holds them
 * together with `check(repair(value))`.
 */
export const CS2_INVENTORY_RULES: Record<CS2InventoryRuleName, CS2InventoryRule<number>> = {
    itemCharges: {
        check: (charges, item) => item.economy.safeValidateCharges(charges, item),
        repair(charges, item) {
            return charges !== undefined && item.hasCharges() && Number.isFinite(charges)
                ? clamp(Math.trunc(charges), CS2_MIN_CHARGES, item.getMaximumCharges())
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
    keychainPositionX: boundedRule(
        CS2_KEYCHAIN_POSITION_FACTOR,
        (item) => item.getMinimumKeychainPositionX(),
        (item) => item.getMaximumKeychainPositionX()
    ),
    keychainPositionY: boundedRule(
        CS2_KEYCHAIN_POSITION_FACTOR,
        (item) => item.getMinimumKeychainPositionY(),
        (item) => item.getMaximumKeychainPositionY()
    ),
    keychainPositionZ: boundedRule(
        CS2_KEYCHAIN_POSITION_FACTOR,
        (item) => item.getMinimumKeychainPositionZ(),
        (item) => item.getMaximumKeychainPositionZ()
    ),
    keychainSeed: wholeNumberRule(
        () => CS2_MIN_KEYCHAIN_SEED,
        () => CS2_MAX_KEYCHAIN_SEED
    ),
    stickerRotation: stickerRotationRule,
    // Which anchor a sticker sits on is the one attribute a value on its own cannot settle: picking
    // a free one needs the item's other stickers. So `repair` only drops what the model cannot
    // render, and `stickersToArray` — which sees them all — assigns the replacement.
    stickerSchema: {
        check: (schema, item) => checkStickerSchema(schema, item.getStickerSchemaCount()),
        repair: (schema, item) => (checkStickerSchema(schema, item.getStickerSchemaCount()) ? schema : undefined)
    },
    stickerWear: boundedRule(
        CS2_STICKER_WEAR_FACTOR,
        () => CS2_MIN_STICKER_WEAR,
        () => CS2_MAX_STICKER_WEAR
    ),
    stickerX: boundedRule(
        CS2_STICKER_OFFSET_FACTOR,
        (item) => item.getMinimumStickerOffsetX(),
        (item) => item.getMaximumStickerOffsetX()
    ),
    stickerY: boundedRule(
        CS2_STICKER_OFFSET_FACTOR,
        (item) => item.getMinimumStickerOffsetY(),
        (item) => item.getMaximumStickerOffsetY()
    )
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

/**
 * A default item is one the game issues rather than one you acquired, so applying it as a sticker,
 * keychain or patch is claiming an attachment nobody owns. Stated over `isDefault` rather than over
 * the one id that has it today, so a second free charm needs no second rule.
 */
export function checkAttachable(item: CS2EconomyItem): boolean {
    return item.isDefault !== true;
}

// The two ways a slot stops holding something the owner acquired: a catalog update took the id
// away, or the id resolves to an item the game issues for free.
function checkAttachmentId(economy: CS2EconomyInstance, id: number): boolean {
    return economy.items.has(id) && checkAttachable(economy.getById(id));
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

export function checkInventoryItem(
    economy: CS2EconomyInstance,
    { charges, id, keychains, nameTag, patches, seed, statTrak, stickers, wear }: CS2BaseInventoryItem
): boolean {
    if (!economy.items.has(id)) {
        return false;
    }
    const item = economy.getById(id);
    return (
        CS2_INVENTORY_RULES.itemWear.check(wear, item) &&
        CS2_INVENTORY_RULES.itemCharges.check(charges, item) &&
        economy.safeValidateSeed(seed, item) &&
        economy.safeValidateNameTag(nameTag, item) &&
        economy.safeValidateStatTrak(statTrak, item) &&
        checkAddable(item) &&
        checkPatches(economy, patches, item) &&
        checkStickers(economy, stickers, item) &&
        checkKeychains(economy, keychains, item)
    );
}

export function assertInventoryItem(economy: CS2EconomyInstance, item: CS2BaseInventoryItem): void {
    assert(checkInventoryItem(economy, item));
}

/**
 * Coerces every attribute the catalog constrains, then reports whether what is left is an item
 * `checkInventoryItem` accepts. A `false` return is the signal to drop the item: either its id has
 * left the catalog, or a rule rejects a value no coercion reaches.
 */
export function repairInventoryItem(economy: CS2EconomyInstance, item: CS2BaseInventoryItem): boolean {
    if (!economy.items.has(item.id)) {
        return false;
    }
    const economyItem = economy.getById(item.id);
    if (item.patches !== undefined) {
        if (!economyItem.hasPatches()) {
            item.patches = undefined;
        } else {
            for (const [slot, patchId] of Object.entries(item.patches)) {
                if (!checkAttachmentId(economy, patchId)) {
                    delete item.patches[slot];
                }
            }
        }
    }
    if (item.stickers !== undefined) {
        if (!economyItem.hasStickers()) {
            item.stickers = undefined;
        } else {
            for (const [slot, sticker] of Object.entries(item.stickers)) {
                if (!checkAttachmentId(economy, sticker.id)) {
                    delete item.stickers[slot];
                    continue;
                }
                sticker.wear = CS2_INVENTORY_RULES.stickerWear.repair(sticker.wear, economyItem);
                sticker.rotation = CS2_INVENTORY_RULES.stickerRotation.repair(sticker.rotation, economyItem);
                sticker.x = CS2_INVENTORY_RULES.stickerX.repair(sticker.x, economyItem);
                sticker.y = CS2_INVENTORY_RULES.stickerY.repair(sticker.y, economyItem);
            }
            // Drops the schemas the model cannot render and hands out free ones in their place.
            item.stickers = CS2InventoryItem.stickersFromArray(
                CS2InventoryItem.stickersToArray(item.stickers, economyItem.getStickerSchemaCount())
            );
        }
    }
    if (item.keychains !== undefined) {
        if (!economyItem.hasKeychains()) {
            item.keychains = undefined;
        } else {
            for (const [slot, keychain] of Object.entries(item.keychains)) {
                if (!checkAttachmentId(economy, keychain.id)) {
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
    item.charges = CS2_INVENTORY_RULES.itemCharges.repair(item.charges, economyItem);
    // Generous on purpose: an equipped graffiti with no charges left is handed the default set
    // rather than unequipped, which is the policy `equip()` already assumes.
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

/**
 * A default item the game issues carrying nothing that distinguishes it from the one the game would
 * issue again. `charges` is in the list because `Tool | Charm Detachments` is itself a default item,
 * so leaving it out would spend a stack the owner earned.
 */
function checkEmptyDefaultItem(economy: CS2EconomyInstance, item: CS2BaseInventoryItem): boolean {
    return (
        economy.items.has(item.id) &&
        economy.getById(item.id).isDefault === true &&
        item.nameTag === undefined &&
        item.charges === undefined &&
        Object.keys(item.stickers ?? {}).length === 0 &&
        Object.keys(item.keychains ?? {}).length === 0
    );
}

/**
 * The invariants no single-item repair can see, because holding one item is not enough to know
 * whether it holds: an inventory carries at most one charm detachment stack, and a stored item
 * carries no charges. Returns what it took away, which is only ever the policy pass — merging a
 * stack keeps every charge, so no data leaves with it.
 */
export function reconcileInventoryItems(
    economy: CS2EconomyInstance,
    items: Record<number, CS2BaseInventoryItem>,
    options: Readonly<CS2InventoryOptions>
): CS2InventoryDrop[] {
    for (const item of Object.values(items)) {
        if (item.storage === undefined) {
            continue;
        }
        for (const [slot, stored] of Object.entries(item.storage)) {
            if (!economy.items.has(stored.id)) {
                continue;
            }
            const economyItem = economy.getById(stored.id);
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
    const dropped: CS2InventoryDrop[] = [];
    // Last, so that a stack merged a moment ago is judged on the charges it now holds rather than
    // on the empty rows it was spread across.
    if (options.dropEmptyDefaultItems === true) {
        for (const [key, item] of Object.entries(items)) {
            if (checkEmptyDefaultItem(economy, item)) {
                const uid = parseInt(key, 10);
                dropped.push({ uid, id: item.id, reason: "policy" });
                delete items[uid];
            }
        }
    }
    return dropped;
}
