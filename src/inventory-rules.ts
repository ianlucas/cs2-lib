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
import type { CS2EconomyInstance, CS2EconomyItem } from "./economy.ts";
import type { CS2InventoryDrop, CS2InventoryDropReason } from "./inventory-format.ts";
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

// The three ways a slot stops holding something the owner acquired: a catalog update took the id
// away, the id resolves to an item the game issues for free, or it resolves to an item of a kind
// the slot was never able to hold.
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

/**
 * The only item that holds other items, and it holds them one level deep: a unit inside a unit is
 * something the game cannot produce and nothing here could bound. Everything stored is read by the
 * same rules a loose item is read by, so a stored item is never the one thing nobody checked.
 */
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
        if (stored.storage !== undefined || !checkInventoryItem(economy, stored)) {
            return false;
        }
    }
    return true;
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
        economy.safeValidateNameTag(nameTag, item) &&
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

// An attachment is stored against the slot it sits in, so counting is not enough to know a record
// is holdable: a slot the model does not have is as wrong as one attachment too many, and two keys
// can name the same slot. Lowest slot wins, the way `stickersToArray` keeps the first stickers.
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

/**
 * The two ways an item fails to survive repair, which a report reads differently: a catalog update
 * took the item away, or a rule rejects a value no coercion reaches — a gap in the rule table.
 */
export function getDropReason(economy: CS2EconomyInstance, id: number): CS2InventoryDropReason {
    return economy.items.has(id) ? "unrepairable" : "unknown-item";
}

/**
 * Where a repair records what it had to take out of a storage unit. The unit's own uid comes from
 * the caller: a repair is handed one item, so it can name the slot a stored item sat in but not the
 * unit holding it.
 */
export interface CS2InventoryStorageDrops {
    dropped: CS2InventoryDrop[];
    storageUid: number;
}

/**
 * Coerces every attribute the catalog constrains, then reports whether what is left is an item
 * `checkInventoryItem` accepts. A `false` return is the signal to drop the item: either its id has
 * left the catalog, or a rule rejects a value no coercion reaches.
 */
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
            // Rebuilding drops the schemas the model cannot render, hands out free ones in their
            // place, and reindexes the slots a deletion left holes in — so it runs only when one of
            // those happened. Doing it every time writes an anchor into stickers that never carried
            // one, which is canonicalisation rather than repair, and the report would then name
            // every inventory holding a sticker as one the load had to change.
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
                // Unnested before it is read, so that a unit someone wrote inside a unit costs its
                // contents rather than the unit it was stored in.
                stored.storage = undefined;
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
            // The unit stays: it is a tool the owner paid for and named, and losing what was inside
            // it is not a reason to lose it too. An empty one holds nothing rather than an empty
            // record, which is the invariant `retrieveFromStorageUnit` keeps.
            if (Object.keys(item.storage).length === 0) {
                item.storage = undefined;
            }
        }
    }
    // The one attribute with no coercion behind it: a name the pattern rejects cannot be corrected
    // into the name the owner meant, and inventing one is worse than leaving the item unnamed.
    if (!economy.safeValidateNameTag(item.nameTag, economyItem)) {
        item.nameTag = undefined;
    }
    item.seed = CS2_INVENTORY_RULES.itemSeed.repair(item.seed, economyItem);
    item.statTrak = CS2_INVENTORY_RULES.itemStatTrak.repair(item.statTrak, economyItem);
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
 * carries no charges. Returns what it took away — merging a stack keeps every charge, so nothing
 * leaves with it, but a stack wiped out of a unit is charges the owner had and no longer has.
 */
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
            if (economyItem.isCharmDetachment() || economyItem.isCharmDetachmentPack()) {
                const uid = parseInt(slot, 10);
                dropped.push({ uid, id: stored.id, reason: "policy", storageUid });
                delete item.storage[uid];
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
