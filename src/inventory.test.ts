/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, test } from "vitest";
import {
    CS2_MAX_KEYCHAIN_SEED,
    CS2_MAX_PATCHES,
    CS2_MAX_STATTRAK,
    CS2_MIN_KEYCHAIN_SEED
} from "./economy-constants.ts";
import { CS2Economy } from "./economy.ts";
import { CS2Inventory } from "./inventory.ts";
import { CS2_ITEMS } from "./items.ts";
import { CS2Team } from "./teams.ts";
import { english } from "./translations/english.ts";
import { ensure, float } from "./utils.ts";

const AK47_ID = 4;
const ALLU_COLOGNE_2015_ID = 2268;
const AWP_DRAGON_LORE_ID = 307;
const AWP_ID = 6;
const ESL_ONE_COLOGNE_2014_DUST_II_SOUVENIR_ID = 9148;
const FALLEN_COLOGNE_2015_ID = 2226;
const FIVE_YEAR_VETERAN_COIN_ID = 8683;
const KILOWATT_CASE_ID = 11422;
const KILOWATT_CASE_KEY_ID = 11423;
const M4A1_S_ID = 31;
const NAMETAG_ID = 11261;
const O00_THIEVES_2020_RMR_FOIL_ID = 6001;
const STATTRAK_SWAP_TOOL_ID = 11263;
const STORAGE_UNIT_ID = 11262;
const ZZ_NATION_RIO_2022_GLITTER_ID = 7306;
const ZZ_NATION_RIO_2022_GOLD_ID = 7308;
const ZZ_NATION_RIO_2022_HOLO_ID = 7307;
const ZZ_NATION_RIO_2022_ID = 7305;
const BUTTERFLY_KNIFE_CASE_HARDNED_ID = 1501;
const BUTTERFLY_KNIFE_BLUE_STEEL_ID = 1499;
const KARAMBIT_BOREAL_FOREST_ID = 1334;
const KARAMBIT_AUTOTRONIC_ID = 1356;
const USP_KILL_CONFIRMED_ID = 1139;
const USP_BLOOD_TIGER_ID = 1126;
const AWP_ELITE_BUILD_ID = 313;
const TKLIKSPHILIP_HEADING_FOR_THE_SOURCE_ID = 1841;
const AWOLNATION_I_AM_ID = 1801;
const BROKEN_FANG_GLOVES_ID = 56;
const BROKEN_FANG_GLOVES_JADE_ID = 1707;
const BLOODY_DARRYL_THE_STRAPPED_ID = 8657;
const BLOODHOUND_ID = 8569;
const CT_GLOVE_ID = 59;
const LIL_AVA_ID = 13113;

CS2Economy.load({ items: CS2_ITEMS, language: english });

describe("CS2Inventory methods", () => {
    let inventory: CS2Inventory;

    beforeEach(() => {
        inventory = new CS2Inventory({
            maxItems: 16,
            storageUnitMaxItems: 3
        });
    });

    test("size should return the number of items in the inventory", () => {
        expect(inventory.size()).toBe(0);
    });

    test("add should add items to the inventory", () => {
        inventory.add({ id: AWP_DRAGON_LORE_ID });
        expect(inventory.size()).toBe(1);
        expect(() => inventory.add({ id: BROKEN_FANG_GLOVES_ID })).toThrow();
        inventory.add({ id: BROKEN_FANG_GLOVES_JADE_ID });
        inventory.add({ id: CT_GLOVE_ID });
        expect(inventory.size()).toBe(3);
    });

    test("add should throw an error if the inventory is full", () => {
        for (let i = 0; i < inventory.options.maxItems; i++) {
            inventory.add({ id: AWP_DRAGON_LORE_ID });
        }
        expect(() => inventory.add({ id: AWP_DRAGON_LORE_ID })).toThrow();
    });

    test("get should return the item with the given id", () => {
        const item = {
            equipped: true,
            equippedCT: true,
            equippedT: true,
            id: AWP_DRAGON_LORE_ID,
            nameTag: "My Nametag",
            seed: 500,
            statTrak: 200,
            stickers: {
                0: { id: FALLEN_COLOGNE_2015_ID, schema: 0, wear: 0.1 },
                1: { id: FALLEN_COLOGNE_2015_ID, schema: 1, wear: 0.2 },
                2: { id: FALLEN_COLOGNE_2015_ID, schema: 2, wear: 0.3 },
                3: { id: FALLEN_COLOGNE_2015_ID, schema: 3, wear: 0.4 }
            },
            updatedAt: 100,
            wear: 0.5
        };
        inventory.add({ ...item });
        const result = inventory.get(0);
        expect(result.equipped).toBe(undefined);
        expect(result.equippedCT).toBe(undefined);
        expect(result.equippedT).toBe(undefined);
        expect(result.id).toBe(item.id);
        expect(result.nameTag).toBe(item.nameTag);
        expect(result.seed).toBe(item.seed);
        expect(result.statTrak).toBe(item.statTrak);
        expect(Object.fromEntries(ensure(result.stickers))).toEqual(item.stickers);
        expect(result.uid).toBe(0);
        expect(result.updatedAt).not.toBe(item.updatedAt);
        expect(result.wear).toBe(item.wear);
    });

    test("addWithNameTag should add items with nametags to the inventory", () => {
        inventory.add({ id: NAMETAG_ID }); // uid:0
        const args = [AK47_ID, "My Nametag"] as const;
        inventory.addWithNameTag(0, ...args); // uid:0
        expect(inventory.size()).toBe(1);
        const result = inventory.get(0);
        expect(result.id).toBe(AK47_ID);
        expect(result.equipped).toBe(undefined);
        expect(result.equippedCT).toBe(undefined);
        expect(result.equippedT).toBe(undefined);
        expect(result.id).toBe(args[0]);
        expect(result.nameTag).toBe(args[1]);
        expect(result.uid).toBe(0);
        expect(result.updatedAt).not.toBe(undefined);
    });

    test("addWithSticker should add items with stickers to the inventory", () => {
        inventory.add({ id: FALLEN_COLOGNE_2015_ID }); // uid:0
        const args = [AK47_ID, 2] as const; // the sticker anchors to markup schema 2
        inventory.addWithSticker(0, ...args); // uid:0
        expect(inventory.size()).toBe(1);
        const result = inventory.get(0);
        expect(result.id).toBe(AK47_ID);
        expect(result.equipped).toBe(undefined);
        expect(result.equippedCT).toBe(undefined);
        expect(result.equippedT).toBe(undefined);
        expect(result.id).toBe(args[0]);
        expect(Object.fromEntries(ensure(result.stickers))).toEqual({ 0: { id: FALLEN_COLOGNE_2015_ID, schema: 2 } });
        expect(result.uid).toBe(0);
        expect(result.updatedAt).not.toBe(undefined);
    });

    test("edit should edit the item with the given id", () => {
        const originalItem = {
            id: AWP_DRAGON_LORE_ID,
            nameTag: "My Nametag",
            seed: 500,
            statTrak: 200,
            stickers: {
                0: { id: FALLEN_COLOGNE_2015_ID, wear: 0.1 },
                1: { id: FALLEN_COLOGNE_2015_ID, wear: 0.2 },
                2: { id: FALLEN_COLOGNE_2015_ID, wear: 0.3 },
                3: { id: FALLEN_COLOGNE_2015_ID, wear: 0.4 }
            },
            wear: 0.5
        };
        const editedItem = {
            nameTag: "My New Nametag",
            seed: 600,
            statTrak: 300,
            stickers: {
                0: { id: ALLU_COLOGNE_2015_ID, wear: 0.5 },
                2: { id: ALLU_COLOGNE_2015_ID, wear: 0.7 }
            },
            wear: 0.7
        };
        inventory.add({ ...originalItem }); // uid:0
        inventory.edit(0, { ...editedItem });
        const result = inventory.get(0);
        expect(result.nameTag).toBe(editedItem.nameTag);
        expect(result.seed).toBe(editedItem.seed);
        expect(result.statTrak).toBe(editedItem.statTrak);
        // The sparse {0,2} edit reflows to contiguous {0,1}, pinning each schema to its old key.
        expect(Object.fromEntries(ensure(result.stickers))).toEqual({
            0: { id: ALLU_COLOGNE_2015_ID, schema: 0, wear: 0.5 },
            1: { id: ALLU_COLOGNE_2015_ID, schema: 2, wear: 0.7 }
        });
        expect(result.wear).toBe(editedItem.wear);
    });

    test("equip should equip the item with the given id", () => {
        inventory.add({ id: AK47_ID }); // uid:0
        inventory.equip(0, CS2Team.T);
        expect(() => inventory.equip(0)).toThrow();
        expect(() => inventory.equip(0, CS2Team.CT)).toThrow();
        expect(inventory.get(0).equippedT).toBe(true);
        expect(inventory.get(0).equippedCT).toBe(undefined);
        expect(inventory.get(0).equipped).toBe(undefined);
        inventory.add({ id: M4A1_S_ID }); // uid:1
        inventory.equip(1, CS2Team.CT);
        expect(() => inventory.equip(1)).toThrow();
        expect(() => inventory.equip(1, CS2Team.T)).toThrow();
        expect(inventory.get(1).equippedCT).toBe(true);
        expect(inventory.get(1).equippedT).toBe(undefined);
        expect(inventory.get(1).equipped).toBe(undefined);
        inventory.add({ id: AWP_ID }); // uid:2
        inventory.equip(2, CS2Team.CT);
        inventory.equip(2, CS2Team.T);
        expect(() => inventory.equip(2)).toThrow();
        expect(inventory.get(2).equippedCT).toBe(true);
        expect(inventory.get(2).equippedT).toBe(true);
        expect(inventory.get(2).equipped).toBe(undefined);
        inventory.add({ id: FIVE_YEAR_VETERAN_COIN_ID }); // uid:3
        inventory.equip(3);
        expect(() => inventory.equip(3, CS2Team.T)).toThrow();
        expect(() => inventory.equip(3, CS2Team.CT)).toThrow();
        expect(inventory.get(3).equipped).toBe(true);
        expect(inventory.get(3).equippedCT).toBe(undefined);
        expect(inventory.get(3).equippedT).toBe(undefined);
        inventory.add({ id: AK47_ID }); // uid:4
        inventory.equip(4, CS2Team.T);
        expect(inventory.get(0).equippedT).toBe(undefined);
        expect(inventory.get(4).equippedT).toBe(true);
        inventory.add({ id: M4A1_S_ID }); // uid:5
        inventory.equip(5, CS2Team.CT);
        expect(inventory.get(1).equippedCT).toBe(undefined);
        expect(inventory.get(5).equippedCT).toBe(true);
        inventory.add({ id: FIVE_YEAR_VETERAN_COIN_ID }); // uid:6
        inventory.equip(6);
        expect(inventory.get(3).equipped).toBe(undefined);
        expect(inventory.get(6).equipped).toBe(true);
    });

    test("unequip should unequip the item with the given id", () => {
        inventory.add({ id: AK47_ID }); // uid:0
        inventory.equip(0, CS2Team.T);
        inventory.unequip(0, CS2Team.T);
        expect(inventory.get(0).equippedT).toBe(undefined);
        expect(inventory.get(0).equippedCT).toBe(undefined);
        expect(inventory.get(0).equipped).toBe(undefined);
        inventory.add({ id: M4A1_S_ID }); // uid:1
        inventory.equip(1, CS2Team.CT);
        inventory.unequip(1, CS2Team.CT);
        expect(inventory.get(1).equippedCT).toBe(undefined);
        expect(inventory.get(1).equippedT).toBe(undefined);
        expect(inventory.get(1).equipped).toBe(undefined);
        inventory.add({ id: AWP_ID }); // uid:2
        inventory.equip(2, CS2Team.CT);
        inventory.equip(2, CS2Team.T);
        inventory.unequip(2, CS2Team.CT);
        inventory.unequip(2, CS2Team.T);
        expect(inventory.get(2).equippedCT).toBe(undefined);
        expect(inventory.get(2).equippedT).toBe(undefined);
        expect(inventory.get(2).equipped).toBe(undefined);
        inventory.add({ id: FIVE_YEAR_VETERAN_COIN_ID }); // uid:3
        inventory.equip(3);
        inventory.unequip(3);
        expect(inventory.get(3).equipped).toBe(undefined);
        expect(inventory.get(3).equippedCT).toBe(undefined);
        expect(inventory.get(3).equippedT).toBe(undefined);
    });

    test("unlockCase should unlock a case and add the items to the inventory", () => {
        inventory.add({ id: ESL_ONE_COLOGNE_2014_DUST_II_SOUVENIR_ID }); // uid:0
        inventory.add({ id: KILOWATT_CASE_ID }); // uid:1
        inventory.add({ id: KILOWATT_CASE_KEY_ID }); // uid:2
        const unlocked1 = CS2Economy.getById(ESL_ONE_COLOGNE_2014_DUST_II_SOUVENIR_ID).unlockContainer();
        expect(() => inventory.unlockContainer(unlocked1, 0, 2)).toThrow();
        inventory.unlockContainer(unlocked1, 0); // uid:0
        expect(inventory.size()).toBe(3);
        const result1 = inventory.get(0);
        expect(result1.containerId).toBe(unlocked1.attributes.containerId);
        expect(result1.id).toBe(unlocked1.id);
        expect(result1.equipped).toBe(undefined);
        expect(result1.equippedCT).toBe(undefined);
        expect(result1.equippedT).toBe(undefined);
        expect(result1.id).toBe(unlocked1.id);
        expect(result1.seed).toBe(unlocked1.attributes.seed);
        expect(result1.statTrak).toBe(unlocked1.attributes.statTrak);
        expect(result1.uid).toBe(0);
        expect(result1.updatedAt).not.toBe(undefined);
        expect(result1.wear).toEqual(unlocked1.attributes.wear);
        const unlocked2 = CS2Economy.getById(KILOWATT_CASE_ID).unlockContainer();
        inventory.unlockContainer(unlocked2, 1, 2); // uid:1
        expect(inventory.size()).toBe(2);
        const result2 = inventory.get(1);
        expect(result2.containerId).toBe(unlocked2.attributes.containerId);
        expect(result2.id).toBe(unlocked2.id);
        expect(result2.equipped).toBe(undefined);
        expect(result2.equippedCT).toBe(undefined);
        expect(result2.equippedT).toBe(undefined);
        expect(result2.id).toBe(unlocked2.id);
        expect(result2.seed).toBe(unlocked2.attributes.seed);
        expect(result2.statTrak).toBe(unlocked2.attributes.statTrak);
        expect(result2.uid).toBe(1);
        expect(result2.updatedAt).not.toBe(undefined);
        expect(result2.wear).toEqual(unlocked2.attributes.wear);
    });

    test("renameItem should rename the item with the given id", () => {
        inventory.add({ id: NAMETAG_ID }); // uid:0
        inventory.add({ id: AK47_ID, nameTag: "My Nametag" }); // uid:1
        inventory.renameItem(0, 1, "My New Nametag");
        expect(inventory.size()).toBe(1);
        const result = inventory.get(1);
        expect(result.nameTag).toBe("My New Nametag");
    });

    test("renameStorageUnit should rename the storage unit with the given id", () => {
        inventory.add({ id: STORAGE_UNIT_ID }); // uid:0
        expect(inventory.get(0).nameTag).toBe(undefined);
        inventory.renameStorageUnit(0, "Storage Unit");
        expect(inventory.size()).toBe(1);
        expect(inventory.get(0).nameTag).toBe("Storage Unit");
        inventory.renameStorageUnit(0, "New Storage Unit");
        expect(inventory.get(0).nameTag).toBe("New Storage Unit");
    });

    test("storage unit interactions", () => {
        inventory.add({ id: STORAGE_UNIT_ID }); // uid:0
        inventory.add({ id: STORAGE_UNIT_ID }); // uid:1
        inventory.add({ id: AWP_DRAGON_LORE_ID, statTrak: 1 }); // uid:2
        inventory.add({ id: AWP_DRAGON_LORE_ID, statTrak: 2 }); // uid:3
        inventory.add({ id: AWP_DRAGON_LORE_ID, statTrak: 3 }); // uid:4
        inventory.add({ id: AWP_DRAGON_LORE_ID, statTrak: 4 }); // uid:5
        inventory.add({ id: AWP_DRAGON_LORE_ID, statTrak: 5 }); // uid:6
        expect(inventory.size()).toBe(7);
        expect(inventory.isStorageUnitFull(0)).toBe(false);
        expect(inventory.isStorageUnitFilled(0)).toBe(false);
        expect(inventory.canDepositToStorageUnit(0)).toBe(false);
        expect(() => inventory.depositToStorageUnit(0, [2])).toThrow();
        inventory.renameStorageUnit(0, "My Storage Unit");
        expect(inventory.get(0).nameTag).toBe("My Storage Unit");
        expect(() => inventory.retrieveFromStorageUnit(0, [0])).toThrow();
        expect(() => inventory.depositToStorageUnit(0, [])).toThrow();
        expect(() => inventory.depositToStorageUnit(0, [1])).toThrow();
        expect(() => inventory.depositToStorageUnit(0, [7])).toThrow();
        inventory.depositToStorageUnit(0, [2, 3]);
        expect(inventory.size()).toBe(5);
        expect(inventory.getStorageUnitSize(0)).toBe(2);
        expect(inventory.getStorageUnitItems(0)[0]?.uid).toBe(0);
        expect(inventory.getStorageUnitItems(0)[0]?.statTrak).toBe(1);
        expect(inventory.getStorageUnitItems(0)[1]?.uid).toBe(1);
        expect(inventory.getStorageUnitItems(0)[1]?.statTrak).toBe(2);
        expect(inventory.isStorageUnitFull(0)).toBe(false);
        expect(() => inventory.depositToStorageUnit(0, [3, 4])).toThrow();
        inventory.depositToStorageUnit(0, [4]);
        expect(inventory.size()).toBe(4);
        expect(inventory.getStorageUnitSize(0)).toBe(3);
        expect(inventory.isStorageUnitFull(0)).toBe(true);
        expect(() => inventory.retrieveFromStorageUnit(0, [])).toThrow();
        expect(() => inventory.retrieveFromStorageUnit(0, [0, 99])).toThrow();
        inventory.retrieveFromStorageUnit(0, [1]); // uid:2
        expect(inventory.size()).toBe(5);
        expect(inventory.get(2).statTrak).toBe(2);
        expect(inventory.getStorageUnitSize(0)).toBe(2);
    });

    test("applyItemSticker should apply a sticker to the item with the given id", () => {
        inventory.add({ id: ZZ_NATION_RIO_2022_ID }); // uid:0
        inventory.add({ id: ZZ_NATION_RIO_2022_HOLO_ID }); // uid:1
        inventory.add({ id: ZZ_NATION_RIO_2022_GOLD_ID }); // uid:2
        inventory.add({ id: O00_THIEVES_2020_RMR_FOIL_ID }); // uid:3
        inventory.add({ id: AWP_DRAGON_LORE_ID }); // uid:4
        // Can't apply a sticker onto a non-stickerable item (uid:0 is itself a sticker).
        expect(() => inventory.applyItemSticker(0, 1)).toThrow();
        expect(inventory.get(4).stickers).toBe(undefined);
        // Each application appends the sticker and auto-assigns the next free markup schema.
        for (let index = 0; index < 4; index++) {
            const expectedId = inventory.get(index).id;
            inventory.applyItemSticker(4, index);
            expect(inventory.size()).toBe(4 - index);
            expect(inventory.get(4).stickers?.get(index)?.id).toBe(expectedId);
            expect(inventory.get(4).stickers?.get(index)?.schema).toBe(index);
        }
        inventory.add({ id: ZZ_NATION_RIO_2022_GLITTER_ID }); // uid:0
        // Schemas outside the weapon's markup range are rejected (legacy AWP defines 5 slots).
        expect(() => inventory.applyItemSticker(4, 0, 5)).toThrow();
        expect(() => inventory.applyItemSticker(4, 0, -1)).toThrow();
        expect(() => inventory.applyItemSticker(4, 0, NaN)).toThrow();
        // A fifth sticker is allowed (cap is CS2_MAX_STICKERS) and may double up a schema.
        inventory.applyItemSticker(4, 0, 1);
        expect(inventory.get(4).stickers?.get(4)?.schema).toBe(1);
        expect(inventory.get(4).getStickersCount()).toBe(5);
        // A sixth exceeds the cap.
        inventory.add({ id: ZZ_NATION_RIO_2022_GLITTER_ID }); // uid:0
        expect(() => inventory.applyItemSticker(4, 0)).toThrow();
    });

    test("scrapeItemSticker should scrape a sticker from the item with the given id", () => {
        inventory.add({
            id: AWP_DRAGON_LORE_ID,
            stickers: {
                0: { id: ZZ_NATION_RIO_2022_GLITTER_ID },
                1: { id: ZZ_NATION_RIO_2022_HOLO_ID }
            }
        });
        expect(() => inventory.scrapeItemSticker(0, -5)).toThrow();
        expect(() => inventory.scrapeItemSticker(0, NaN)).toThrow();
        // Default scrape steps wear by CS2_STICKER_WEAR_FACTOR (0.01).
        for (let scrape = 1; scrape <= 9; scrape++) {
            inventory.scrapeItemSticker(0, 0);
            expect(inventory.get(0).stickers?.get(0)?.wear).toBe(float(0.01 * scrape));
        }
        // The explicit-wear slider must move strictly above the current wear.
        expect(() => inventory.scrapeItemSticker(0, 0, 0.05)).toThrow();
        inventory.scrapeItemSticker(0, 0, 0.5);
        expect(inventory.get(0).stickers?.get(0)?.wear).toBe(0.5);
        // Reaching wear 1 removes the sticker; the one below reflows to index 0.
        inventory.scrapeItemSticker(0, 0, 1);
        expect(inventory.get(0).stickers?.get(0)?.id).toBe(ZZ_NATION_RIO_2022_HOLO_ID);
        expect(inventory.get(0).stickers?.get(1)).toBe(undefined);
        // Default-scraping the last sticker past 1 clears the map entirely.
        inventory.edit(0, { stickers: { 0: { id: ZZ_NATION_RIO_2022_HOLO_ID, wear: 0.99 } } });
        inventory.scrapeItemSticker(0, 0);
        expect(inventory.get(0).stickers).toBe(undefined);
    });

    test("removeItemSticker removes a sticker and reflows the indices", () => {
        inventory.add({
            id: AWP_DRAGON_LORE_ID,
            stickers: {
                0: { id: ZZ_NATION_RIO_2022_ID },
                1: { id: ZZ_NATION_RIO_2022_HOLO_ID },
                2: { id: ZZ_NATION_RIO_2022_GOLD_ID }
            }
        });
        expect(() => inventory.removeItemSticker(0, 3)).toThrow();
        inventory.removeItemSticker(0, 1);
        const stickers = ensure(inventory.get(0).stickers);
        expect(stickers.size).toBe(2);
        expect(stickers.get(0)).toMatchObject({ id: ZZ_NATION_RIO_2022_ID, schema: 0 });
        // The survivor from index 2 reflows to index 1 but keeps its markup schema (2).
        expect(stickers.get(1)).toMatchObject({ id: ZZ_NATION_RIO_2022_GOLD_ID, schema: 2 });
    });

    test("moveItemSticker reorders draw order while preserving each schema", () => {
        inventory.add({
            id: AWP_DRAGON_LORE_ID,
            stickers: {
                0: { id: ZZ_NATION_RIO_2022_ID },
                1: { id: ZZ_NATION_RIO_2022_HOLO_ID },
                2: { id: ZZ_NATION_RIO_2022_GOLD_ID }
            }
        });
        inventory.moveItemSticker(0, 2, 0); // send the top sticker to the back
        const stickers = ensure(inventory.get(0).stickers);
        expect(stickers.get(0)).toMatchObject({ id: ZZ_NATION_RIO_2022_GOLD_ID, schema: 2 });
        expect(stickers.get(1)).toMatchObject({ id: ZZ_NATION_RIO_2022_ID, schema: 0 });
        expect(stickers.get(2)).toMatchObject({ id: ZZ_NATION_RIO_2022_HOLO_ID, schema: 1 });
        expect(() => inventory.moveItemSticker(0, 0, 3)).toThrow();
    });

    test("editItemSticker updates a sticker in place and validates it", () => {
        inventory.add({
            id: AWP_DRAGON_LORE_ID,
            stickers: { 0: { id: ZZ_NATION_RIO_2022_ID } }
        });
        inventory.editItemSticker(0, 0, { schema: 3, wear: 0.5, x: 0.1, y: -0.05, rotation: 90 });
        expect(inventory.get(0).stickers?.get(0)).toMatchObject({
            id: ZZ_NATION_RIO_2022_ID,
            schema: 3,
            wear: 0.5,
            x: 0.1,
            y: -0.05,
            rotation: 90
        });
        // Out-of-range schema (legacy AWP defines 5 slots) is rejected.
        expect(() => inventory.editItemSticker(0, 0, { schema: 5 })).toThrow();
        // Swapping in a non-sticker id is rejected.
        expect(() => inventory.editItemSticker(0, 0, { id: AWP_DRAGON_LORE_ID })).toThrow();
        // An offset outside the model's published envelope is rejected (AWP legacy Y max ≈ 0.1415).
        expect(() => inventory.editItemSticker(0, 0, { y: -0.2 })).toThrow();
        // An over-precise offset (more than the factor's 4 decimals) is rejected.
        expect(() => inventory.editItemSticker(0, 0, { x: 0.12345 })).toThrow();
    });

    test("incrementItemStatTrak should increment the StatTrak count of the item with the given id", () => {
        inventory.add({ id: AWP_DRAGON_LORE_ID });
        expect(inventory.get(0).statTrak).toBe(undefined);
        expect(() => inventory.incrementItemStatTrak(0)).toThrow();
        inventory.add({ id: AWP_DRAGON_LORE_ID, statTrak: 0 });
        expect(inventory.get(1).statTrak).toBe(0);
        inventory.incrementItemStatTrak(1);
        expect(inventory.get(1).statTrak).toBe(1);
        inventory.add({ id: AWP_DRAGON_LORE_ID, statTrak: CS2_MAX_STATTRAK - 1 });
        inventory.incrementItemStatTrak(2);
        inventory.incrementItemStatTrak(2);
        expect(inventory.get(2).statTrak).toBe(CS2_MAX_STATTRAK);
    });

    test("swapItemsStatTrak should swap the StatTrak count of the items with the given ids", () => {
        inventory.add({ id: STATTRAK_SWAP_TOOL_ID }); // uid:0
        inventory.add({ id: AWP_DRAGON_LORE_ID, statTrak: 0 }); // uid:1
        inventory.add({ id: AWP_DRAGON_LORE_ID, statTrak: 2556 }); // uid:2
        inventory.swapItemsStatTrak(0, 1, 2);
        expect(inventory.get(2).statTrak).toBe(0);
        expect(inventory.get(1).statTrak).toBe(2556);
        inventory.removeAll();
        inventory.add({ id: STATTRAK_SWAP_TOOL_ID }); // uid:0
        inventory.add({ id: AWP_DRAGON_LORE_ID, statTrak: 0 }); // uid:1
        inventory.add({ id: AWP_DRAGON_LORE_ID, statTrak: 2556 }); // uid:2
        inventory.swapItemsStatTrak(0, 2, 1);
        expect(inventory.get(2).statTrak).toBe(0);
        expect(inventory.get(1).statTrak).toBe(2556);
        inventory.removeAll();
        inventory.add({ id: STATTRAK_SWAP_TOOL_ID }); // uid:0
        inventory.add({ id: AWP_DRAGON_LORE_ID }); // uid:1
        inventory.add({ id: AWP_DRAGON_LORE_ID, statTrak: 2556 }); // uid:2
        expect(() => inventory.swapItemsStatTrak(0, 1, 2)).toThrow();
        inventory.removeAll();
        for (let i = 0; i < 5; i++) {
            inventory.add({ id: STATTRAK_SWAP_TOOL_ID }); // uid:0-4
        }
        inventory.add({ id: BUTTERFLY_KNIFE_CASE_HARDNED_ID, statTrak: 10 }); // uid:5
        inventory.add({ id: BUTTERFLY_KNIFE_BLUE_STEEL_ID, statTrak: 9 }); // uid:6
        inventory.add({ id: KARAMBIT_BOREAL_FOREST_ID, statTrak: 8 }); // uid:7
        inventory.add({ id: KARAMBIT_AUTOTRONIC_ID, statTrak: 7 }); // uid:8
        inventory.add({ id: USP_KILL_CONFIRMED_ID, statTrak: 1 }); // uid:9
        inventory.add({ id: USP_BLOOD_TIGER_ID, statTrak: 2 }); // uid:10
        inventory.add({ id: AWP_DRAGON_LORE_ID, statTrak: 3 }); // uid:11
        inventory.add({ id: AWP_ELITE_BUILD_ID, statTrak: 4 }); // uid:12
        inventory.add({ id: TKLIKSPHILIP_HEADING_FOR_THE_SOURCE_ID, statTrak: 5 }); // uid:13
        inventory.add({ id: AWOLNATION_I_AM_ID, statTrak: 6 }); // uid:14
        const initialSize = inventory.size();
        for (let i = 5; i < 15; i += 2) {
            for (let j = 5; j < 15; j++) {
                if (j === i || j === i + 1) continue;
                expect(() => inventory.swapItemsStatTrak(0, i, j)).toThrow();
            }
        }
        expect(() => inventory.swapItemsStatTrak(14, 13, 12)).toThrow();
        expect(() => inventory.swapItemsStatTrak(0, 14, 14)).toThrow();
        for (let i = 5; i < 15; i += 2) {
            const from = inventory.get(i).statTrak;
            const to = inventory.get(i + 1).statTrak;
            inventory.swapItemsStatTrak((i - 5) / 2, i, i + 1);
            expect(inventory.get(i).statTrak).toBe(to);
            expect(inventory.get(i + 1).statTrak).toBe(from);
        }
        expect(inventory.size()).toBe(initialSize - 5);
    });

    test("remove should remove the item with the given id", () => {
        inventory.add({ id: AWP_DRAGON_LORE_ID }); // uid:0
        inventory.add({ id: AWP_DRAGON_LORE_ID }); // uid:1
        inventory.remove(0);
        expect(inventory.size()).toBe(1);
        inventory.remove(1);
        expect(inventory.size()).toBe(0);
    });

    test("removeAll should remove all items from the inventory", () => {
        inventory.add({ id: AWP_DRAGON_LORE_ID }); // uid:0
        inventory.add({ id: AWP_DRAGON_LORE_ID }); // uid:1
        inventory.removeAll();
        expect(inventory.size()).toBe(0);
    });

    test("uid", () => {
        inventory.add({ id: AWP_DRAGON_LORE_ID, statTrak: 1 }); // uid:0
        inventory.add({ id: AWP_DRAGON_LORE_ID, statTrak: 2 }); // uid:1
        inventory.remove(0);
        inventory.add({ id: AWP_DRAGON_LORE_ID, statTrak: 3 }); // uid:0
        expect(inventory.size()).toBe(2);
        expect(inventory.get(0).statTrak).toBe(3);
        inventory.removeAll();
        inventory.add({ id: AWP_DRAGON_LORE_ID, statTrak: 4 }); // uid:0
        expect(inventory.size()).toBe(1);
        expect(inventory.get(0).statTrak).toBe(4);
    });

    test("storage unit uid", () => {
        inventory.add({ id: STORAGE_UNIT_ID }); // uid:0
        inventory.add({ id: AWP_DRAGON_LORE_ID, statTrak: 1 }); // uid:1
        inventory.add({ id: AWP_DRAGON_LORE_ID, statTrak: 2 }); // uid:2
        inventory.add({ id: AWP_DRAGON_LORE_ID, statTrak: 3 }); // uid:3
        inventory.renameStorageUnit(0, "My Storage Unit");
        inventory.depositToStorageUnit(0, [1, 2, 3]);
        expect(inventory.getStorageUnitSize(0)).toBe(3);
        for (const [uid, item] of inventory.getStorageUnitItems(0).entries()) {
            expect(item.uid).toBe(uid);
        }
        inventory.retrieveFromStorageUnit(0, [1]);
        expect(inventory.getStorageUnitSize(0)).toBe(2);
        expect(inventory.getStorageUnitItems(0)[0]?.uid).toBe(0);
        expect(inventory.getStorageUnitItems(0)[1]?.uid).toBe(2);
        inventory.depositToStorageUnit(0, [1]);
        const storage = inventory.get(0).storage!;
        for (let uid = 0; uid < 3; uid++) {
            expect(storage.get(uid)!.statTrak).toBe(uid + 1);
        }
    });

    test("apply and remove patches", () => {
        inventory.add({ id: BLOODY_DARRYL_THE_STRAPPED_ID }); // 0
        inventory.add({ id: BLOODHOUND_ID }); // 1
        inventory.add({ id: BLOODHOUND_ID }); // 2
        inventory.add({ id: BLOODHOUND_ID }); // 3
        inventory.add({ id: BLOODHOUND_ID }); // 4
        inventory.add({ id: BLOODHOUND_ID }); // 5
        expect(() => inventory.applyItemPatch(0, 1, -1)).toThrow();
        expect(() => inventory.applyItemPatch(0, 1, CS2_MAX_PATCHES)).toThrow();
        for (let uid = 1; uid < 1 + 5; uid++) {
            const index = uid - 1;
            inventory.applyItemPatch(0, uid, index);
            expect(inventory.get(0).patches?.get(index)).toBe(BLOODHOUND_ID);
        }
        expect(() => inventory.removeItemPatch(0, -1)).toThrow();
        expect(() => inventory.removeItemPatch(0, CS2_MAX_PATCHES)).toThrow();
        for (let uid = 1; uid < 1 + 5; uid++) {
            const index = uid - 1;
            inventory.removeItemPatch(0, index);
            expect(inventory.get(0).patches?.get(index)).toBe(undefined);
        }
        expect(inventory.get(0).patches).toBe(undefined);
        const patches = {
            0: BLOODHOUND_ID,
            1: BLOODHOUND_ID,
            2: BLOODHOUND_ID,
            3: BLOODHOUND_ID,
            4: BLOODHOUND_ID
        };
        expect(() =>
            inventory.add({
                id: BLOODY_DARRYL_THE_STRAPPED_ID,
                patches: {
                    [-1]: BLOODHOUND_ID,
                    ...patches
                }
            })
        ).toThrow();
        expect(() =>
            inventory.add({
                id: BLOODY_DARRYL_THE_STRAPPED_ID,
                patches: {
                    ...patches,
                    5: BLOODHOUND_ID
                }
            })
        ).toThrow();
        inventory.add({
            id: BLOODY_DARRYL_THE_STRAPPED_ID,
            patches
        });
        expect(Object.fromEntries(ensure(inventory.get(1).patches))).toEqual(patches);
    });

    test("removes invalid item references", () => {
        inventory = new CS2Inventory({
            data: {
                items: {
                    0: {
                        id: 999999999
                    },
                    1: {
                        id: 8657,
                        patches: {
                            0: 999999999,
                            1: 8559,
                            2: 8561
                        }
                    },
                    2: {
                        id: 66,
                        stickers: {
                            0: { id: 1943, wear: 0.1 },
                            1: { id: 999999999 },
                            2: { id: 1947, wear: 0.1 }
                        }
                    }
                },
                version: 1
            }
        });

        expect(inventory.size()).toBe(2);
        expect(inventory.get(1).patches?.get(0)).toBe(undefined);
        expect(inventory.get(1).patches?.get(1)).toBe(8559);
        expect(inventory.get(1).patches?.get(2)).toBe(8561);
        // The invalid sticker at slot 1 is dropped; slot 2 reflows to index 1 but keeps schema 2.
        expect(inventory.get(2).stickers?.get(0)).toMatchObject({ id: 1943, schema: 0, wear: 0.1 });
        expect(inventory.get(2).stickers?.get(1)).toMatchObject({ id: 1947, schema: 2, wear: 0.1 });
        expect(inventory.get(2).stickers?.get(2)).toBe(undefined);
    });

    test("add keychain", () => {
        inventory = new CS2Inventory({
            data: {
                items: {
                    0: {
                        id: LIL_AVA_ID
                    },
                    1: {
                        id: AWP_DRAGON_LORE_ID,
                        keychains: {
                            0: {
                                id: LIL_AVA_ID,
                                seed: 2000
                            }
                        }
                    }
                },
                version: 1
            }
        });
        expect(inventory.get(0).id).toBe(LIL_AVA_ID);
        expect(inventory.get(1).keychains?.get(0)).toMatchObject({
            id: LIL_AVA_ID,
            seed: 2000
        });
        expect(() =>
            inventory.add({
                id: LIL_AVA_ID,
                seed: CS2_MIN_KEYCHAIN_SEED - 1
            })
        ).toThrow();
        expect(() =>
            inventory.add({
                id: LIL_AVA_ID,
                seed: CS2_MAX_KEYCHAIN_SEED + 1
            })
        ).toThrow();
        // Regression test
        expect(() =>
            inventory.add({
                id: AWP_DRAGON_LORE_ID,
                seed: CS2_MAX_KEYCHAIN_SEED / 2
            })
        ).toThrow();
        inventory.add({
            id: LIL_AVA_ID,
            seed: CS2_MAX_KEYCHAIN_SEED / 2
        });
        expect(inventory.get(2).id).toBe(LIL_AVA_ID);
        expect(inventory.get(2).seed).toBe(CS2_MAX_KEYCHAIN_SEED / 2);
        inventory.add({
            id: AWP_DRAGON_LORE_ID,
            keychains: {
                0: {
                    id: LIL_AVA_ID,
                    seed: 2000,
                    x: 0.2223,
                    y: 0.2211,
                    z: 0.2211
                }
            }
        });
        expect(inventory.get(3).keychains?.get(0)).toMatchObject({
            id: LIL_AVA_ID,
            seed: 2000,
            x: 0.2223,
            y: 0.2211,
            z: 0.2211
        });
    });

    test("keychain z offset regression", () => {
        const keychainWithCoords = (coords: { x?: number; y?: number; z?: number }) => () =>
            inventory.add({
                id: AWP_DRAGON_LORE_ID,
                keychains: { 0: { id: LIL_AVA_ID, ...coords } }
            });
        expect(keychainWithCoords({ x: 22.078 })).not.toThrow();
        expect(keychainWithCoords({ y: 22.078 })).not.toThrow();
        expect(keychainWithCoords({ z: 22.078 })).not.toThrow();
        expect(keychainWithCoords({ x: NaN })).toThrow();
        expect(keychainWithCoords({ y: NaN })).toThrow();
        expect(keychainWithCoords({ z: NaN })).toThrow();
    });

    test("heals items carrying attributes their type cannot hold without bricking the inventory", () => {
        inventory = new CS2Inventory({
            data: {
                items: {
                    // Valid item that must survive alongside the bad ones.
                    0: { id: AWP_DRAGON_LORE_ID },
                    // Knife cannot hold stickers.
                    1: { id: KARAMBIT_BOREAL_FOREST_ID, stickers: { 0: { id: FALLEN_COLOGNE_2015_ID } } },
                    // Non-agent (weapon) cannot hold patches.
                    2: { id: AK47_ID, patches: { 0: BLOODHOUND_ID } },
                    // Knife cannot hold keychains.
                    3: { id: KARAMBIT_BOREAL_FOREST_ID, keychains: { 0: { id: LIL_AVA_ID } } },
                    // Wear below wearMin gets clamped up to wearMin.
                    4: { id: BROKEN_FANG_GLOVES_JADE_ID, wear: 0.01 },
                    // Wear above wearMax gets clamped down to wearMax.
                    5: { id: BROKEN_FANG_GLOVES_JADE_ID, wear: 0.9 },
                    // Wear on a type without wear gets dropped.
                    6: { id: BLOODY_DARRYL_THE_STRAPPED_ID, wear: 0.5 },
                    // Wear with excess precision gets dropped.
                    7: { id: BROKEN_FANG_GLOVES_JADE_ID, wear: 0.123456789 }
                },
                version: 1
            }
        });
        expect(inventory.size()).toBe(8);
        expect(inventory.get(0).id).toBe(AWP_DRAGON_LORE_ID);
        expect(inventory.get(1).stickers).toBe(undefined);
        expect(inventory.get(2).patches).toBe(undefined);
        expect(inventory.get(3).keychains).toBe(undefined);
        expect(inventory.get(4).wear).toBe(0.06);
        expect(inventory.get(5).wear).toBe(0.8);
        expect(inventory.get(6).wear).toBe(undefined);
        expect(inventory.get(7).wear).toBe(undefined);
    });

    test("edit throws when writing attributes an item type cannot hold", () => {
        inventory.add({ id: KARAMBIT_BOREAL_FOREST_ID });
        inventory.add({ id: AK47_ID });
        inventory.add({ id: BROKEN_FANG_GLOVES_JADE_ID });
        const knifeUid = 0;
        const weaponUid = 1;
        const glovesUid = 2;
        // Knife cannot hold stickers or keychains.
        expect(() => inventory.edit(knifeUid, { stickers: { 0: { id: FALLEN_COLOGNE_2015_ID } } })).toThrow();
        expect(() => inventory.edit(knifeUid, { keychains: { 0: { id: LIL_AVA_ID } } })).toThrow();
        // Non-agent (weapon) cannot hold patches.
        expect(() => inventory.edit(weaponUid, { patches: { 0: BLOODHOUND_ID } })).toThrow();
        // Wear outside [wearMin, wearMax] is rejected.
        expect(() => inventory.edit(glovesUid, { wear: 0.01 })).toThrow();
        expect(() => inventory.edit(glovesUid, { wear: 0.9 })).toThrow();
        // The invalid writes must not have mutated the items.
        expect(inventory.get(knifeUid).stickers).toBe(undefined);
        expect(inventory.get(knifeUid).keychains).toBe(undefined);
        expect(inventory.get(weaponUid).patches).toBe(undefined);
        expect(inventory.get(glovesUid).wear).toBe(undefined);
        // A valid edit still goes through.
        inventory.edit(glovesUid, { wear: 0.5 });
        expect(inventory.get(glovesUid).wear).toBe(0.5);
    });

    test("converts legacy 0-359 sticker rotation to the in-game -180-180 range on load", () => {
        inventory = new CS2Inventory({
            data: {
                items: {
                    0: {
                        id: AWP_DRAGON_LORE_ID,
                        stickers: {
                            0: { id: FALLEN_COLOGNE_2015_ID, rotation: 270 },
                            1: { id: FALLEN_COLOGNE_2015_ID, rotation: 359 },
                            2: { id: FALLEN_COLOGNE_2015_ID, rotation: 181 },
                            3: { id: FALLEN_COLOGNE_2015_ID, rotation: 180 },
                            4: { id: FALLEN_COLOGNE_2015_ID, rotation: 90 }
                        }
                    },
                    1: {
                        id: AWP_DRAGON_LORE_ID,
                        stickers: {
                            0: { id: FALLEN_COLOGNE_2015_ID, rotation: 0 },
                            // Already within the new range: must stay untouched (idempotent).
                            1: { id: FALLEN_COLOGNE_2015_ID, rotation: -90 }
                        }
                    }
                },
                version: 1
            }
        });
        // The upper half wraps to the equivalent negative angle (same visual rotation).
        const first = ensure(inventory.get(0).stickers);
        expect(first.get(0)?.rotation).toBe(-90);
        expect(first.get(1)?.rotation).toBe(-1);
        expect(first.get(2)?.rotation).toBe(-179);
        expect(first.get(3)?.rotation).toBe(180);
        expect(first.get(4)?.rotation).toBe(90);
        // Conversion preserves sticker identity.
        expect(first.get(0)?.id).toBe(FALLEN_COLOGNE_2015_ID);
        const second = ensure(inventory.get(1).stickers);
        // A default rotation of 0 is compacted away (omitted) on normalize.
        expect(second.get(0)?.rotation).toBe(undefined);
        expect(second.get(1)?.rotation).toBe(-90);
    });

    test("drops unrecoverable sticker rotation on load without bricking the inventory", () => {
        inventory = new CS2Inventory({
            data: {
                items: {
                    0: {
                        id: AWP_DRAGON_LORE_ID,
                        stickers: {
                            0: { id: FALLEN_COLOGNE_2015_ID, rotation: NaN },
                            1: { id: FALLEN_COLOGNE_2015_ID, rotation: 90.5 },
                            2: { id: FALLEN_COLOGNE_2015_ID, rotation: 1000 },
                            3: { id: FALLEN_COLOGNE_2015_ID, rotation: -300 },
                            // A valid neighbor must survive intact.
                            4: { id: FALLEN_COLOGNE_2015_ID, rotation: 45 }
                        }
                    }
                },
                version: 1
            }
        });
        expect(inventory.size()).toBe(1);
        const stickers = ensure(inventory.get(0).stickers);
        for (const slot of [0, 1, 2, 3]) {
            expect(stickers.get(slot)?.id).toBe(FALLEN_COLOGNE_2015_ID);
            expect(stickers.get(slot)?.rotation).toBe(undefined);
        }
        expect(stickers.get(4)?.rotation).toBe(45);
    });

    test("heals legacy sticker rotation nested inside storage units", () => {
        inventory = new CS2Inventory({
            data: {
                items: {
                    0: {
                        id: STORAGE_UNIT_ID,
                        storage: {
                            0: {
                                id: AWP_DRAGON_LORE_ID,
                                stickers: { 0: { id: FALLEN_COLOGNE_2015_ID, rotation: 270 } }
                            }
                        }
                    }
                },
                version: 1
            }
        });
        expect(inventory.get(0).storage?.get(0)?.stickers?.get(0)?.rotation).toBe(-90);
    });

    test("add and edit enforce the -180-180 sticker rotation range", () => {
        const addRotation = (rotation: number) => () =>
            inventory.add({ id: AWP_DRAGON_LORE_ID, stickers: { 0: { id: FALLEN_COLOGNE_2015_ID, rotation } } });
        for (const rotation of [-180, -90, 0, 90, 180]) {
            expect(addRotation(rotation)).not.toThrow();
        }
        for (const rotation of [181, -181, 270, 359, NaN, 90.5]) {
            expect(addRotation(rotation)).toThrow();
        }
        inventory.add({ id: AWP_DRAGON_LORE_ID });
        const uid = inventory.size() - 1;
        expect(() => inventory.edit(uid, { stickers: { 0: { id: FALLEN_COLOGNE_2015_ID, rotation: 270 } } })).toThrow();
        inventory.edit(uid, { stickers: { 0: { id: FALLEN_COLOGNE_2015_ID, rotation: -90 } } });
        expect(inventory.get(uid).stickers?.get(0)?.rotation).toBe(-90);
    });

    test("clamps and snaps out-of-envelope sticker offsets to the model bounds on load", () => {
        // AWP Dragon Lore is legacy, so it resolves to the legacy envelope: X [-0.4323, 0.4206],
        // Y [-0.0921, 0.1415].
        inventory = new CS2Inventory({
            data: {
                items: {
                    0: {
                        id: AWP_DRAGON_LORE_ID,
                        stickers: {
                            0: { id: FALLEN_COLOGNE_2015_ID, x: 0.9, y: 0.05 },
                            1: { id: FALLEN_COLOGNE_2015_ID, x: -0.9, y: -0.5 },
                            2: { id: FALLEN_COLOGNE_2015_ID, x: 0.1, y: 0.12345 },
                            3: { id: FALLEN_COLOGNE_2015_ID, x: NaN, y: 0.05 }
                        }
                    }
                },
                version: 1
            }
        });
        const stickers = ensure(inventory.get(0).stickers);
        // Out-of-range values clamp to the nearest published bound.
        expect(stickers.get(0)).toMatchObject({ x: 0.4206, y: 0.05 });
        expect(stickers.get(1)).toMatchObject({ x: -0.4323, y: -0.0921 });
        // Over-precise values snap (truncate) to the 4-decimal offset grid.
        expect(stickers.get(2)).toMatchObject({ x: 0.1, y: 0.1234 });
        // Non-finite offsets are dropped; the surviving axis is untouched.
        expect(stickers.get(3)?.x).toBe(undefined);
        expect(stickers.get(3)?.y).toBe(0.05);
        // Healed data round-trips through validation cleanly.
        expect(() => inventory.get(0)).not.toThrow();
    });

    test("add and edit enforce the model's sticker offset envelope", () => {
        const addOffset = (x: number, y: number) => () =>
            inventory.add({ id: AWP_DRAGON_LORE_ID, stickers: { 0: { id: FALLEN_COLOGNE_2015_ID, x, y } } });
        // On-grid values inside the legacy envelope (including the exact bounds) are accepted.
        for (const [x, y] of [
            [0, 0],
            [0.4206, 0.1415],
            [-0.4323, -0.0921]
        ] as const) {
            expect(addOffset(x, y)).not.toThrow();
        }
        // Outside the envelope, or finer than the factor's 4 decimals, is rejected.
        for (const [x, y] of [
            [0.4207, 0],
            [0, -0.0922],
            [0.12345, 0],
            [0, NaN]
        ] as const) {
            expect(addOffset(x, y)).toThrow();
        }
    });
});
