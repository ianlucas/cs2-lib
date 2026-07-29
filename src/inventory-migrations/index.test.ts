/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, test } from "vitest";
import { CS2Economy } from "../economy.ts";
import { CS2_ITEMS } from "../items.ts";
import { english } from "../translations/english.ts";
import { CS2_INVENTORY_VERSION, CS2_MIN_INVENTORY_VERSION, migrations, resolveInventoryData } from "./index.ts";

CS2Economy.load({ items: CS2_ITEMS, language: english });

const AK47_ID = 4;
const ALLU_COLOGNE_2015_ID = 2268;
const AWP_ID = 6;
const BLOODHOUND_PATCH_ID = 8569;
const FALLEN_COLOGNE_2015_ID = 2226;
const STORAGE_UNIT_ID = 11262;

test("the ladder is the single source of the format's version numbers", () => {
    expect(CS2_INVENTORY_VERSION).toBe(1);
    expect(CS2_MIN_INVENTORY_VERSION).toBe(0);
});

test("the ladder has no gaps: the rung at index i takes a document to version i + 1", () => {
    migrations.forEach((migration, index) => {
        expect(migration.to).toBe(index + 1);
    });
});

test("every rung describes the shape change it performs", () => {
    for (const migration of migrations) {
        expect(migration.describe.trim()).not.toBe("");
    }
});

test("version 0 stores items as an array; version 1 keys them by uid", () => {
    const data = resolveInventoryData(
        JSON.stringify([
            { id: AK47_ID, uid: 0 },
            { id: AWP_ID, uid: 3 }
        ])
    );

    expect(data).toStrictEqual({
        items: {
            0: { id: AK47_ID },
            3: { id: AWP_ID }
        },
        version: 1
    });
});

test("version 1 renames the lowercased version 0 fields", () => {
    const data = resolveInventoryData(
        JSON.stringify([
            {
                caseid: 9425,
                id: AK47_ID,
                nametag: "my rifle",
                stattrak: 1337,
                uid: 0,
                updatedat: 1707696138
            }
        ])
    );

    expect(data?.items[0]).toStrictEqual({
        containerId: 9425,
        id: AK47_ID,
        nameTag: "my rifle",
        statTrak: 1337,
        updatedAt: 1707696138
    });
});

test("version 1 pairs the two sticker arrays into a record keyed by slot, dropping empty slots", () => {
    const data = resolveInventoryData(
        JSON.stringify([
            {
                id: AK47_ID,
                stickers: [0, FALLEN_COLOGNE_2015_ID, 0, ALLU_COLOGNE_2015_ID],
                stickerswear: [0, 0.5, 0, 0],
                uid: 0
            }
        ])
    );

    expect(data?.items[0]).toStrictEqual({
        id: AK47_ID,
        stickers: {
            1: { id: FALLEN_COLOGNE_2015_ID, wear: 0.5 },
            3: { id: ALLU_COLOGNE_2015_ID, wear: undefined }
        }
    });
});

test("version 1 applies the same conversion to the items inside a storage unit", () => {
    const data = resolveInventoryData(
        JSON.stringify([
            {
                id: STORAGE_UNIT_ID,
                nametag: "my storage",
                storage: [
                    {
                        id: AK47_ID,
                        stickers: [FALLEN_COLOGNE_2015_ID],
                        stickerswear: [0.5],
                        uid: 7
                    }
                ],
                uid: 0
            }
        ])
    );

    expect(data?.items[0]).toStrictEqual({
        id: STORAGE_UNIT_ID,
        nameTag: "my storage",
        storage: {
            7: {
                id: AK47_ID,
                stickers: { 0: { id: FALLEN_COLOGNE_2015_ID, wear: 0.5 } }
            }
        }
    });
});

test("version 1 unequips patches, which version 0 wrongly allowed to be equipped", () => {
    const data = resolveInventoryData(
        JSON.stringify([
            { equipped: true, equippedCT: true, equippedT: true, id: BLOODHOUND_PATCH_ID, uid: 0 },
            { equipped: true, equippedCT: true, equippedT: true, id: AK47_ID, uid: 1 }
        ])
    );

    expect(data?.items[0]).toStrictEqual({
        equipped: undefined,
        equippedCT: undefined,
        equippedT: undefined,
        id: BLOODHOUND_PATCH_ID
    });
    expect(data?.items[1]).toStrictEqual({
        equipped: true,
        equippedCT: true,
        equippedT: true,
        id: AK47_ID
    });
});

test("a document already at the current version keeps its contents", () => {
    const data = { items: { 0: { id: AK47_ID, nameTag: "my rifle" } }, version: CS2_INVENTORY_VERSION };

    expect(resolveInventoryData(JSON.stringify(data))).toStrictEqual(data);
});

// Swallowing everything is what group 6 replaces with the typed `CS2InventoryError` hierarchy.
test("input that cannot be read as a document resolves to undefined", () => {
    expect(resolveInventoryData(undefined)).toBeUndefined();
    expect(resolveInventoryData("")).toBeUndefined();
    expect(resolveInventoryData("not json")).toBeUndefined();
});
