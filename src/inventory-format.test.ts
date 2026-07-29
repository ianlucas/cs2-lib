/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, test } from "vitest";
import { CS2Economy } from "./economy.ts";
import {
    CS2InventoryDecodeError,
    CS2InventoryError,
    CS2InventoryMigrationError,
    CS2InventoryVersionError
} from "./inventory-format.ts";
import { CS2_INVENTORY_VERSION, CS2_MIN_INVENTORY_VERSION } from "./inventory-migrations/index.ts";
import { CS2Inventory } from "./inventory.ts";
import { CS2_ITEMS } from "./items.ts";
import { english } from "./translations/english.ts";

CS2Economy.load({ items: CS2_ITEMS, language: english });

const AK47_ID = 4;
const AWP_DRAGON_LORE_ID = 307;
const FALLEN_COLOGNE_2015_ID = 2226;
// An id no `items.json` has ever published, standing in for one a catalog update took away.
const RETIRED_ID = 999999;

test("load turns stored bytes into an inventory", () => {
    const inventory = CS2Inventory.load(
        JSON.stringify({ items: { 0: { id: AK47_ID, nameTag: "my rifle" } }, version: CS2_INVENTORY_VERSION })
    );

    expect(inventory.size()).toBe(1);
    expect(inventory.get(0).id).toBe(AK47_ID);
    expect(inventory.get(0).nameTag).toBe("my rifle");
});

test("load runs the ladder, so a stored version 1 document arrives at the current version", () => {
    const inventory = CS2Inventory.load(
        JSON.stringify({
            items: { 0: { id: AK47_ID, stickers: { 0: { id: FALLEN_COLOGNE_2015_ID, rotation: 270 } } } },
            version: 1
        })
    );

    expect(inventory.get(0).stickers?.get(0)?.rotation).toBe(-90);
});

test("the report names the version a migrated document came from", () => {
    const inventory = CS2Inventory.load(JSON.stringify({ items: { 0: { id: AK47_ID } }, version: 1 }));

    expect(inventory.loadReport?.migratedFrom).toBe(1);
});

test("an item whose id left the catalog is dropped, and the rest of the inventory survives", () => {
    const inventory = CS2Inventory.load(
        JSON.stringify({
            items: { 0: { id: AK47_ID }, 1: { id: RETIRED_ID }, 2: { id: AK47_ID } },
            version: CS2_INVENTORY_VERSION
        })
    );

    expect(inventory.size()).toBe(2);
    expect(inventory.loadReport?.dropped).toStrictEqual([{ uid: 1, id: RETIRED_ID, reason: "unknown-item" }]);
});

// A seed outside the item's range is a rule `check` enforces that no `repair` counterpart reaches,
// so the item cannot be made valid. It goes, and it is recorded under its own reason rather than
// taking the document with it.
test("an item no coercion can make valid is dropped as unrepairable, not thrown over", () => {
    const inventory = CS2Inventory.load(
        JSON.stringify({
            items: { 0: { id: AWP_DRAGON_LORE_ID, seed: 99999 }, 1: { id: AK47_ID } },
            version: CS2_INVENTORY_VERSION
        })
    );

    expect(inventory.size()).toBe(1);
    expect(inventory.get(1).id).toBe(AK47_ID);
    expect(inventory.loadReport?.dropped).toStrictEqual([{ uid: 0, id: AWP_DRAGON_LORE_ID, reason: "unrepairable" }]);
});

test("an item a coercion had to change is reported by uid, and an untouched one is not", () => {
    const inventory = CS2Inventory.load(
        JSON.stringify({
            // 0.9 is past this item's wear ceiling of 0.7, which repair clamps rather than drops.
            items: { 0: { id: AWP_DRAGON_LORE_ID, wear: 0.9 }, 1: { id: AK47_ID } },
            version: CS2_INVENTORY_VERSION
        })
    );

    expect(inventory.get(0).wear).toBe(0.7);
    expect(inventory.loadReport?.repairedUids).toStrictEqual([0]);
});

// Repair's trigger is "always", so vetted data gets the same coercions and the same drops — what
// `load` adds on top is the decode and the ladder. A drop is never silent on either path.
test("data handed straight to the constructor is repaired and reported, but not migrated", () => {
    const inventory = new CS2Inventory({
        data: {
            items: { 0: { id: AWP_DRAGON_LORE_ID, wear: 0.9 }, 1: { id: RETIRED_ID } },
            version: CS2_INVENTORY_VERSION
        }
    });

    expect(inventory.get(0).wear).toBe(0.7);
    expect(inventory.loadReport?.migratedFrom).toBeUndefined();
    expect(inventory.loadReport?.repairedUids).toStrictEqual([0]);
    expect(inventory.loadReport?.dropped).toStrictEqual([{ uid: 1, id: RETIRED_ID, reason: "unknown-item" }]);
});

test("an inventory that started empty has nothing to report", () => {
    expect(new CS2Inventory().loadReport).toBeUndefined();
});

test("bytes that are not JSON are refused as a decode failure", () => {
    expect(() => CS2Inventory.load("not json")).toThrow(CS2InventoryDecodeError);
    // The hierarchy is what a caller catches when it only wants to know the bytes were unusable.
    expect(() => CS2Inventory.load("not json")).toThrow(CS2InventoryError);
    // The empty column that used to resolve to `undefined` and quietly wipe the user.
    expect(() => CS2Inventory.load("")).toThrow(CS2InventoryDecodeError);
});

test("JSON that is not an inventory document is refused as a decode failure", () => {
    for (const raw of ["null", "5", '"an inventory"', '{"items":5,"version":2}', '{"items":null,"version":2}']) {
        expect(() => CS2Inventory.load(raw)).toThrow(CS2InventoryDecodeError);
    }
});

// A writer running older code than the document's producer would otherwise rebuild it from a fixed
// field list and destroy whatever the newer version added, so refusing is the whole mitigation.
test("a document stamped above the ladder's top rung is refused, never silently downgraded", () => {
    const raw = JSON.stringify({ items: {}, version: CS2_INVENTORY_VERSION + 1 });

    expect(() => CS2Inventory.load(raw)).toThrow(CS2InventoryVersionError);
});

// The version 1 rung asks the catalog whether an item is a patch before it unequips it, so an id
// that has since left `items.json` makes the rung itself throw.
test("a rung that throws is reported as a migration failure, with the original error kept", () => {
    const raw = JSON.stringify([{ equipped: true, id: RETIRED_ID, uid: 0 }]);

    expect(() => CS2Inventory.load(raw)).toThrow(CS2InventoryMigrationError);
    try {
        CS2Inventory.load(raw);
    } catch (error) {
        expect((error as CS2InventoryMigrationError).cause).toBeInstanceOf(Error);
    }
});

test("a document stamped below the oldest version still read is refused", () => {
    const raw = JSON.stringify({ items: {}, version: CS2_MIN_INVENTORY_VERSION - 1 });

    expect(() => CS2Inventory.load(raw)).toThrow(CS2InventoryVersionError);
});
