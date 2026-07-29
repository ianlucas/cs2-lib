/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, test } from "vitest";
import { CS2Economy } from "../economy.ts";
import { CS2InventoryDecodeError, decodeInventoryData } from "../inventory-format.ts";
import { CS2_ITEMS } from "../items.ts";
import { english } from "../translations/english.ts";
import { CS2_INVENTORY_VERSION, CS2_MIN_INVENTORY_VERSION, migrations } from "./index.ts";

CS2Economy.load({ items: CS2_ITEMS, language: english });

const AK47_ID = 4;
const ALLU_COLOGNE_2015_ID = 2268;
const AWP_ID = 6;
const BLOODHOUND_PATCH_ID = 8569;
const FALLEN_COLOGNE_2015_ID = 2226;
const STORAGE_UNIT_ID = 11262;

test("the ladder is the single source of the format's version numbers", () => {
    expect(CS2_INVENTORY_VERSION).toBe(2);
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
    const { data } = decodeInventoryData(
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
        // A version 0 document does not stop at the rung that reshaped it: the ladder runs to the end.
        version: 2
    });
});

test("version 1 renames the lowercased version 0 fields", () => {
    const { data } = decodeInventoryData(
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

    expect(data.items[0]).toStrictEqual({
        containerId: 9425,
        id: AK47_ID,
        nameTag: "my rifle",
        statTrak: 1337,
        updatedAt: 1707696138
    });
});

test("version 1 pairs the two sticker arrays into a record keyed by slot, dropping empty slots", () => {
    const { data } = decodeInventoryData(
        JSON.stringify([
            {
                id: AK47_ID,
                stickers: [0, FALLEN_COLOGNE_2015_ID, 0, ALLU_COLOGNE_2015_ID],
                stickerswear: [0, 0.5, 0, 0],
                uid: 0
            }
        ])
    );

    expect(data.items[0]).toStrictEqual({
        id: AK47_ID,
        stickers: {
            1: { id: FALLEN_COLOGNE_2015_ID, wear: 0.5 },
            3: { id: ALLU_COLOGNE_2015_ID, wear: undefined }
        }
    });
});

test("version 1 applies the same conversion to the items inside a storage unit", () => {
    const { data } = decodeInventoryData(
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

    expect(data.items[0]).toStrictEqual({
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
    const { data } = decodeInventoryData(
        JSON.stringify([
            { equipped: true, equippedCT: true, equippedT: true, id: BLOODHOUND_PATCH_ID, uid: 0 },
            { equipped: true, equippedCT: true, equippedT: true, id: AK47_ID, uid: 1 }
        ])
    );

    expect(data.items[0]).toStrictEqual({
        equipped: undefined,
        equippedCT: undefined,
        equippedT: undefined,
        id: BLOODHOUND_PATCH_ID
    });
    expect(data.items[1]).toStrictEqual({
        equipped: true,
        equippedCT: true,
        equippedT: true,
        id: AK47_ID
    });
});

test("version 2 wraps the upper half of the legacy 0-359 sticker rotation onto its negative equivalent", () => {
    const { data } = decodeInventoryData(
        JSON.stringify({
            items: {
                0: {
                    id: AK47_ID,
                    stickers: {
                        0: { id: FALLEN_COLOGNE_2015_ID, rotation: 270 },
                        1: { id: FALLEN_COLOGNE_2015_ID, rotation: 359 },
                        2: { id: FALLEN_COLOGNE_2015_ID, rotation: 181 },
                        3: { id: FALLEN_COLOGNE_2015_ID, rotation: 359.5 }
                    }
                }
            },
            version: 1
        })
    );

    expect(data.items[0]?.stickers).toStrictEqual({
        0: { id: FALLEN_COLOGNE_2015_ID, rotation: -90 },
        1: { id: FALLEN_COLOGNE_2015_ID, rotation: -1 },
        2: { id: FALLEN_COLOGNE_2015_ID, rotation: -179 },
        3: { id: FALLEN_COLOGNE_2015_ID, rotation: -0.5 }
    });
    expect(data.version).toBe(2);
});

test("version 2 leaves an angle the two encodings already agree on exactly where it is", () => {
    const { data } = decodeInventoryData(
        JSON.stringify({
            items: {
                0: {
                    id: AK47_ID,
                    stickers: {
                        // The lower half of 0-359 means the same angle in both encodings, and 180 is
                        // the one value the wrap must not touch: it is the maximum, not past it.
                        0: { id: FALLEN_COLOGNE_2015_ID, rotation: 0 },
                        1: { id: FALLEN_COLOGNE_2015_ID, rotation: 90.5 },
                        2: { id: FALLEN_COLOGNE_2015_ID, rotation: 180 }
                    }
                }
            },
            version: 1
        })
    );

    expect(data.items[0]?.stickers).toStrictEqual({
        0: { id: FALLEN_COLOGNE_2015_ID, rotation: 0 },
        1: { id: FALLEN_COLOGNE_2015_ID, rotation: 90.5 },
        2: { id: FALLEN_COLOGNE_2015_ID, rotation: 180 }
    });
});

test("version 2 snaps onto the half-degree grid before wrapping, so an off-grid legacy angle converts too", () => {
    const { data } = decodeInventoryData(
        JSON.stringify({
            items: { 0: { id: AK47_ID, stickers: { 0: { id: FALLEN_COLOGNE_2015_ID, rotation: 270.7 } } } },
            version: 1
        })
    );

    expect(data.items[0]?.stickers?.[0]?.rotation).toBe(-89.5);
});

test("version 2 wraps the stickers on an item sitting inside a storage unit", () => {
    const { data } = decodeInventoryData(
        JSON.stringify({
            items: {
                0: {
                    id: STORAGE_UNIT_ID,
                    storage: {
                        7: {
                            id: AK47_ID,
                            stickers: { 0: { id: FALLEN_COLOGNE_2015_ID, rotation: 270 } }
                        }
                    }
                }
            },
            version: 1
        })
    );

    expect(data.items[0]?.storage?.[7]?.stickers?.[0]?.rotation).toBe(-90);
});

test("a document already at the current version keeps its contents, and reports no rung ran", () => {
    const stored = { items: { 0: { id: AK47_ID, nameTag: "my rifle" } }, version: CS2_INVENTORY_VERSION };

    const { data, migratedFrom } = decodeInventoryData(JSON.stringify(stored));

    expect(data).toStrictEqual(stored);
    expect(migratedFrom).toBeUndefined();
});

test("the version a document arrived at is the one the report names", () => {
    expect(decodeInventoryData(JSON.stringify([{ id: AK47_ID, uid: 0 }])).migratedFrom).toBe(0);
    expect(decodeInventoryData(JSON.stringify({ items: {}, version: 1 })).migratedFrom).toBe(1);
});

test("input that cannot be read as a document is refused rather than swallowed", () => {
    expect(() => decodeInventoryData("")).toThrow(CS2InventoryDecodeError);
    expect(() => decodeInventoryData("not json")).toThrow(CS2InventoryDecodeError);
});
