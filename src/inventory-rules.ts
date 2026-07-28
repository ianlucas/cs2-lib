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
import type { CS2BaseInventoryItem } from "./inventory-types.ts";
import { CS2InventoryItem } from "./inventory.ts";
import { type RecordValue, assert, clamp, isFactorPrecise, truncateToFactor } from "./utils.ts";

function repairOffset(
    value: number | undefined,
    min: number | undefined,
    max: number | undefined,
    factor: number
): number | undefined {
    if (value === undefined || !Number.isFinite(value)) {
        return undefined;
    }
    value = truncateToFactor(value, factor);
    if (min !== undefined && value < min) {
        return min;
    }
    if (max !== undefined && value > max) {
        return max;
    }
    return value;
}

function repairStickerOffset(
    value: number | undefined,
    min: number | undefined,
    max: number | undefined
): number | undefined {
    return repairOffset(value, min, max, CS2_STICKER_OFFSET_FACTOR);
}

function repairKeychainPosition(
    value: number | undefined,
    min: number | undefined,
    max: number | undefined
): number | undefined {
    return repairOffset(value, min, max, CS2_KEYCHAIN_POSITION_FACTOR);
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

export function assertAddable(item: CS2EconomyItem): void {
    if (item.isGloves()) {
        assert(item.isDefault || !item.isBase);
    }
}

export function assertStickers(
    economy: CS2EconomyInstance,
    stickers?: CS2BaseInventoryItem["stickers"],
    item?: CS2EconomyItem
): void {
    if (stickers === undefined) {
        return;
    }
    const entries = Object.values(stickers);
    assert(entries.length <= CS2_MAX_STICKERS);
    assert(item === undefined || item.hasStickers());
    for (const { id: stickerId, wear, rotation, x, y, schema } of entries) {
        economy.getById(stickerId).expectSticker();
        if (wear !== undefined) {
            assert(isFactorPrecise(wear, CS2_STICKER_WEAR_FACTOR));
            assert(wear >= CS2_MIN_STICKER_WEAR && wear <= CS2_MAX_STICKER_WEAR);
        }
        if (rotation !== undefined) {
            assert(validateStickerRotation(rotation));
        }
        if (x !== undefined) {
            assert(isFactorPrecise(x, CS2_STICKER_OFFSET_FACTOR));
            if (item !== undefined) {
                const min = item.getMinimumStickerOffsetX();
                const max = item.getMaximumStickerOffsetX();
                assert(min === undefined || x >= min);
                assert(max === undefined || x <= max);
            }
        }
        if (y !== undefined) {
            assert(isFactorPrecise(y, CS2_STICKER_OFFSET_FACTOR));
            if (item !== undefined) {
                const min = item.getMinimumStickerOffsetY();
                const max = item.getMaximumStickerOffsetY();
                assert(min === undefined || y >= min);
                assert(max === undefined || y <= max);
            }
        }
        if (schema !== undefined) {
            assert(Number.isInteger(schema));
            assert(schema >= 0 && schema < (item?.getStickerSchemaCount() ?? CS2_MAX_STICKERS));
        }
    }
}

export function assertKeychains(
    economy: CS2EconomyInstance,
    keychains?: CS2BaseInventoryItem["keychains"],
    item?: CS2EconomyItem
): void {
    if (keychains === undefined) {
        return;
    }
    const entries = Object.entries(keychains);
    assert(entries.length <= CS2_MAX_KEYCHAINS);
    assert(item === undefined || item.hasKeychains());
    for (const [key, { id: keychainId, seed, x, y, z }] of entries) {
        const slot = parseInt(key, 10);
        assert(slot >= 0 && slot <= CS2_MAX_KEYCHAINS - 1);
        economy.getById(keychainId).expectKeychain();
        if (seed !== undefined) {
            assert(Number.isFinite(seed));
            assert(Number.isInteger(seed));
            assert(seed >= CS2_MIN_KEYCHAIN_SEED && seed <= CS2_MAX_KEYCHAIN_SEED);
        }
        if (x !== undefined) {
            assert(Number.isFinite(x));
            assert(isFactorPrecise(x, CS2_KEYCHAIN_POSITION_FACTOR));
            if (item !== undefined) {
                const min = item.getMinimumKeychainPositionX();
                const max = item.getMaximumKeychainPositionX();
                assert(min === undefined || x >= min);
                assert(max === undefined || x <= max);
            }
        }
        if (y !== undefined) {
            assert(Number.isFinite(y));
            assert(isFactorPrecise(y, CS2_KEYCHAIN_POSITION_FACTOR));
            if (item !== undefined) {
                const min = item.getMinimumKeychainPositionY();
                const max = item.getMaximumKeychainPositionY();
                assert(min === undefined || y >= min);
                assert(max === undefined || y <= max);
            }
        }
        if (z !== undefined) {
            assert(Number.isFinite(z));
            assert(isFactorPrecise(z, CS2_KEYCHAIN_POSITION_FACTOR));
            if (item !== undefined) {
                const min = item.getMinimumKeychainPositionZ();
                const max = item.getMaximumKeychainPositionZ();
                assert(min === undefined || z >= min);
                assert(max === undefined || z <= max);
            }
        }
    }
}

export function assertPatches(
    economy: CS2EconomyInstance,
    patches?: CS2BaseInventoryItem["patches"],
    item?: CS2EconomyItem
): void {
    if (patches === undefined) {
        return;
    }
    assert(item === undefined || item.isAgent());
    for (const [key, patchId] of Object.entries(patches)) {
        const slot = parseInt(key, 10);
        assert(slot >= 0 && slot <= CS2_MAX_PATCHES - 1);
        assert(patchId === undefined || economy.getById(patchId).isPatch());
    }
}

export function assertInventoryItem(
    economy: CS2EconomyInstance,
    { charges, id, keychains, nameTag, patches, seed, statTrak, stickers, wear }: CS2BaseInventoryItem
): void {
    const item = economy.getById(id);
    economy.validateWear(wear, item);
    economy.validateSeed(seed, item);
    economy.validateNameTag(nameTag, item);
    economy.validateStatTrak(statTrak, item);
    economy.validateCharges(charges, item);
    assertAddable(item);
    assertPatches(economy, patches, item);
    assertStickers(economy, stickers, item);
    assertKeychains(economy, keychains, item);
}

export function repairInventoryItem(economy: CS2EconomyInstance, item: CS2BaseInventoryItem): void {
    if (!economy.items.has(item.id)) {
        return;
    }
    const economyItem = economy.getById(item.id);
    if (item.patches !== undefined) {
        if (!economyItem.hasPatches()) {
            item.patches = undefined;
        } else {
            for (const [slot, patchId] of Object.entries(item.patches)) {
                if (!economy.items.has(patchId)) {
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
                if (!economy.items.has(sticker.id)) {
                    delete item.stickers[slot];
                    continue;
                }
                if (sticker.rotation !== undefined) {
                    let rotation = snapStickerRotation(sticker.rotation);
                    if (rotation > CS2_MAX_STICKER_ROTATION) {
                        rotation -= 360;
                    }
                    sticker.rotation = validateStickerRotation(rotation) ? rotation : undefined;
                }
                sticker.x = repairStickerOffset(
                    sticker.x,
                    economyItem.getMinimumStickerOffsetX(),
                    economyItem.getMaximumStickerOffsetX()
                );
                sticker.y = repairStickerOffset(
                    sticker.y,
                    economyItem.getMinimumStickerOffsetY(),
                    economyItem.getMaximumStickerOffsetY()
                );
            }
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
                if (!economy.items.has(keychain.id)) {
                    delete item.keychains[slot];
                    continue;
                }
                keychain.x = repairKeychainPosition(
                    keychain.x,
                    economyItem.getMinimumKeychainPositionX(),
                    economyItem.getMaximumKeychainPositionX()
                );
                keychain.y = repairKeychainPosition(
                    keychain.y,
                    economyItem.getMinimumKeychainPositionY(),
                    economyItem.getMaximumKeychainPositionY()
                );
                keychain.z = repairKeychainPosition(
                    keychain.z,
                    economyItem.getMinimumKeychainPositionZ(),
                    economyItem.getMaximumKeychainPositionZ()
                );
            }
        }
    }
    if (!economyItem.hasCharges()) {
        item.charges = undefined;
    } else if (item.charges !== undefined) {
        item.charges = Number.isFinite(item.charges)
            ? clamp(Math.trunc(item.charges), CS2_MIN_CHARGES, economyItem.getMaximumCharges())
            : undefined;
    } else if (
        economyItem.isGraffiti() &&
        (item.equipped === true || item.equippedCT === true || item.equippedT === true)
    ) {
        item.charges = economyItem.getDefaultCharges();
    }
    if (item.wear !== undefined) {
        if (!economyItem.hasWear()) {
            item.wear = undefined;
        } else {
            item.wear = clamp(item.wear, economyItem.getMinimumWear(), economyItem.getMaximumWear());
            if (!economy.safeValidateWear(item.wear, economyItem)) {
                item.wear = undefined;
            }
        }
    }
}
