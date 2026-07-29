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
const BLOODHOUND_ID = 8569;
const BROKEN_FANG_GLOVES_ID = 56;
const CHARM_DETACHMENT_ID = 12450;
const FALLEN_COLOGNE_2015_ID = 2226;
const GRAFFITI_ACE_ID = 9543;
const GROUND_REBEL_ID = 8620;
const LIL_AVA_ID = 13113;
const STORAGE_UNIT_ID = 11262;
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

// An item still in the catalog is worth coercing rather than losing, so the only thing left that
// cannot be made valid is one that could never have existed: a base glove is a model the game
// dresses a player in, never an item anyone owns. It goes, and it is recorded under its own reason
// rather than taking the document with it.
test("an item no coercion can make valid is dropped as unrepairable, not thrown over", () => {
    const inventory = CS2Inventory.load(
        JSON.stringify({
            items: { 0: { id: BROKEN_FANG_GLOVES_ID }, 1: { id: AK47_ID } },
            version: CS2_INVENTORY_VERSION
        })
    );

    expect(inventory.size()).toBe(1);
    expect(inventory.get(1).id).toBe(AK47_ID);
    expect(inventory.loadReport?.dropped).toStrictEqual([
        { uid: 0, id: BROKEN_FANG_GLOVES_ID, reason: "unrepairable" }
    ]);
});

// The reading the rule table promises, and the one a log needs to be worth reading: an id the
// catalog still has never costs the item, however stale the values written against it are.
test("an item whose id is in the catalog survives its own bad values, coerced and reported", () => {
    const inventory = CS2Inventory.load(
        JSON.stringify({
            items: { 0: { id: AWP_DRAGON_LORE_ID, seed: 99999, statTrak: 1e9, nameTag: " bad name" } },
            version: CS2_INVENTORY_VERSION
        })
    );

    expect(inventory.size()).toBe(1);
    expect(inventory.get(0).seed).toBe(1000);
    expect(inventory.get(0).statTrak).toBe(999999);
    expect(inventory.get(0).nameTag).toBeUndefined();
    expect(inventory.loadReport?.dropped).toStrictEqual([]);
    expect(inventory.loadReport?.repairedUids).toStrictEqual([0]);
});

// A unit holds up to 32 items, so nesting is where a drop costs the most, and it was the one place
// a drop was either unrecorded or fatal to the whole document.
test("a stored item whose id left the catalog is dropped, and the unit it came out of is named", () => {
    const inventory = CS2Inventory.load(
        JSON.stringify({
            items: { 0: { id: STORAGE_UNIT_ID, storage: { 0: { id: RETIRED_ID }, 1: { id: AK47_ID } } } },
            version: CS2_INVENTORY_VERSION
        })
    );

    expect(inventory.get(0).storage?.size).toBe(1);
    expect(inventory.loadReport?.dropped).toStrictEqual([
        { uid: 0, id: RETIRED_ID, reason: "unknown-item", storageUid: 0 }
    ]);
});

test("a stored item no coercion can make valid is dropped, and the document survives", () => {
    const inventory = CS2Inventory.load(
        JSON.stringify({
            items: { 0: { id: STORAGE_UNIT_ID, storage: { 0: { id: BROKEN_FANG_GLOVES_ID } } }, 1: { id: AK47_ID } },
            version: CS2_INVENTORY_VERSION
        })
    );

    expect(inventory.size()).toBe(2);
    expect(inventory.loadReport?.dropped).toStrictEqual([
        { uid: 0, id: BROKEN_FANG_GLOVES_ID, reason: "unrepairable", storageUid: 0 }
    ]);
});

// The unit is a tool the owner paid for and named, so losing what was inside it is not a reason to
// lose it as well.
test("a storage unit its contents leaving emptied is kept, holding nothing", () => {
    const inventory = CS2Inventory.load(
        JSON.stringify({
            items: { 0: { id: STORAGE_UNIT_ID, nameTag: "My Storage Unit", storage: { 0: { id: RETIRED_ID } } } },
            version: CS2_INVENTORY_VERSION
        })
    );

    expect(inventory.size()).toBe(1);
    expect(inventory.get(0).nameTag).toBe("My Storage Unit");
    expect(inventory.get(0).storage).toBeUndefined();
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

// Writing a sticker's anchor in is canonicalisation, not repair: the document said nothing about
// which anchor to use and the model picked one. Reporting it would name nearly every inventory
// holding a sticker as one a load had to change, and the backfill reads the report to decide what
// to rewrite.
test("canonicalising an item is not a repair, and is not reported as one", () => {
    const inventory = CS2Inventory.load(
        JSON.stringify({
            items: {
                0: { id: AK47_ID, stickers: { 0: { id: FALLEN_COLOGNE_2015_ID } } },
                1: {
                    id: STORAGE_UNIT_ID,
                    storage: { 0: { id: AK47_ID, stickers: { 0: { id: FALLEN_COLOGNE_2015_ID } } } }
                }
            },
            version: CS2_INVENTORY_VERSION
        })
    );

    expect(inventory.loadReport?.repairedUids).toStrictEqual([]);
    expect(inventory.get(0).stickers?.get(0)?.schema).toBe(0);
});

// Reconcile runs after repair and edits the same items, so a report closed before it calls a merged
// stack an item nothing happened to. The backfill writes back only what a load says it changed, so
// what the report leaves out is a document that merges again on every load, stamping a new
// `updatedAt` each time — the same stored bytes producing a different `stringify()` forever.
test("an edit reconcile made is reported as a repair, not left out of the report", () => {
    const inventory = CS2Inventory.load(
        JSON.stringify({
            items: { 0: { id: CHARM_DETACHMENT_ID, charges: 2 }, 3: { id: CHARM_DETACHMENT_ID, charges: 4 } },
            version: CS2_INVENTORY_VERSION
        })
    );

    expect(inventory.size()).toBe(1);
    expect(inventory.get(0).charges).toBe(6);
    expect(inventory.loadReport?.repairedUids).toStrictEqual([0]);
    // The stack that folded into the survivor kept every charge it had, so nothing left the
    // inventory with it and there is nothing to record as lost.
    expect(inventory.loadReport?.dropped).toStrictEqual([]);
});

test("a storage unit reconcile took the charges out of is reported as repaired", () => {
    const inventory = CS2Inventory.load(
        JSON.stringify({
            items: { 0: { id: STORAGE_UNIT_ID, storage: { 0: { id: GRAFFITI_ACE_ID, charges: 12 } } } },
            version: CS2_INVENTORY_VERSION
        })
    );

    expect(inventory.get(0).storage?.get(0)?.charges).toBeUndefined();
    expect(inventory.loadReport?.repairedUids).toStrictEqual([0]);
});

// A coercion the item did not outlive is nothing to write back, so only what survived is compared.
// Naming an item under both headings would have the backfill reading a loss as a repair.
test("an item a cap took away is a drop and not also a repair", () => {
    const inventory = CS2Inventory.load(
        JSON.stringify({
            items: { 0: { id: AK47_ID }, 1: { id: AWP_DRAGON_LORE_ID, wear: 0.9 } },
            version: CS2_INVENTORY_VERSION
        }),
        { maxItems: 1 }
    );

    expect(inventory.loadReport?.dropped).toStrictEqual([{ uid: 1, id: AWP_DRAGON_LORE_ID, reason: "policy" }]);
    expect(inventory.loadReport?.repairedUids).toStrictEqual([]);
});

// The invariant the backfill routine depends on: it writes back whatever a load had to change, so
// a load that changes something on data this package itself wrote would rewrite every row on every
// run, and never stop.
test("loading what an inventory stringified reports nothing to change", () => {
    const inventory = CS2Inventory.load(
        JSON.stringify({
            items: {
                0: { id: AWP_DRAGON_LORE_ID, wear: 0.9, seed: 99999, nameTag: " bad name" },
                1: { id: AK47_ID, stickers: { 0: { id: FALLEN_COLOGNE_2015_ID }, 3: { id: FALLEN_COLOGNE_2015_ID } } },
                2: { id: AK47_ID, keychains: { 0: { id: LIL_AVA_ID, seed: 1e9 } } },
                3: { id: STORAGE_UNIT_ID, nameTag: "My Storage Unit", storage: { 0: { id: RETIRED_ID } } },
                4: { id: GROUND_REBEL_ID, patches: { 0: BLOODHOUND_ID, 99: BLOODHOUND_ID } }
            },
            version: CS2_INVENTORY_VERSION
        })
    );
    const reloaded = CS2Inventory.load(inventory.stringify());

    expect(reloaded.loadReport?.dropped).toStrictEqual([]);
    expect(reloaded.loadReport?.repairedUids).toStrictEqual([]);
    expect(reloaded.stringify()).toBe(inventory.stringify());
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

// Repair coerces in place, and the place it coerced used to be the caller's own object: handing an
// inventory to the constructor silently rewrote the values in it and deleted the items it dropped.
test("the constructor leaves the data it was handed exactly as it found it", () => {
    const data = {
        items: {
            0: { id: AWP_DRAGON_LORE_ID, wear: 0.9 },
            1: { id: RETIRED_ID },
            2: { id: STORAGE_UNIT_ID, storage: { 0: { id: RETIRED_ID } } }
        },
        version: CS2_INVENTORY_VERSION
    };
    const before = JSON.stringify(data);
    new CS2Inventory({ data });

    expect(JSON.stringify(data)).toBe(before);
});

// The lib owns the rule, the consumer owns the decision — so the drop is opt-in, and once taken it
// is reported like any other, rather than being a one-shot pass that has to remember it ran.
test("dropEmptyDefaultItems takes the free items and records them under their own reason", () => {
    const raw = JSON.stringify({
        items: { 0: { id: AK47_ID }, 1: { id: AK47_ID, nameTag: "my rifle" }, 2: { id: AWP_DRAGON_LORE_ID } },
        version: CS2_INVENTORY_VERSION
    });

    expect(CS2Inventory.load(raw).size()).toBe(3);

    const inventory = CS2Inventory.load(raw, { dropEmptyDefaultItems: true });
    expect(inventory.size()).toBe(2);
    expect(inventory.loadReport?.dropped).toStrictEqual([{ uid: 0, id: AK47_ID, reason: "policy" }]);
});

// `load` is the untrusted-bytes entry point, and every item it keeps becomes an economy item
// carrying the whole catalog row. A cap the caller set and the loader ignores is not a cap.
test("an inventory past its cap loses its newest items, and every one of them is named", () => {
    const items = Object.fromEntries(Array.from({ length: 12 }, (_, uid) => [uid, { id: AK47_ID }]));
    const inventory = CS2Inventory.load(JSON.stringify({ items, version: CS2_INVENTORY_VERSION }), { maxItems: 10 });

    expect(inventory.size()).toBe(10);
    // The highest uids go, so the oldest items are the ones that survive.
    expect(inventory.loadReport?.dropped).toStrictEqual([
        { uid: 10, id: AK47_ID, reason: "policy" },
        { uid: 11, id: AK47_ID, reason: "policy" }
    ]);
});

test("a storage unit past its cap loses its newest contents, named against the unit", () => {
    const storage = Object.fromEntries(Array.from({ length: 4 }, (_, uid) => [uid, { id: AK47_ID }]));
    const inventory = CS2Inventory.load(
        JSON.stringify({ items: { 0: { id: STORAGE_UNIT_ID, storage } }, version: CS2_INVENTORY_VERSION }),
        { storageUnitMaxItems: 3 }
    );

    expect(inventory.get(0).storage?.size).toBe(3);
    expect(inventory.loadReport?.dropped).toStrictEqual([{ uid: 3, id: AK47_ID, reason: "policy", storageUid: 0 }]);
});

test("an inventory inside its cap is left alone", () => {
    const items = Object.fromEntries(Array.from({ length: 10 }, (_, uid) => [uid, { id: AK47_ID }]));
    const inventory = CS2Inventory.load(JSON.stringify({ items, version: CS2_INVENTORY_VERSION }), { maxItems: 10 });

    expect(inventory.size()).toBe(10);
    expect(inventory.loadReport?.dropped).toStrictEqual([]);
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

// A document has to have the shape its own version stamp implies, and an object carrying no stamp
// reads as version 0, which is a bare array. Without that gate any object at all reaches the first
// rung, and bytes that were never an inventory come back as a migration that failed.
test("JSON that is not an inventory document is refused as a decode failure", () => {
    for (const raw of [
        "null",
        "5",
        '"an inventory"',
        "{}",
        '{"foo":1}',
        '{"items":{}}',
        '{"items":{},"version":0}',
        '{"items":5,"version":2}',
        '{"items":null,"version":2}'
    ]) {
        expect(() => CS2Inventory.load(raw)).toThrow(CS2InventoryDecodeError);
    }
});

// A writer running older code than the document's producer would otherwise rebuild it from a fixed
// field list and destroy whatever the newer version added, so refusing is the whole mitigation.
test("a document stamped above the ladder's top rung is refused, never silently downgraded", () => {
    const raw = JSON.stringify({ items: {}, version: CS2_INVENTORY_VERSION + 1 });

    expect(() => CS2Inventory.load(raw)).toThrow(CS2InventoryVersionError);
});

// An empty inventory is a real thing to have stored, and version 0 wrote it as an empty array. It
// has to survive the shape gate, which is otherwise the one place an inventory with nothing in it
// looks the same as bytes with nothing in them.
test("an empty version 0 inventory loads as an inventory holding nothing", () => {
    const inventory = CS2Inventory.load("[]");

    expect(inventory.size()).toBe(0);
    expect(inventory.loadReport?.migratedFrom).toBe(0);
});

// The gate reads the document, not the items inside it, so an array whose elements are not items is
// what still reaches a rung and kills it — a rung failing on a document it should have been able to
// walk, which is the one failure a caller can do nothing about but is owed the reason for.
test("a rung that throws is reported as a migration failure, with the original error kept", () => {
    const raw = "[null]";

    expect(() => CS2Inventory.load(raw)).toThrow(CS2InventoryMigrationError);
    try {
        CS2Inventory.load(raw);
    } catch (error) {
        expect((error as CS2InventoryMigrationError).cause).toBeInstanceOf(Error);
    }
});

// Catalog drift is an item-level loss by design, and a version 0 document is the likeliest to be
// holding an id that drifted. The rung leaves it alone; repair is what drops it, reported.
test("a version 0 document holding an equipped id that left the catalog loses the item, not itself", () => {
    const inventory = CS2Inventory.load(
        JSON.stringify([
            { equipped: true, id: RETIRED_ID, uid: 0 },
            { equipped: true, id: AK47_ID, uid: 1 }
        ])
    );

    expect(inventory.size()).toBe(1);
    expect(inventory.get(1).id).toBe(AK47_ID);
    expect(inventory.loadReport?.migratedFrom).toBe(0);
    expect(inventory.loadReport?.dropped).toStrictEqual([{ uid: 0, id: RETIRED_ID, reason: "unknown-item" }]);
});

test("a document stamped below the oldest version still read is refused", () => {
    const raw = JSON.stringify({ items: {}, version: CS2_MIN_INVENTORY_VERSION - 1 });

    expect(() => CS2Inventory.load(raw)).toThrow(CS2InventoryVersionError);
});
