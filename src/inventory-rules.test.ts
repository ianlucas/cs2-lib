/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, test } from "vitest";
import { CS2RarityColor } from "./economy-container.ts";
import { CS2ItemType } from "./economy-types.ts";
import { CS2Economy, CS2EconomyInstance } from "./economy.ts";
import {
    assertInventoryItem,
    getNextStickerSchema,
    repairInventoryItem,
    snapStickerRotation,
    validateStickerRotation
} from "./inventory-rules.ts";
import type { CS2BaseInventoryItem } from "./inventory-types.ts";
import { CS2_ITEMS } from "./items.ts";
import { english } from "./translations/english.ts";

const AK47_ID = 4;
const AWP_DRAGON_LORE_ID = 307;
const BLOODHOUND_ID = 8569;
const BROKEN_FANG_GLOVES_ID = 56;
const FALLEN_COLOGNE_2015_ID = 2226;
const KARAMBIT_BOREAL_FOREST_ID = 1334;
const LIL_AVA_ID = 13113;

CS2Economy.load({ items: CS2_ITEMS, language: english });

describe("sticker rotation", () => {
    test("validateStickerRotation accepts the half-degree grid within -180-180", () => {
        for (const rotation of [undefined, -180, -179.5, -0.5, 0, 0.5, 90, 90.5, 180]) {
            expect(validateStickerRotation(rotation)).toBe(true);
        }
        for (const rotation of [-180.5, 180.5, 200, 2.1, 2.6, 90.7, NaN, Infinity, -Infinity]) {
            expect(validateStickerRotation(rotation)).toBe(false);
        }
    });

    test("snapStickerRotation rounds to the nearest half degree", () => {
        expect(snapStickerRotation(2.4)).toBe(2.5);
        expect(snapStickerRotation(2.7)).toBe(2.5);
        expect(snapStickerRotation(-2.4)).toBe(-2.5);
        expect(snapStickerRotation(2.5)).toBe(2.5);
        expect(snapStickerRotation(90)).toBe(90);
    });
});

describe("repairInventoryItem offsets and positions", () => {
    // AWP | Dragon Lore is legacy, so it resolves to the legacy envelopes:
    // stickers X [-0.4323, 0.4206] Y [-0.0921, 0.1415]
    // keychains X [-10.1283, 41.2865] Y [-0.0176, 1.3716] Z [2.6437, 11.7576]
    test("clamps sticker offsets to the model bounds, truncates onto the grid and drops non-finite ones", () => {
        const item: CS2BaseInventoryItem = {
            id: AWP_DRAGON_LORE_ID,
            stickers: {
                0: { id: FALLEN_COLOGNE_2015_ID, x: 5, y: 0.05 },
                1: { id: FALLEN_COLOGNE_2015_ID, x: -5, y: -5 },
                2: { id: FALLEN_COLOGNE_2015_ID, x: 0.1, y: 0.12345 },
                3: { id: FALLEN_COLOGNE_2015_ID, x: NaN, y: Infinity }
            }
        };
        repairInventoryItem(CS2Economy, item);
        expect(item.stickers?.[0]).toMatchObject({ x: 0.4206, y: 0.05 });
        expect(item.stickers?.[1]).toMatchObject({ x: -0.4323, y: -0.0921 });
        expect(item.stickers?.[2]).toMatchObject({ x: 0.1, y: 0.1234 });
        expect(item.stickers?.[3]?.x).toBe(undefined);
        expect(item.stickers?.[3]?.y).toBe(undefined);
    });

    test("clamps keychain positions to the model bounds, truncates onto the grid and drops non-finite ones", () => {
        const item: CS2BaseInventoryItem = {
            id: AWP_DRAGON_LORE_ID,
            keychains: {
                0: { id: LIL_AVA_ID, x: 100, y: 100, z: 100 },
                1: { id: LIL_AVA_ID, x: -100, y: -100, z: -100 },
                // Raw in-game floats carry more precision than the grid; truncate, don't reject.
                2: { id: LIL_AVA_ID, x: 0.123456789, y: 0.2211, z: 3 },
                3: { id: LIL_AVA_ID, x: NaN, y: Infinity, z: -Infinity }
            }
        };
        repairInventoryItem(CS2Economy, item);
        expect(item.keychains?.[0]).toMatchObject({ x: 41.2865, y: 1.3716, z: 11.7576 });
        expect(item.keychains?.[1]).toMatchObject({ x: -10.1283, y: -0.0176, z: 2.6437 });
        expect(item.keychains?.[2]).toMatchObject({ x: 0.1234, y: 0.2211, z: 3 });
        expect(item.keychains?.[3]).toMatchObject({ x: undefined, y: undefined, z: undefined });
    });
});

describe("assertInventoryItem", () => {
    test("accepts attributes an item can hold, on its grid and inside its envelope", () => {
        const accepted: CS2BaseInventoryItem[] = [
            { id: KARAMBIT_BOREAL_FOREST_ID },
            { id: AK47_ID, stickers: { 0: { id: FALLEN_COLOGNE_2015_ID } } },
            { id: AWP_DRAGON_LORE_ID, stickers: { 0: { id: FALLEN_COLOGNE_2015_ID, rotation: 2.5, x: 0.4206 } } },
            { id: AWP_DRAGON_LORE_ID, keychains: { 0: { id: LIL_AVA_ID, x: 41.2865, y: 0.2211, z: 3 } } }
        ];
        for (const item of accepted) {
            expect(() => assertInventoryItem(CS2Economy, item)).not.toThrow();
        }
    });

    test("rejects attributes the item type cannot hold and values off the item's grid", () => {
        const rejected: CS2BaseInventoryItem[] = [
            // A knife holds neither stickers nor keychains.
            { id: KARAMBIT_BOREAL_FOREST_ID, stickers: { 0: { id: FALLEN_COLOGNE_2015_ID } } },
            { id: KARAMBIT_BOREAL_FOREST_ID, keychains: { 0: { id: LIL_AVA_ID } } },
            // Only an agent holds patches.
            { id: AK47_ID, patches: { 0: BLOODHOUND_ID } },
            // A base glove is not addable.
            { id: BROKEN_FANG_GLOVES_ID },
            // Off the half-degree rotation grid, and outside the model's offset envelope.
            { id: AWP_DRAGON_LORE_ID, stickers: { 0: { id: FALLEN_COLOGNE_2015_ID, rotation: 2.7 } } },
            { id: AWP_DRAGON_LORE_ID, stickers: { 0: { id: FALLEN_COLOGNE_2015_ID, x: 0.4207 } } }
        ];
        for (const item of rejected) {
            expect(() => assertInventoryItem(CS2Economy, item)).toThrow();
        }
    });

    test("accepts what repairInventoryItem produced", () => {
        // The pairing the rule table in group 3 makes structural: repair's output always satisfies
        // assert. Anything repair leaves behind that assert rejects is an unrepairable item.
        const item: CS2BaseInventoryItem = {
            id: AWP_DRAGON_LORE_ID,
            stickers: {
                0: { id: FALLEN_COLOGNE_2015_ID, x: 5, y: -5, rotation: 270, schema: 9 },
                1: { id: FALLEN_COLOGNE_2015_ID, x: NaN, rotation: 2.7 }
            },
            keychains: { 0: { id: LIL_AVA_ID, x: 100, y: 0.123456789, z: -100 } }
        };
        expect(() => assertInventoryItem(CS2Economy, item)).toThrow();
        repairInventoryItem(CS2Economy, item);
        expect(() => assertInventoryItem(CS2Economy, item)).not.toThrow();
    });
});

// Every item in the shipped catalog publishes a full envelope, so the unbounded and half-bounded
// branches are only reachable through a catalog that omits the markup — which is exactly what an
// `items.json` predating a new field looks like. The economy being an argument is what makes this
// testable at all.
describe("repairInventoryItem against a catalog without markup", () => {
    const UNBOUNDED_ID = 1;
    const HALF_BOUNDED_ID = 2;
    const STICKER_ID = 3;
    const KEYCHAIN_ID = 4;
    const rarityColor = CS2RarityColor.Common;
    const economy = new CS2EconomyInstance();
    economy.load({
        items: [
            { id: UNBOUNDED_ID, type: CS2ItemType.Weapon, rarityColor },
            {
                id: HALF_BOUNDED_ID,
                type: CS2ItemType.Weapon,
                rarityColor,
                stickerOffsetXMax: 1,
                keychainPositionXMin: -1
            },
            { id: STICKER_ID, type: CS2ItemType.Sticker, rarityColor },
            { id: KEYCHAIN_ID, type: CS2ItemType.Keychain, rarityColor }
        ]
    });

    test("truncates onto the grid but does not clamp when the model publishes no bounds", () => {
        const item: CS2BaseInventoryItem = {
            id: UNBOUNDED_ID,
            stickers: { 0: { id: STICKER_ID, x: 5, y: NaN } },
            keychains: { 0: { id: KEYCHAIN_ID, x: 0.2211, y: 0.123456789, z: Infinity } }
        };
        repairInventoryItem(economy, item);
        expect(item.stickers?.[0]).toMatchObject({ x: 5, y: undefined });
        expect(item.keychains?.[0]).toMatchObject({ x: 0.2211, y: 0.1234, z: undefined });
    });

    test("clamps only on the side the model publishes", () => {
        const item: CS2BaseInventoryItem = {
            id: HALF_BOUNDED_ID,
            stickers: { 0: { id: STICKER_ID, x: 5 }, 1: { id: STICKER_ID, x: -5 } },
            keychains: { 0: { id: KEYCHAIN_ID, x: -5 }, 1: { id: KEYCHAIN_ID, x: 5 } }
        };
        repairInventoryItem(economy, item);
        // Sticker X publishes a max only: the high side clamps, the low side passes through.
        expect(item.stickers?.[0]?.x).toBe(1);
        expect(item.stickers?.[1]?.x).toBe(-5);
        // Keychain X publishes a min only: the low side clamps, the high side passes through.
        expect(item.keychains?.[0]?.x).toBe(-1);
        expect(item.keychains?.[1]?.x).toBe(5);
    });
});

describe("sticker schema", () => {
    test("getNextStickerSchema returns the first free anchor, falling back to 0 when full", () => {
        expect(getNextStickerSchema([], 4)).toBe(0);
        expect(
            getNextStickerSchema(
                [
                    { id: FALLEN_COLOGNE_2015_ID, schema: 0 },
                    { id: FALLEN_COLOGNE_2015_ID, schema: 1 }
                ],
                4
            )
        ).toBe(2);
        expect(
            getNextStickerSchema(
                [0, 1, 2, 3].map((schema) => ({ id: FALLEN_COLOGNE_2015_ID, schema })),
                4
            )
        ).toBe(0);
    });
});
