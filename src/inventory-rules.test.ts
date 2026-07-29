/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, test } from "vitest";
import {
    CS2_MAX_GRAFFITI_CHARGES,
    CS2_MAX_KEYCHAIN_SEED,
    CS2_MAX_SEED,
    CS2_MAX_STATTRAK,
    CS2_MAX_STICKER_WEAR,
    CS2_MIN_KEYCHAIN_SEED,
    CS2_MIN_SEED,
    CS2_MIN_STATTRAK,
    CS2_MIN_STICKER_WEAR
} from "./economy-constants.ts";
import { CS2RarityColor } from "./economy-container.ts";
import { CS2ItemType } from "./economy-types.ts";
import { CS2Economy, CS2EconomyInstance } from "./economy.ts";
import type { CS2InventoryDrop } from "./inventory-format.ts";
import {
    CS2_INVENTORY_RULES,
    assertInventoryItem,
    checkAddable,
    checkInventoryItem,
    getNextStickerSchema,
    reconcileInventoryItems,
    repairInventoryItem,
    snapStickerRotation,
    validateStickerRotation
} from "./inventory-rules.ts";
import type { CS2BaseInventoryItem } from "./inventory-types.ts";
import { CS2_ITEMS } from "./items.ts";
import { english } from "./translations/english.ts";
import { ensure } from "./utils.ts";

const AK47_ID = 4;
const AWP_DRAGON_LORE_ID = 307;
const BLOODHOUND_ID = 8569;
const BROKEN_FANG_GLOVES_ID = 56;
const CHARM_DETACHMENT_ID = 12450;
const CHARM_DETACHMENT_PACK_ID = 12451;
const FALLEN_COLOGNE_2015_ID = 2226;
const GRAFFITI_ACE_ID = 9543;
const GROUND_REBEL_ID = 8620;
const KARAMBIT_BOREAL_FOREST_ID = 1334;
const LIL_AVA_ID = 13113;
const STORAGE_UNIT_ID = 11262;
const UNKNOWN_ID = 999999;

const noPolicy = { maxItems: 256, storageUnitMaxItems: 32 };

CS2Economy.load({ items: CS2_ITEMS, language: english });

// Every item in the shipped catalog publishes a full envelope, so the unbounded and half-bounded
// branches are only reachable through a catalog that omits the markup — which is exactly what an
// `items.json` predating a new field looks like. The economy being an argument is what makes this
// testable at all.
const UNBOUNDED_ID = 1;
const HALF_BOUNDED_ID = 2;
const STICKER_ID = 3;
const KEYCHAIN_ID = 4;
const unmarkedEconomy = new CS2EconomyInstance();
unmarkedEconomy.load({
    items: [
        { id: UNBOUNDED_ID, type: CS2ItemType.Weapon, rarityColor: CS2RarityColor.Common },
        {
            id: HALF_BOUNDED_ID,
            type: CS2ItemType.Weapon,
            rarityColor: CS2RarityColor.Common,
            stickerOffsetXMax: 1,
            keychainPositionXMin: -1
        },
        { id: STICKER_ID, type: CS2ItemType.Sticker, rarityColor: CS2RarityColor.Common },
        { id: KEYCHAIN_ID, type: CS2ItemType.Keychain, rarityColor: CS2RarityColor.Common }
    ]
});

// The shipped catalog marks exactly one attachment `isDefault` — `Charm | Sticker Slab`, which the
// game hands out — so a sticker and a patch of the same kind only exist in a catalog written here.
const DEFAULT_KEYCHAIN_ID = 15200;
const AGENT_ID = 5;
const DEFAULT_STICKER_ID = 6;
const DEFAULT_PATCH_ID = 7;
const PATCH_ID = 8;
const defaultAttachmentEconomy = new CS2EconomyInstance();
defaultAttachmentEconomy.load({
    items: [
        { id: UNBOUNDED_ID, type: CS2ItemType.Weapon, rarityColor: CS2RarityColor.Common },
        { id: STICKER_ID, type: CS2ItemType.Sticker, rarityColor: CS2RarityColor.Common },
        { id: AGENT_ID, type: CS2ItemType.Agent, rarityColor: CS2RarityColor.Common },
        { id: DEFAULT_STICKER_ID, type: CS2ItemType.Sticker, rarityColor: CS2RarityColor.Common, isDefault: true },
        { id: DEFAULT_PATCH_ID, type: CS2ItemType.Patch, rarityColor: CS2RarityColor.Common, isDefault: true },
        { id: PATCH_ID, type: CS2ItemType.Patch, rarityColor: CS2RarityColor.Common }
    ]
});

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

    test("repair snaps onto the grid and drops what is off it, with no legacy angle to convert", () => {
        // The 0-359 encoding is version 2's rung now, so 270 reaching a rule is an angle out of
        // range rather than an old one: `check` and `repair` agree on it, which is the whole point.
        const item = CS2Economy.getById(AWP_DRAGON_LORE_ID);
        const cases: [rotation: number | undefined, expected: number | undefined][] = [
            [2.4, 2.5],
            [2.7, 2.5],
            [-2.4, -2.5],
            [180, 180],
            [-180, -180],
            [270, undefined],
            [270.7, undefined],
            [359.5, undefined],
            [-300, undefined],
            [NaN, undefined],
            [undefined, undefined]
        ];
        for (const [rotation, expected] of cases) {
            expect(CS2_INVENTORY_RULES.stickerRotation.repair(rotation, item), `repairing ${rotation}`).toBe(expected);
        }
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

    test("truncates sticker wear onto the grid, clamps it into range and drops non-finite ones", () => {
        const item: CS2BaseInventoryItem = {
            id: AWP_DRAGON_LORE_ID,
            stickers: {
                0: { id: FALLEN_COLOGNE_2015_ID, wear: 0.123456 },
                1: { id: FALLEN_COLOGNE_2015_ID, wear: 5 },
                2: { id: FALLEN_COLOGNE_2015_ID, wear: -5 },
                3: { id: FALLEN_COLOGNE_2015_ID, wear: NaN }
            }
        };
        expect(repairInventoryItem(CS2Economy, item)).toBe(true);
        expect(item.stickers?.[0]?.wear).toBe(0.12);
        expect(item.stickers?.[1]?.wear).toBe(CS2_MAX_STICKER_WEAR);
        // Clamping downwards lands on CS2_MIN_STICKER_WEAR. An unscraped sticker is written with no
        // wear at all rather than with zero, but that is `stickersFromArray`'s spelling of the same
        // value, and repair has no reason to rewrite a sticker to say it.
        expect(item.stickers?.[2]?.wear).toBe(CS2_MIN_STICKER_WEAR);
        expect(item.stickers?.[3]?.wear).toBe(undefined);
    });

    test("clamps keychain positions to the model bounds, truncates onto the grid and drops non-finite ones", () => {
        // Only one keychain slot exists, so each case needs its own item.
        const cases: [position: [number, number, number], expected: Record<string, number | undefined>][] = [
            [[100, 100, 100], { x: 41.2865, y: 1.3716, z: 11.7576 }],
            [[-100, -100, -100], { x: -10.1283, y: -0.0176, z: 2.6437 }],
            // Raw in-game floats carry more precision than the grid; truncate, don't reject.
            [[0.123456789, 0.2211, 3], { x: 0.1234, y: 0.2211, z: 3 }],
            [[NaN, Infinity, -Infinity], { x: undefined, y: undefined, z: undefined }]
        ];
        for (const [[x, y, z], expected] of cases) {
            const item: CS2BaseInventoryItem = {
                id: AWP_DRAGON_LORE_ID,
                keychains: { 0: { id: LIL_AVA_ID, x, y, z } }
            };
            repairInventoryItem(CS2Economy, item);
            expect(item.keychains?.[0]).toMatchObject(expected);
        }
    });
});

describe("repairInventoryItem attributes with no model bounds", () => {
    test("truncates keychain seeds to whole numbers, clamps them into range and drops non-finite ones", () => {
        // Only one keychain slot exists, so each case needs its own item.
        const cases: [seed: number, expected: number | undefined][] = [
            [1.9, 1],
            [0, CS2_MIN_KEYCHAIN_SEED],
            [1e9, CS2_MAX_KEYCHAIN_SEED],
            [NaN, undefined]
        ];
        for (const [seed, expected] of cases) {
            const item: CS2BaseInventoryItem = {
                id: AWP_DRAGON_LORE_ID,
                keychains: { 0: { id: LIL_AVA_ID, seed } }
            };
            expect(repairInventoryItem(CS2Economy, item)).toBe(true);
            expect(item.keychains?.[0]?.seed).toBe(expected);
        }
    });

    test("clamps the item's own seed into its range, and strips one from an item that has no pattern", () => {
        const cases: [item: CS2BaseInventoryItem, expected: number | undefined][] = [
            [{ id: AWP_DRAGON_LORE_ID, seed: 99999 }, CS2_MAX_SEED],
            [{ id: AWP_DRAGON_LORE_ID, seed: 0 }, CS2_MIN_SEED],
            [{ id: AWP_DRAGON_LORE_ID, seed: 5.9 }, 5],
            [{ id: AWP_DRAGON_LORE_ID, seed: NaN }, undefined],
            [{ id: STORAGE_UNIT_ID, seed: 5 }, undefined]
        ];
        for (const [item, expected] of cases) {
            expect(repairInventoryItem(CS2Economy, item)).toBe(true);
            expect(item.seed).toBe(expected);
        }
    });

    test("clamps a stattrak count into range, and strips one from an item that never counted", () => {
        const cases: [item: CS2BaseInventoryItem, expected: number | undefined][] = [
            [{ id: AWP_DRAGON_LORE_ID, statTrak: 1e9 }, CS2_MAX_STATTRAK],
            [{ id: AWP_DRAGON_LORE_ID, statTrak: -5 }, CS2_MIN_STATTRAK],
            [{ id: AWP_DRAGON_LORE_ID, statTrak: 5.9 }, 5],
            [{ id: AWP_DRAGON_LORE_ID, statTrak: NaN }, undefined],
            [{ id: STORAGE_UNIT_ID, statTrak: 5 }, undefined]
        ];
        for (const [item, expected] of cases) {
            expect(repairInventoryItem(CS2Economy, item)).toBe(true);
            expect(item.statTrak).toBe(expected);
        }
    });
});

describe("repairInventoryItem attributes with nothing to coerce them into", () => {
    test("drops a name the pattern rejects instead of inventing one the owner did not choose", () => {
        for (const nameTag of [" leading space", "x".repeat(30), "🎉", 'he said "hi"']) {
            const item: CS2BaseInventoryItem = { id: AK47_ID, nameTag };
            expect(repairInventoryItem(CS2Economy, item), `repairing ${nameTag}`).toBe(true);
            expect(item.nameTag).toBeUndefined();
        }
        const stickerNamed: CS2BaseInventoryItem = { id: FALLEN_COLOGNE_2015_ID, nameTag: "my sticker" };
        expect(repairInventoryItem(CS2Economy, stickerNamed)).toBe(true);
        expect(stickerNamed.nameTag).toBeUndefined();

        const named: CS2BaseInventoryItem = { id: AK47_ID, nameTag: "my rifle" };
        expect(repairInventoryItem(CS2Economy, named)).toBe(true);
        expect(named.nameTag).toBe("my rifle");
    });

    test("trims attachments to the slots the model has, keeping the lowest", () => {
        const keychained: CS2BaseInventoryItem = {
            id: AK47_ID,
            keychains: { 0: { id: LIL_AVA_ID, seed: 1 }, 1: { id: LIL_AVA_ID, seed: 2 }, 5: { id: LIL_AVA_ID } }
        };
        expect(repairInventoryItem(CS2Economy, keychained)).toBe(true);
        expect(keychained.keychains).toEqual({
            0: { id: LIL_AVA_ID, seed: 1, x: undefined, y: undefined, z: undefined }
        });

        const patched: CS2BaseInventoryItem = {
            id: GROUND_REBEL_ID,
            patches: { 0: BLOODHOUND_ID, 4: BLOODHOUND_ID, 99: BLOODHOUND_ID, "-1": BLOODHOUND_ID }
        };
        expect(repairInventoryItem(CS2Economy, patched)).toBe(true);
        expect(patched.patches).toEqual({ 0: BLOODHOUND_ID, 4: BLOODHOUND_ID });
    });

    test("drops an attachment of a kind its slot was never able to hold", () => {
        const stickered: CS2BaseInventoryItem = { id: AK47_ID, stickers: { 0: { id: LIL_AVA_ID } } };
        expect(repairInventoryItem(CS2Economy, stickered)).toBe(true);
        expect(stickered.stickers).toBeUndefined();

        const keychained: CS2BaseInventoryItem = { id: AK47_ID, keychains: { 0: { id: FALLEN_COLOGNE_2015_ID } } };
        expect(repairInventoryItem(CS2Economy, keychained)).toBe(true);
        expect(keychained.keychains).toEqual({});

        const patched: CS2BaseInventoryItem = { id: GROUND_REBEL_ID, patches: { 0: FALLEN_COLOGNE_2015_ID } };
        expect(repairInventoryItem(CS2Economy, patched)).toBe(true);
        expect(patched.patches).toEqual({});
    });
});

describe("repairInventoryItem charges", () => {
    test("clamps and truncates charges to what the item can hold, and strips them from one that holds none", () => {
        const graffiti: CS2BaseInventoryItem = { id: GRAFFITI_ACE_ID, charges: 99.7 };
        const knife: CS2BaseInventoryItem = { id: KARAMBIT_BOREAL_FOREST_ID, charges: 5 };
        expect(repairInventoryItem(CS2Economy, graffiti)).toBe(true);
        expect(repairInventoryItem(CS2Economy, knife)).toBe(true);
        expect(graffiti.charges).toBe(CS2_MAX_GRAFFITI_CHARGES);
        expect(knife.charges).toBe(undefined);
    });

    test("hands an equipped graffiti the default charges whenever it has none left to lose", () => {
        // Equipping is what asserts `!isSealed()`, so an equipped graffiti carrying charges that do
        // not survive repair is in the same position as one carrying none at all.
        for (const charges of [undefined, NaN]) {
            const item: CS2BaseInventoryItem = { id: GRAFFITI_ACE_ID, charges, equipped: true };
            expect(repairInventoryItem(CS2Economy, item)).toBe(true);
            expect(item.charges).toBe(CS2Economy.getById(GRAFFITI_ACE_ID).getDefaultCharges());
        }
    });
});

describe("repairInventoryItem reports whether the item survived", () => {
    test("returns true when the coercions left an item assertInventoryItem accepts", () => {
        const item: CS2BaseInventoryItem = {
            id: AWP_DRAGON_LORE_ID,
            stickers: { 0: { id: FALLEN_COLOGNE_2015_ID, x: 5, rotation: 270, schema: 9 } }
        };
        expect(repairInventoryItem(CS2Economy, item)).toBe(true);
    });

    test("returns false for an id that has left the catalog", () => {
        expect(repairInventoryItem(CS2Economy, { id: UNKNOWN_ID })).toBe(false);
    });

    test("returns false when no coercion can reach the offending attribute", () => {
        // `checkAddable` is the one rule with no coercion behind it, and the only thing left that
        // "unrepairable" can mean: a base glove is an item the game never issued, so there is no
        // value to correct and nothing worth keeping.
        expect(checkAddable(CS2Economy.getById(BROKEN_FANG_GLOVES_ID))).toBe(false);
        expect(repairInventoryItem(CS2Economy, { id: BROKEN_FANG_GLOVES_ID })).toBe(false);
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

describe("repairInventoryItem against a catalog without markup", () => {
    const economy = unmarkedEconomy;

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
        const stickered: CS2BaseInventoryItem = {
            id: HALF_BOUNDED_ID,
            stickers: { 0: { id: STICKER_ID, x: 5 }, 1: { id: STICKER_ID, x: -5 } }
        };
        repairInventoryItem(economy, stickered);
        // Sticker X publishes a max only: the high side clamps, the low side passes through.
        expect(stickered.stickers?.[0]?.x).toBe(1);
        expect(stickered.stickers?.[1]?.x).toBe(-5);
        // Keychain X publishes a min only: the low side clamps, the high side passes through.
        for (const [x, expected] of [
            [-5, -1],
            [5, 5]
        ]) {
            const item: CS2BaseInventoryItem = { id: HALF_BOUNDED_ID, keychains: { 0: { id: KEYCHAIN_ID, x } } };
            repairInventoryItem(economy, item);
            expect(item.keychains?.[0]?.x).toBe(expected);
        }
    });
});

// The generalisation of `truncateToFactor output always satisfies isFactorPrecise` in utils.test.ts
// to the whole table. It is what the table exists to provide: a `check` whose `repair` cannot
// produce a value it accepts is a rule that drops an item on load, and this is what says so.
describe("every rule repairs into what it checks", () => {
    const hosts = [
        // Full markup, legacy envelopes.
        CS2Economy.getById(AWP_DRAGON_LORE_ID),
        // Wear, stickers and keychains, non-legacy envelopes.
        CS2Economy.getById(AK47_ID),
        // Neither stickers nor keychains, but wear.
        CS2Economy.getById(KARAMBIT_BOREAL_FOREST_ID),
        // Charges, no wear.
        CS2Economy.getById(GRAFFITI_ACE_ID),
        CS2Economy.getById(CHARM_DETACHMENT_ID),
        // A catalog that publishes no envelope at all, and one that publishes half of one.
        unmarkedEconomy.getById(UNBOUNDED_ID),
        unmarkedEconomy.getById(HALF_BOUNDED_ID)
    ];

    // Anything a stale document, a hand-written request body or a raw in-game float can carry.
    const values = [
        undefined,
        NaN,
        Infinity,
        -Infinity,
        0,
        1,
        -1,
        0.5,
        2.5,
        2.7,
        90.7,
        270,
        359.5,
        360,
        -180.5,
        180.5,
        0.123456789,
        -0.123456789,
        0.7000000476837158,
        5e-7,
        -5e-7,
        1e9,
        -1e9,
        1e21,
        -1e21,
        Number.MAX_SAFE_INTEGER,
        Number.MIN_SAFE_INTEGER,
        Number.MAX_VALUE,
        -Number.MAX_VALUE
    ];

    for (const [name, rule] of Object.entries(CS2_INVENTORY_RULES)) {
        test(`${name} repairs every input into something check accepts`, () => {
            for (const host of hosts) {
                for (const value of values) {
                    const repaired = rule.repair(value, host);
                    expect(
                        rule.check(repaired, host),
                        `${name} repaired ${value} to ${repaired} on item ${host.id}`
                    ).toBe(true);
                }
            }
        });
    }
});

// The promise the rule table was written to keep: an item whose id the catalog still has is worth
// coercing, never worth losing. Every `"unrepairable"` that reaches a log is then a real signal —
// a rule exists in `check` with no counterpart in `repair` — instead of constant noise.
describe("an item whose id is in the catalog is always repairable", () => {
    const hosts = [
        AK47_ID,
        AWP_DRAGON_LORE_ID,
        KARAMBIT_BOREAL_FOREST_ID,
        GRAFFITI_ACE_ID,
        CHARM_DETACHMENT_ID,
        GROUND_REBEL_ID,
        STORAGE_UNIT_ID,
        FALLEN_COLOGNE_2015_ID,
        LIL_AVA_ID,
        // The exception, and the only one: a base glove is an item the game never issued, so there
        // is no value to coerce and nothing to keep.
        BROKEN_FANG_GLOVES_ID
    ];

    // Anything a stale document, a hand-written request body or an item that outlived the rule
    // that produced it can carry.
    const shapes: Partial<CS2BaseInventoryItem>[] = [
        {},
        { wear: 0.9 },
        { wear: -1 },
        { wear: NaN },
        { charges: 1e9 },
        { charges: 2.5 },
        { seed: 99999 },
        { seed: 5.5 },
        { seed: -1 },
        { seed: NaN },
        { statTrak: 1e9 },
        { statTrak: 5.5 },
        { statTrak: -1 },
        { statTrak: NaN },
        { nameTag: " leading space" },
        { nameTag: "x".repeat(30) },
        { nameTag: "🎉" },
        { nameTag: "" },
        { keychains: { 0: { id: LIL_AVA_ID }, 1: { id: LIL_AVA_ID } } },
        { keychains: { 5: { id: LIL_AVA_ID } } },
        { keychains: { "-1": { id: LIL_AVA_ID } } },
        { keychains: { 0: { id: UNKNOWN_ID } } },
        { keychains: { 0: { id: FALLEN_COLOGNE_2015_ID } } },
        { keychains: { 0: { id: LIL_AVA_ID, seed: 1e9, x: NaN } } },
        { patches: { 99: BLOODHOUND_ID } },
        { patches: { "-1": BLOODHOUND_ID } },
        { patches: { 0: UNKNOWN_ID } },
        { patches: { 0: LIL_AVA_ID } },
        { stickers: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((slot) => [slot, { id: FALLEN_COLOGNE_2015_ID }])) },
        { stickers: { 9: { id: FALLEN_COLOGNE_2015_ID } } },
        { stickers: { 0: { id: UNKNOWN_ID } } },
        { stickers: { 0: { id: LIL_AVA_ID } } },
        { stickers: { 0: { id: FALLEN_COLOGNE_2015_ID, rotation: 270, schema: 99, wear: 5, x: 1e9 } } },
        { storage: { 0: { id: AK47_ID } } },
        { storage: { 0: { id: UNKNOWN_ID } } },
        { storage: { 0: { id: BROKEN_FANG_GLOVES_ID } } },
        { storage: { 0: { id: STORAGE_UNIT_ID, storage: { 0: { id: AK47_ID } } } } },
        { storage: { 0: { id: AWP_DRAGON_LORE_ID, seed: 99999, nameTag: " bad" } } }
    ];

    for (const id of hosts) {
        test(`every shape of item ${id} repairs into one assert accepts`, () => {
            const addable = checkAddable(CS2Economy.getById(id));
            for (const shape of shapes) {
                const item: CS2BaseInventoryItem = structuredClone({ id, ...shape });
                expect(repairInventoryItem(CS2Economy, item), `repairing ${JSON.stringify({ id, ...shape })}`).toBe(
                    addable
                );
            }
        });
    }
});

describe("a default item cannot be applied as an attachment", () => {
    test("assert rejects a default sticker, keychain or patch", () => {
        // Not a rule about one id: the game hands these out, so applying one is claiming an
        // attachment you never acquired. It generalises the day a second free charm ships.
        expect(() =>
            assertInventoryItem(CS2Economy, { id: AK47_ID, keychains: { 0: { id: DEFAULT_KEYCHAIN_ID } } })
        ).toThrow();
        expect(() =>
            assertInventoryItem(defaultAttachmentEconomy, {
                id: UNBOUNDED_ID,
                stickers: { 0: { id: DEFAULT_STICKER_ID } }
            })
        ).toThrow();
        expect(() =>
            assertInventoryItem(defaultAttachmentEconomy, { id: AGENT_ID, patches: { 0: DEFAULT_PATCH_ID } })
        ).toThrow();
    });

    test("assert still accepts the ordinary attachment of each kind", () => {
        expect(() =>
            assertInventoryItem(CS2Economy, { id: AK47_ID, keychains: { 0: { id: LIL_AVA_ID } } })
        ).not.toThrow();
        expect(() =>
            assertInventoryItem(defaultAttachmentEconomy, { id: UNBOUNDED_ID, stickers: { 0: { id: STICKER_ID } } })
        ).not.toThrow();
        expect(() =>
            assertInventoryItem(defaultAttachmentEconomy, { id: AGENT_ID, patches: { 0: PATCH_ID } })
        ).not.toThrow();
    });
});

describe("a default attachment is stripped rather than costing the item", () => {
    test("repair drops the default attachment and keeps the item and its ordinary ones", () => {
        const keychained: CS2BaseInventoryItem = { id: AK47_ID, keychains: { 0: { id: DEFAULT_KEYCHAIN_ID } } };
        expect(repairInventoryItem(CS2Economy, keychained)).toBe(true);
        expect(keychained.keychains?.[0]).toBeUndefined();

        const stickered: CS2BaseInventoryItem = {
            id: UNBOUNDED_ID,
            stickers: { 0: { id: DEFAULT_STICKER_ID }, 1: { id: STICKER_ID } }
        };
        expect(repairInventoryItem(defaultAttachmentEconomy, stickered)).toBe(true);
        expect(Object.values(ensure(stickered.stickers)).map(({ id }) => id)).toEqual([STICKER_ID]);

        const patched: CS2BaseInventoryItem = { id: AGENT_ID, patches: { 0: DEFAULT_PATCH_ID, 1: PATCH_ID } };
        expect(repairInventoryItem(defaultAttachmentEconomy, patched)).toBe(true);
        expect(patched.patches).toEqual({ 1: PATCH_ID });
    });
});

describe("storage is a rule like any other attribute", () => {
    test("check accepts stored items only inside a storage unit, and never a unit inside one", () => {
        expect(checkInventoryItem(CS2Economy, { id: STORAGE_UNIT_ID, storage: { 0: { id: AK47_ID } } })).toBe(true);
        expect(checkInventoryItem(CS2Economy, { id: AK47_ID, storage: { 0: { id: AK47_ID } } })).toBe(false);
        expect(
            checkInventoryItem(CS2Economy, {
                id: STORAGE_UNIT_ID,
                storage: { 0: { id: STORAGE_UNIT_ID, storage: { 0: { id: AK47_ID } } } }
            })
        ).toBe(false);
    });

    test("check reads every stored item with the same rules it reads a loose one by", () => {
        expect(checkInventoryItem(CS2Economy, { id: STORAGE_UNIT_ID, storage: { 0: { id: UNKNOWN_ID } } })).toBe(false);
        expect(
            checkInventoryItem(CS2Economy, { id: STORAGE_UNIT_ID, storage: { 0: { id: BROKEN_FANG_GLOVES_ID } } })
        ).toBe(false);
    });

    test("repair takes storage off an item that cannot hold one, and unnests a unit inside a unit", () => {
        const weapon: CS2BaseInventoryItem = { id: AK47_ID, storage: { 0: { id: AK47_ID } } };
        expect(repairInventoryItem(CS2Economy, weapon)).toBe(true);
        expect(weapon.storage).toBeUndefined();

        const nested: CS2BaseInventoryItem = {
            id: STORAGE_UNIT_ID,
            storage: { 0: { id: STORAGE_UNIT_ID, storage: { 0: { id: AK47_ID } } } }
        };
        expect(repairInventoryItem(CS2Economy, nested)).toBe(true);
        expect(nested.storage?.[0]?.storage).toBeUndefined();
    });

    test("repair coerces each stored item and records the ones it could not save", () => {
        const item: CS2BaseInventoryItem = {
            id: STORAGE_UNIT_ID,
            storage: {
                0: { id: AWP_DRAGON_LORE_ID, wear: 0.9 },
                1: { id: UNKNOWN_ID },
                2: { id: BROKEN_FANG_GLOVES_ID }
            }
        };
        const dropped: CS2InventoryDrop[] = [];
        expect(repairInventoryItem(CS2Economy, item, { dropped, storageUid: 7 })).toBe(true);
        expect(item.storage?.[0]?.wear).toBe(0.7);
        expect(Object.keys(ensure(item.storage))).toEqual(["0"]);
        expect(dropped).toEqual([
            { uid: 1, id: UNKNOWN_ID, reason: "unknown-item", storageUid: 7 },
            { uid: 2, id: BROKEN_FANG_GLOVES_ID, reason: "unrepairable", storageUid: 7 }
        ]);
    });

    test("a unit emptied by repair holds nothing rather than an empty record, and survives", () => {
        const item: CS2BaseInventoryItem = { id: STORAGE_UNIT_ID, storage: { 0: { id: UNKNOWN_ID } } };
        expect(repairInventoryItem(CS2Economy, item)).toBe(true);
        expect(item.storage).toBeUndefined();
    });
});

describe("reconcileInventoryItems", () => {
    test("folds loose charm detachment stacks into the lowest uid, summing their charges", () => {
        const items: Record<number, CS2BaseInventoryItem> = {
            2: { id: CHARM_DETACHMENT_ID },
            5: { id: CHARM_DETACHMENT_ID, charges: 4 },
            7: { id: CHARM_DETACHMENT_ID },
            9: { id: AK47_ID }
        };
        reconcileInventoryItems(CS2Economy, items, noPolicy);
        expect(Object.keys(items)).toEqual(["2", "9"]);
        expect(items[2]?.charges).toBe(6);
    });

    // The base AK-47 is `isDefault` in the shipped catalog: the game issues it, so an untouched one
    // is worth nothing stored. One the owner has named, stickered or charged is not the same item.
    test("drops the free items carrying nothing, and only when the consumer asked for it", () => {
        const makeItems = (): Record<number, CS2BaseInventoryItem> => ({
            0: { id: AK47_ID },
            1: { id: AWP_DRAGON_LORE_ID },
            2: { id: AK47_ID, nameTag: "Mine" },
            3: { id: AK47_ID, stickers: { 0: { id: FALLEN_COLOGNE_2015_ID } } },
            4: { id: AK47_ID, keychains: { 0: { id: LIL_AVA_ID } } },
            5: { id: CHARM_DETACHMENT_ID, charges: 3 }
        });
        const untouched = makeItems();
        expect(reconcileInventoryItems(CS2Economy, untouched, noPolicy)).toEqual([]);
        expect(Object.keys(untouched)).toEqual(["0", "1", "2", "3", "4", "5"]);

        const items = makeItems();
        const dropped = reconcileInventoryItems(CS2Economy, items, { ...noPolicy, dropEmptyDefaultItems: true });
        expect(dropped).toEqual([{ uid: 0, id: AK47_ID, reason: "policy" }]);
        expect(Object.keys(items)).toEqual(["1", "2", "3", "4", "5"]);
    });

    test("wipes detachments out of storage, re-seals what is left and empties a unit it emptied", () => {
        const items: Record<number, CS2BaseInventoryItem> = {
            0: {
                id: STORAGE_UNIT_ID,
                nameTag: "My Storage Unit",
                storage: {
                    0: { id: CHARM_DETACHMENT_ID, charges: 9 },
                    1: { id: GRAFFITI_ACE_ID, charges: 12 },
                    2: { id: CHARM_DETACHMENT_PACK_ID }
                }
            },
            1: { id: STORAGE_UNIT_ID, nameTag: "Empties", storage: { 0: { id: CHARM_DETACHMENT_ID } } }
        };
        // Charges are worth something, so wiping a stack is a drop and says so.
        expect(reconcileInventoryItems(CS2Economy, items, noPolicy)).toEqual([
            { uid: 0, id: CHARM_DETACHMENT_ID, reason: "policy", storageUid: 0 },
            { uid: 2, id: CHARM_DETACHMENT_PACK_ID, reason: "policy", storageUid: 0 },
            { uid: 0, id: CHARM_DETACHMENT_ID, reason: "policy", storageUid: 1 }
        ]);
        // Wiped, not withdrawn: nothing lands back in the inventory.
        expect(Object.keys(ensure(items[0]?.storage))).toEqual(["1"]);
        expect(items[0]?.storage?.[1]?.charges).toBeUndefined();
        expect(items[1]?.storage).toBeUndefined();
        expect(Object.keys(items)).toEqual(["0", "1"]);
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
