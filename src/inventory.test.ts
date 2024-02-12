/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CS_Economy, CS_MAX_STATTRAK, CS_NO_STICKER } from "./economy";
import { CS_unlockCase } from "./economy-case";
import { CS_Inventory } from "./inventory";
import { CS_ITEMS } from "./items";
import { CS_TEAM_CT, CS_TEAM_T } from "./teams";
import { float } from "./util";

CS_Economy.initialize(CS_ITEMS);
let inventory = new CS_Inventory({ limit: 5 });

test("initially is empty", () => {
    expect(inventory.size()).toBe(0);
});

test("added one item", () => {
    inventory.add({
        id: 307
    });
    expect(inventory.size()).toBe(1);
});

test("try to invalid item", () => {
    expect(() =>
        inventory.add({
            id: 5683,
            wear: 8,
            stattrak: 2
        })
    ).toThrow();
    expect(inventory.size()).toBe(1);
});

test("try to add more than limit", () => {
    for (let i = 0; i < 5; i++) {
        inventory.add({
            id: 307,
            wear: 0.02,
            stattrak: 2,
            seed: 10
        });
    }
    expect(inventory.full()).toBeTruthy();
    expect(inventory.size()).toBe(5);
});

test("edit item", () => {
    inventory.edit(2, { wear: 0.5, stattrak: 0 });
    const inventoryItem = inventory.get(2);
    expect(inventoryItem.wear).toBe(0.5);
    expect(inventoryItem.stattrak).toBe(0);
    expect(() => inventory.edit(2, { id: 200 })).toThrow();
});

test("equip item to T and CT", () => {
    inventory.equip(0, CS_TEAM_CT);
    inventory.equip(0, CS_TEAM_T);
    const inventoryItem = inventory.get(0);
    expect(inventoryItem.equippedCT).toBeTruthy();
    expect(inventoryItem.equippedT).toBeTruthy();
});

test("remove item", () => {
    inventory.remove(1);
    expect(inventory.size()).toBe(4);
});

test("unequip item", () => {
    let inventoryItem = inventory.get(0);
    expect(inventoryItem.equippedCT).toBeTruthy();
    expect(inventoryItem.equippedT).toBeTruthy();
    inventory.unequip(0, CS_TEAM_CT);
    inventory.unequip(0, CS_TEAM_T);
    inventoryItem = inventory.get(0);
    expect(inventoryItem.equippedCT).toBeUndefined();
    expect(inventoryItem.equippedT).toBeUndefined();
});

test("unlock case", () => {
    inventory.removeAll();
    inventory.add({ id: 9425 }); // case
    inventory.add({ id: 9534 }); // key
    inventory.unlockCase(CS_unlockCase(9425), 1, 0);
    expect(inventory.size()).toBe(1);
    expect(inventory.get(0).id).not.toBe(9425);
    expect(inventory.get(0).id).not.toBe(9534);
    inventory.remove(0);
    inventory.add({ id: 9425 }); // case
    inventory.add({ id: 9534 }); // key
    expect(() => inventory.unlockCase(CS_unlockCase(9425), 0, 1)).toThrow();
    inventory.remove(0);
    inventory.remove(0);
    inventory.add({ id: 9426 }); // capsule case
    inventory.unlockCase(CS_unlockCase(9426), 0);
    expect(inventory.size()).toBe(1);
    expect(CS_Economy.getById(inventory.get(0).id).type).toBe("sticker");
    inventory.remove(0);
    inventory.add({ id: 9534 }); // key
    inventory.add({ id: 9425 }); // case
    inventory.unlockCase(CS_unlockCase(9425), 0, 1);
    expect(inventory.size()).toBe(1);
});

test("rename item", () => {
    inventory.removeAll();
    inventory.add({ id: 307, nametag: "initial nametag" }); // dragon lore
    inventory.add({ id: 11261 }); // nametag
    expect(inventory.size()).toBe(2);
    expect(inventory.get(1).nametag).toBe("initial nametag");
    inventory.renameItem(0, 1, "new nametag");
    expect(inventory.size()).toBe(1);
    expect(inventory.get(0).nametag).toBe("new nametag");
    inventory.add({ id: 11261 }); // nametag
    inventory.renameItem(0, 1);
    expect(inventory.size()).toBe(1);
    expect(inventory.get(0).nametag).toBe(undefined);
});

test("apply item sticker", () => {
    inventory = new CS_Inventory({ limit: 16 });
    inventory.add({ id: 7305 });
    inventory.add({ id: 7307 });
    inventory.add({ id: 7308 });
    inventory.add({ id: 6001 });
    inventory.add({ id: 307 });
    inventory.add({ id: 307 });
    expect(inventory.get(0).stickers).toBe(undefined);
    expect(() => inventory.applyItemSticker(0, 1, 0)).toThrow();
    for (let stickerIndex = 0; stickerIndex < 4; stickerIndex++) {
        const expectedId = inventory.get(2).id;
        inventory.applyItemSticker(0, 2, stickerIndex);
        expect(() => inventory.applyItemSticker(0, 2, stickerIndex)).toThrow();
        expect(inventory.size()).toBe(6 - (stickerIndex + 1));
        expect(inventory.get(0).stickers).not.toBe(undefined);
        expect(inventory.get(0).stickers![stickerIndex]).toBe(expectedId);
    }
    expect(() => inventory.applyItemSticker(0, 1, 5)).toThrow();
    expect(() => inventory.applyItemSticker(0, 1, -1)).toThrow();
    expect(() => inventory.applyItemSticker(0, 1, NaN)).toThrow();
    expect(inventory.size()).toBe(2);
});

test("scrape item sticker", () => {
    inventory.removeAll();
    inventory.add({ id: 307, stickers: [7306, 7306, CS_NO_STICKER, CS_NO_STICKER] });
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
    expect(inventory.get(0).stickers![0]).toBe(CS_NO_STICKER);
    expect(inventory.get(0).stickerswear).toBe(undefined);
    for (let scrape = 0; scrape < 10; scrape++) {
        inventory.scrapeItemSticker(0, 1);
        expect(inventory.get(0).stickerswear![1]).toBe(float(0.1 + 0.1 * scrape));
    }
    inventory.scrapeItemSticker(0, 1);
    expect(inventory.get(0).stickers).toBe(undefined);
    expect(inventory.get(0).stickerswear).toBe(undefined);
});

test("increment stattrak", () => {
    inventory.removeAll();
    inventory.add({ id: 307 });
    expect(inventory.get(0).stattrak).toBe(undefined);
    expect(() => inventory.incrementItemStatTrak(0)).toThrow();
    inventory.add({ id: 307, stattrak: 0 });
    expect(inventory.get(0).stattrak).toBe(0);
    inventory.incrementItemStatTrak(0);
    expect(inventory.get(0).stattrak).toBe(1);
    inventory.add({ id: 307, stattrak: CS_MAX_STATTRAK - 1 });
    inventory.incrementItemStatTrak(0);
    inventory.incrementItemStatTrak(0);
    expect(inventory.get(0).stattrak).toBe(CS_MAX_STATTRAK);
});

test("swap items stattrak", () => {
    inventory.removeAll();
    inventory.add({ id: 11263 });
    inventory.add({ id: 307, stattrak: 0 });
    inventory.add({ id: 307, stattrak: 2556 });
    inventory.swapItemsStatTrak(2, 0, 1);
    expect(inventory.get(0).stattrak).toBe(0);
    expect(inventory.get(1).stattrak).toBe(2556);
    inventory.removeAll();
    inventory.add({ id: 11263 });
    inventory.add({ id: 307, stattrak: 0 });
    inventory.add({ id: 307, stattrak: 2556 });
    inventory.swapItemsStatTrak(2, 1, 0);
    expect(inventory.get(0).stattrak).toBe(0);
    expect(inventory.get(1).stattrak).toBe(2556);
    inventory.removeAll();
    inventory.add({ id: 11263 });
    inventory.add({ id: 307 });
    inventory.add({ id: 307, stattrak: 2556 });
    expect(() => inventory.swapItemsStatTrak(2, 0, 1)).toThrow();
    inventory.removeAll();
    for (let i = 0; i < 5; i++) {
        inventory.add({ id: 11263 });
    }
    inventory.add({ id: 1501, stattrak: 10 }); // 9
    inventory.add({ id: 1499, stattrak: 9 }); // 8
    inventory.add({ id: 1334, stattrak: 8 }); // 7
    inventory.add({ id: 1356, stattrak: 7 }); // 6
    inventory.add({ id: 1139, stattrak: 1 }); // 5
    inventory.add({ id: 1126, stattrak: 2 }); // 4
    inventory.add({ id: 307, stattrak: 3 }); // 3
    inventory.add({ id: 313, stattrak: 4 }); // 2
    inventory.add({ id: 1841, stattrak: 5 }); // 1
    inventory.add({ id: 1801, stattrak: 6 }); // 0

    const initialSize = inventory.size();

    for (let i = 0; i < 10; i += 2) {
        for (let j = 0; j < 10; j++) {
            if (j === i || j === i + 1) continue;
            expect(() => inventory.swapItemsStatTrak(10, i, j)).toThrow();
        }
    }

    expect(() => inventory.swapItemsStatTrak(2, 0, 1)).toThrow();
    expect(() => inventory.swapItemsStatTrak(10, 0, 0)).toThrow();

    for (let i = 0; i < 10; i += 2) {
        const from = inventory.get(i).stattrak;
        const to = inventory.get(i + 1).stattrak;
        inventory.swapItemsStatTrak(10, i, i + 1);
        expect(inventory.get(i).stattrak).toBe(to);
        expect(inventory.get(i + 1).stattrak).toBe(from);
    }

    expect(inventory.size()).toBe(initialSize - 5);
});

test("storage unit", () => {
    inventory = new CS_Inventory({ limit: 32, storageUnitLimit: 2 });
    inventory.add({ id: 307, stattrak: 3 }); // 5
    inventory.add({ id: 313, stattrak: 4 }); // 4
    inventory.add({ id: 1841, stattrak: 5 }); // 3
    inventory.add({ id: 1801, stattrak: 6 }); // 2
    inventory.add({ id: 11262 }); // 1
    inventory.add({ id: 11262 }); // 0

    expect(inventory.size()).toBe(6);
    expect(inventory.isStorageUnitFull(0)).toBe(false);
    expect(inventory.hasItemsInStorageUnit(0)).toBe(false);
    expect(inventory.canDepositToStorageUnit(0)).toBe(false);
    expect(() => inventory.depositToStorageUnit(0, [2, 3])).toThrow();
    inventory.renameStorageUnit(0, "storage unit");
    expect(inventory.get(0).nametag).toBe("storage unit");
    expect(() => inventory.depositToStorageUnit(0, [1])).toThrow();
    expect(() => inventory.retrieveFromStorageUnit(0, [0, 1])).toThrow();
    expect(() => inventory.depositToStorageUnit(0, [10])).toThrow();
    expect(() => inventory.depositToStorageUnit(0, [])).toThrow();
    inventory.depositToStorageUnit(0, [2, 3]);
    expect(inventory.size()).toBe(4);
    expect(inventory.getStorageUnitItems(0).length).toBe(2);
    expect(inventory.getStorageUnitItems(0)[0].id).toBe(1801);
    expect(inventory.getStorageUnitItems(0)[1].id).toBe(1841);
    expect(() => inventory.depositToStorageUnit(0, [2])).toThrow();
    expect(() => inventory.retrieveFromStorageUnit(0, [])).toThrow();
    inventory.retrieveFromStorageUnit(0, [0]);
    expect(inventory.size()).toBe(5);
    expect(inventory.getStorageUnitItems(1).length).toBe(1);
    expect(inventory.getStorageUnitItems(1)[0].id).toBe(1841);
    expect(inventory.get(0).id).toBe(1801);
});
