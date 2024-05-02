/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import english from "../assets/translations/items-english.json";
import { CS_Economy, CS_MAX_STATTRAK, CS_NONE } from "./economy";
import { CS_Inventory } from "./inventory";
import { CS_ITEMS } from "./items";
import { CS_TEAM_CT, CS_TEAM_T } from "./teams";
import { float } from "./util";

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

CS_Economy.use({ items: CS_ITEMS, translation: english });

function size<T extends {}>(obj: T): number {
    return Object.keys(obj).length;
}

describe("CS_Inventory methods", () => {
    let inventory: CS_Inventory;

    beforeEach(() => {
        inventory = new CS_Inventory({
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
        expect(inventory.size()).toBe(2);
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
            nametag: "My Nametag",
            seed: 500,
            stattrak: 200,
            stickers: [FALLEN_COLOGNE_2015_ID, FALLEN_COLOGNE_2015_ID, FALLEN_COLOGNE_2015_ID, FALLEN_COLOGNE_2015_ID],
            stickerswear: [0.1, 0.2, 0.3, 0.4],
            updatedat: 100,
            wear: 0.5
        };
        inventory.add({ ...item });
        const result = inventory.get(0);
        expect(result.data).toBe(CS_Economy.getById(AWP_DRAGON_LORE_ID));
        expect(result.equipped).toBe(undefined);
        expect(result.equippedCT).toBe(undefined);
        expect(result.equippedT).toBe(undefined);
        expect(result.id).toBe(item.id);
        expect(result.nametag).toBe(item.nametag);
        expect(result.seed).toBe(item.seed);
        expect(result.stattrak).toBe(item.stattrak);
        expect(result.stickers).toEqual(item.stickers);
        expect(result.stickerswear).toEqual(item.stickerswear);
        expect(result.updatedat).not.toBe(item.updatedat);
        expect(result.wear).toBe(item.wear);
        expect(size(result)).toBe(13);
    });

    test("addWithNametag should add items with nametags to the inventory", () => {
        inventory.add({ id: NAMETAG_ID }); // uid:0
        const args = [AK47_ID, "My Nametag"] as const;
        inventory.addWithNametag(0, ...args); // uid:0
        expect(inventory.size()).toBe(1);
        const result = inventory.get(0);
        expect(result.data).toBe(CS_Economy.getById(AK47_ID));
        expect(result.equipped).toBe(undefined);
        expect(result.equippedCT).toBe(undefined);
        expect(result.equippedT).toBe(undefined);
        expect(result.id).toBe(args[0]);
        expect(result.nametag).toBe(args[1]);
        expect(result.uid).toBe(0);
        expect(result.updatedat).not.toBe(undefined);
        expect(size(result)).toBe(8);
    });

    test("addWithSticker should add items with stickers to the inventory", () => {
        inventory.add({ id: FALLEN_COLOGNE_2015_ID }); // uid:0
        const args = [AK47_ID, 2] as const;
        inventory.addWithSticker(0, ...args); // uid:0
        expect(inventory.size()).toBe(1);
        const result = inventory.get(0);
        expect(result.data).toBe(CS_Economy.getById(AK47_ID));
        expect(result.equipped).toBe(undefined);
        expect(result.equippedCT).toBe(undefined);
        expect(result.equippedT).toBe(undefined);
        expect(result.id).toBe(args[0]);
        expect(result.stickers).toEqual([CS_NONE, CS_NONE, FALLEN_COLOGNE_2015_ID, CS_NONE]);
        expect(result.uid).toBe(0);
        expect(result.updatedat).not.toBe(undefined);
        expect(size(result)).toBe(8);
    });

    test("edit should edit the item with the given id", () => {
        const originalItem = {
            id: AWP_DRAGON_LORE_ID,
            nametag: "My Nametag",
            seed: 500,
            stattrak: 200,
            stickers: [FALLEN_COLOGNE_2015_ID, FALLEN_COLOGNE_2015_ID, FALLEN_COLOGNE_2015_ID, FALLEN_COLOGNE_2015_ID],
            stickerswear: [0.1, 0.2, 0.3, 0.4],
            wear: 0.5
        };
        const editedItem = {
            nametag: "My New Nametag",
            seed: 600,
            stattrak: 300,
            stickers: [ALLU_COLOGNE_2015_ID, CS_NONE, ALLU_COLOGNE_2015_ID, CS_NONE],
            stickerswear: [0.5, 0, 0.7, 0],
            wear: 0.7
        };
        inventory.add({ ...originalItem }); // uid:0
        inventory.edit(0, { ...editedItem });
        const result = inventory.get(0);
        expect(result.nametag).toBe(editedItem.nametag);
        expect(result.seed).toBe(editedItem.seed);
        expect(result.stattrak).toBe(editedItem.stattrak);
        expect(result.stickers).toEqual(editedItem.stickers);
        expect(result.stickerswear).toEqual(editedItem.stickerswear);
        expect(result.wear).toBe(editedItem.wear);
    });

    test("equip should equip the item with the given id", () => {
        inventory.add({ id: AK47_ID }); // uid:0
        inventory.equip(0, CS_TEAM_T);
        expect(() => inventory.equip(0)).toThrow();
        expect(() => inventory.equip(0, CS_TEAM_CT)).toThrow();
        expect(inventory.get(0).equippedT).toBe(true);
        expect(inventory.get(0).equippedCT).toBe(undefined);
        expect(inventory.get(0).equipped).toBe(undefined);
        inventory.add({ id: M4A1_S_ID }); // uid:1
        inventory.equip(1, CS_TEAM_CT);
        expect(() => inventory.equip(1)).toThrow();
        expect(() => inventory.equip(1, CS_TEAM_T)).toThrow();
        expect(inventory.get(1).equippedCT).toBe(true);
        expect(inventory.get(1).equippedT).toBe(undefined);
        expect(inventory.get(1).equipped).toBe(undefined);
        inventory.add({ id: AWP_ID }); // uid:2
        inventory.equip(2, CS_TEAM_CT);
        inventory.equip(2, CS_TEAM_T);
        expect(() => inventory.equip(2)).toThrow();
        expect(inventory.get(2).equippedCT).toBe(true);
        expect(inventory.get(2).equippedT).toBe(true);
        expect(inventory.get(2).equipped).toBe(undefined);
        inventory.add({ id: FIVE_YEAR_VETERAN_COIN_ID }); // uid:3
        inventory.equip(3);
        expect(() => inventory.equip(3, CS_TEAM_T)).toThrow();
        expect(() => inventory.equip(3, CS_TEAM_CT)).toThrow();
        expect(inventory.get(3).equipped).toBe(true);
        expect(inventory.get(3).equippedCT).toBe(undefined);
        expect(inventory.get(3).equippedT).toBe(undefined);
        inventory.add({ id: AK47_ID }); // uid:4
        inventory.equip(4, CS_TEAM_T);
        expect(inventory.get(0).equippedT).toBe(undefined);
        expect(inventory.get(4).equippedT).toBe(true);
        inventory.add({ id: M4A1_S_ID }); // uid:5
        inventory.equip(5, CS_TEAM_CT);
        expect(inventory.get(1).equippedCT).toBe(undefined);
        expect(inventory.get(5).equippedCT).toBe(true);
        inventory.add({ id: FIVE_YEAR_VETERAN_COIN_ID }); // uid:6
        inventory.equip(6);
        expect(inventory.get(3).equipped).toBe(undefined);
        expect(inventory.get(6).equipped).toBe(true);
    });

    test("unequip should unequip the item with the given id", () => {
        inventory.add({ id: AK47_ID }); // uid:0
        inventory.equip(0, CS_TEAM_T);
        inventory.unequip(0, CS_TEAM_T);
        expect(inventory.get(0).equippedT).toBe(undefined);
        expect(inventory.get(0).equippedCT).toBe(undefined);
        expect(inventory.get(0).equipped).toBe(undefined);
        inventory.add({ id: M4A1_S_ID }); // uid:1
        inventory.equip(1, CS_TEAM_CT);
        inventory.unequip(1, CS_TEAM_CT);
        expect(inventory.get(1).equippedCT).toBe(undefined);
        expect(inventory.get(1).equippedT).toBe(undefined);
        expect(inventory.get(1).equipped).toBe(undefined);
        inventory.add({ id: AWP_ID }); // uid:2
        inventory.equip(2, CS_TEAM_CT);
        inventory.equip(2, CS_TEAM_T);
        inventory.unequip(2, CS_TEAM_CT);
        inventory.unequip(2, CS_TEAM_T);
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
        const unlocked1 = CS_Economy.unlockCase(ESL_ONE_COLOGNE_2014_DUST_II_SOUVENIR_ID);
        expect(() => inventory.unlockCase(unlocked1, 0, 2)).toThrow();
        inventory.unlockCase(unlocked1, 0); // uid:0
        expect(inventory.size()).toBe(3);
        const result1 = inventory.get(0);
        expect(result1.caseid).toBe(unlocked1.attributes.caseid);
        expect(result1.data).toBe(CS_Economy.getById(unlocked1.id));
        expect(result1.equipped).toBe(undefined);
        expect(result1.equippedCT).toBe(undefined);
        expect(result1.equippedT).toBe(undefined);
        expect(result1.id).toBe(unlocked1.id);
        expect(result1.seed).toBe(unlocked1.attributes.seed);
        expect(result1.stattrak).toBe(unlocked1.attributes.stattrak);
        expect(result1.uid).toBe(0);
        expect(result1.updatedat).not.toBe(undefined);
        expect(result1.wear).toEqual(unlocked1.attributes.wear);
        expect(size(result1)).toBe(11);
        const unlocked2 = CS_Economy.unlockCase(KILOWATT_CASE_ID);
        inventory.unlockCase(unlocked2, 1, 2); // uid:1
        expect(inventory.size()).toBe(2);
        const result2 = inventory.get(1);
        expect(result2.caseid).toBe(unlocked2.attributes.caseid);
        expect(result2.data).toBe(CS_Economy.getById(unlocked2.id));
        expect(result2.equipped).toBe(undefined);
        expect(result2.equippedCT).toBe(undefined);
        expect(result2.equippedT).toBe(undefined);
        expect(result2.id).toBe(unlocked2.id);
        expect(result2.seed).toBe(unlocked2.attributes.seed);
        expect(result2.stattrak).toBe(unlocked2.attributes.stattrak);
        expect(result2.uid).toBe(1);
        expect(result2.updatedat).not.toBe(undefined);
        expect(result2.wear).toEqual(unlocked2.attributes.wear);
        expect(size(result2)).toBe(11);
    });

    test("renameItem should rename the item with the given id", () => {
        inventory.add({ id: NAMETAG_ID }); // uid:0
        inventory.add({ id: AK47_ID, nametag: "My Nametag" }); // uid:1
        inventory.renameItem(0, 1, "My New Nametag");
        expect(inventory.size()).toBe(1);
        const result = inventory.get(1);
        expect(result.nametag).toBe("My New Nametag");
    });

    test("renameStorageUnit should rename the storage unit with the given id", () => {
        inventory.add({ id: STORAGE_UNIT_ID }); // uid:0
        expect(inventory.get(0).nametag).toBe(undefined);
        inventory.renameStorageUnit(0, "Storage Unit");
        expect(inventory.size()).toBe(1);
        expect(inventory.get(0).nametag).toBe("Storage Unit");
        inventory.renameStorageUnit(0, "New Storage Unit");
        expect(inventory.get(0).nametag).toBe("New Storage Unit");
    });

    test("storage unit interactions", () => {
        inventory.add({ id: STORAGE_UNIT_ID }); // uid:0
        inventory.add({ id: STORAGE_UNIT_ID }); // uid:1
        inventory.add({ id: AWP_DRAGON_LORE_ID, stattrak: 1 }); // uid:2
        inventory.add({ id: AWP_DRAGON_LORE_ID, stattrak: 2 }); // uid:3
        inventory.add({ id: AWP_DRAGON_LORE_ID, stattrak: 3 }); // uid:4
        inventory.add({ id: AWP_DRAGON_LORE_ID, stattrak: 4 }); // uid:5
        inventory.add({ id: AWP_DRAGON_LORE_ID, stattrak: 5 }); // uid:6
        expect(inventory.size()).toBe(7);
        expect(inventory.isStorageUnitFull(0)).toBe(false);
        expect(inventory.isStorageUnitFilled(0)).toBe(false);
        expect(inventory.canDepositToStorageUnit(0)).toBe(false);
        expect(() => inventory.depositToStorageUnit(0, [2])).toThrow();
        inventory.renameStorageUnit(0, "My Storage Unit");
        expect(inventory.get(0).nametag).toBe("My Storage Unit");
        expect(() => inventory.retrieveFromStorageUnit(0, [0])).toThrow();
        expect(() => inventory.depositToStorageUnit(0, [])).toThrow();
        expect(() => inventory.depositToStorageUnit(0, [1])).toThrow();
        expect(() => inventory.depositToStorageUnit(0, [7])).toThrow();
        inventory.depositToStorageUnit(0, [2, 3]);
        expect(inventory.size()).toBe(5);
        expect(inventory.getStorageUnitSize(0)).toBe(2);
        expect(inventory.getStorageUnitItems(0)[0].uid).toBe(0);
        expect(inventory.getStorageUnitItems(0)[0].stattrak).toBe(1);
        expect(inventory.getStorageUnitItems(0)[1].uid).toBe(1);
        expect(inventory.getStorageUnitItems(0)[1].stattrak).toBe(2);
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
        expect(inventory.get(2).stattrak).toBe(2);
        expect(inventory.getStorageUnitSize(0)).toBe(2);
    });

    test("applyItemSticker should apply a sticker to the item with the given id", () => {
        inventory.add({ id: ZZ_NATION_RIO_2022_ID }); // uid:0
        inventory.add({ id: ZZ_NATION_RIO_2022_HOLO_ID }); // uid:1
        inventory.add({ id: ZZ_NATION_RIO_2022_GOLD_ID }); // uid:2
        inventory.add({ id: O00_THIEVES_2020_RMR_FOIL_ID }); // uid:3
        inventory.add({ id: AWP_DRAGON_LORE_ID }); // uid:4
        inventory.add({ id: AWP_DRAGON_LORE_ID }); // uid:5
        expect(inventory.get(4).stickers).toBe(undefined);
        expect(() => inventory.applyItemSticker(0, 1, 0)).toThrow();
        for (let stickerIndex = 0; stickerIndex < 4; stickerIndex++) {
            const expectedId = inventory.get(stickerIndex).id;
            inventory.applyItemSticker(4, stickerIndex, stickerIndex);
            expect(() => inventory.applyItemSticker(4, stickerIndex + 1, stickerIndex)).toThrow();
            expect(inventory.size()).toBe(6 - (stickerIndex + 1));
            expect(inventory.get(4).stickers).not.toBe(undefined);
            expect(inventory.get(4).stickers![stickerIndex]).toBe(expectedId);
        }
        inventory.add({ id: O00_THIEVES_2020_RMR_FOIL_ID }); // uid: 0
        expect(() => inventory.applyItemSticker(4, 0, 5)).toThrow();
        expect(() => inventory.applyItemSticker(4, 0, -1)).toThrow();
        expect(() => inventory.applyItemSticker(4, 0, NaN)).toThrow();
        expect(inventory.size()).toBe(3);
    });

    test("scrapeItemSticker should scrape a sticker from the item with the given id", () => {
        inventory.add({
            id: AWP_DRAGON_LORE_ID,
            stickers: [ZZ_NATION_RIO_2022_GLITTER_ID, ZZ_NATION_RIO_2022_GLITTER_ID, CS_NONE, CS_NONE]
        });
        expect(() => inventory.scrapeItemSticker(0, -5)).toThrow();
        expect(() => inventory.scrapeItemSticker(0, NaN)).toThrow();
        inventory.scrapeItemSticker(0, 0);
        expect(inventory.get(0).stickerswear).not.toBe(undefined);
        expect(inventory.get(0).stickerswear![0]).toBe(0.1);
        for (let scrape = 1; scrape < 10; scrape++) {
            inventory.scrapeItemSticker(0, 0);
            expect(inventory.get(0).stickerswear![0]).toBe(float(0.1 + 0.1 * scrape));
        }
        inventory.scrapeItemSticker(0, 0);
        expect(inventory.get(0).stickers![0]).toBe(CS_NONE);
        expect(inventory.get(0).stickerswear).toBe(undefined);
        for (let scrape = 0; scrape < 10; scrape++) {
            inventory.scrapeItemSticker(0, 1);
            expect(inventory.get(0).stickerswear![1]).toBe(float(0.1 + 0.1 * scrape));
        }
        inventory.scrapeItemSticker(0, 1);
        expect(inventory.get(0).stickers).toBe(undefined);
        expect(inventory.get(0).stickerswear).toBe(undefined);
    });

    test("incrementItemStatTrak should increment the StatTrak count of the item with the given id", () => {
        inventory.add({ id: AWP_DRAGON_LORE_ID });
        expect(inventory.get(0).stattrak).toBe(undefined);
        expect(() => inventory.incrementItemStatTrak(0)).toThrow();
        inventory.add({ id: AWP_DRAGON_LORE_ID, stattrak: 0 });
        expect(inventory.get(1).stattrak).toBe(0);
        inventory.incrementItemStatTrak(1);
        expect(inventory.get(1).stattrak).toBe(1);
        inventory.add({ id: AWP_DRAGON_LORE_ID, stattrak: CS_MAX_STATTRAK - 1 });
        inventory.incrementItemStatTrak(2);
        inventory.incrementItemStatTrak(2);
        expect(inventory.get(2).stattrak).toBe(CS_MAX_STATTRAK);
    });

    test("swapItemsStatTrak should swap the StatTrak count of the items with the given ids", () => {
        inventory.add({ id: STATTRAK_SWAP_TOOL_ID }); // uid:0
        inventory.add({ id: AWP_DRAGON_LORE_ID, stattrak: 0 }); // uid:1
        inventory.add({ id: AWP_DRAGON_LORE_ID, stattrak: 2556 }); // uid:2
        inventory.swapItemsStatTrak(0, 1, 2);
        expect(inventory.get(2).stattrak).toBe(0);
        expect(inventory.get(1).stattrak).toBe(2556);
        inventory.removeAll();
        inventory.add({ id: STATTRAK_SWAP_TOOL_ID }); // uid:0
        inventory.add({ id: AWP_DRAGON_LORE_ID, stattrak: 0 }); // uid:1
        inventory.add({ id: AWP_DRAGON_LORE_ID, stattrak: 2556 }); // uid:2
        inventory.swapItemsStatTrak(0, 2, 1);
        expect(inventory.get(2).stattrak).toBe(0);
        expect(inventory.get(1).stattrak).toBe(2556);
        inventory.removeAll();
        inventory.add({ id: STATTRAK_SWAP_TOOL_ID }); // uid:0
        inventory.add({ id: AWP_DRAGON_LORE_ID }); // uid:1
        inventory.add({ id: AWP_DRAGON_LORE_ID, stattrak: 2556 }); // uid:2
        expect(() => inventory.swapItemsStatTrak(0, 1, 2)).toThrow();
        inventory.removeAll();
        for (let i = 0; i < 5; i++) {
            inventory.add({ id: STATTRAK_SWAP_TOOL_ID }); // uid:0-4
        }
        inventory.add({ id: BUTTERFLY_KNIFE_CASE_HARDNED_ID, stattrak: 10 }); // uid:5
        inventory.add({ id: BUTTERFLY_KNIFE_BLUE_STEEL_ID, stattrak: 9 }); // uid:6
        inventory.add({ id: KARAMBIT_BOREAL_FOREST_ID, stattrak: 8 }); // uid:7
        inventory.add({ id: KARAMBIT_AUTOTRONIC_ID, stattrak: 7 }); // uid:8
        inventory.add({ id: USP_KILL_CONFIRMED_ID, stattrak: 1 }); // uid:9
        inventory.add({ id: USP_BLOOD_TIGER_ID, stattrak: 2 }); // uid:10
        inventory.add({ id: AWP_DRAGON_LORE_ID, stattrak: 3 }); // uid:11
        inventory.add({ id: AWP_ELITE_BUILD_ID, stattrak: 4 }); // uid:12
        inventory.add({ id: TKLIKSPHILIP_HEADING_FOR_THE_SOURCE_ID, stattrak: 5 }); // uid:13
        inventory.add({ id: AWOLNATION_I_AM_ID, stattrak: 6 }); // uid:14
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
            const from = inventory.get(i).stattrak;
            const to = inventory.get(i + 1).stattrak;
            inventory.swapItemsStatTrak((i - 5) / 2, i, i + 1);
            expect(inventory.get(i).stattrak).toBe(to);
            expect(inventory.get(i + 1).stattrak).toBe(from);
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
        inventory.add({ id: AWP_DRAGON_LORE_ID, stattrak: 1 }); // uid:0
        inventory.add({ id: AWP_DRAGON_LORE_ID, stattrak: 2 }); // uid:1
        inventory.remove(0);
        inventory.add({ id: AWP_DRAGON_LORE_ID, stattrak: 3 }); // uid:0
        expect(inventory.size()).toBe(2);
        expect(inventory.get(0).stattrak).toBe(3);
        inventory.removeAll();
        inventory.add({ id: AWP_DRAGON_LORE_ID, stattrak: 4 }); // uid:0
        expect(inventory.size()).toBe(1);
        expect(inventory.get(0).stattrak).toBe(4);
    });

    test("storage unit uid", () => {
        inventory.add({ id: STORAGE_UNIT_ID }); // uid:0
        inventory.add({ id: AWP_DRAGON_LORE_ID, stattrak: 1 }); // uid:1
        inventory.add({ id: AWP_DRAGON_LORE_ID, stattrak: 2 }); // uid:2
        inventory.add({ id: AWP_DRAGON_LORE_ID, stattrak: 3 }); // uid:3
        inventory.renameStorageUnit(0, "My Storage Unit");
        inventory.depositToStorageUnit(0, [1, 2, 3]);
        expect(inventory.getStorageUnitSize(0)).toBe(3);
        for (const [uid, item] of inventory.getStorageUnitItems(0).entries()) {
            expect(item.uid).toBe(uid);
        }
        inventory.retrieveFromStorageUnit(0, [1]);
        expect(inventory.getStorageUnitSize(0)).toBe(2);
        expect(inventory.getStorageUnitItems(0)[0].uid).toBe(0);
        expect(inventory.getStorageUnitItems(0)[1].uid).toBe(2);
        inventory.depositToStorageUnit(0, [1]);
        const storage = inventory.get(0).storage!;
        for (let uid = 0; uid < 3; uid++) {
            expect(storage.get(uid)!.stattrak).toBe(uid + 1);
        }
    });
});
