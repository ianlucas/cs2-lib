/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    CS_Economy,
    CS_GRAFFITI_BOX_ID,
    CS_Item,
    CS_SOUVENIR_CASE_ID,
    CS_STICKER_CAPSULE_ID,
    CS_WEAPON_CASE_ID
} from "./economy";
import { CS_RARITY_COMMON_COLOR } from "./economy-case";
import { CS_ITEMS } from "./items";

describe("CS_Economy", () => {
    test("use should add items to the economy", () => {
        const items: CS_Item[] = [
            { id: 1, name: "Item 1", rarity: CS_RARITY_COMMON_COLOR, type: "weapon" },
            { id: 2, name: "Item 2", rarity: CS_RARITY_COMMON_COLOR, type: "weapon" },
            { id: 3, name: "Item 3", rarity: CS_RARITY_COMMON_COLOR, type: "weapon" }
        ];
        CS_Economy.use(items);
        expect(CS_Economy.items.size).toBe(3);
        expect(CS_Economy.items.get(1)).toEqual(items[0]);
        expect(CS_Economy.items.get(2)).toEqual(items[1]);
        expect(CS_Economy.items.get(3)).toEqual(items[2]);
    });

    test("getById should return the item with the given id", () => {
        const item: CS_Item = { id: 1, name: "Item 1", rarity: CS_RARITY_COMMON_COLOR, type: "weapon" };
        CS_Economy.use([item]);
        const result = CS_Economy.getById(1);
        expect(result).toEqual(item);
    });

    test("get should return the item with the given id or item object", () => {
        const item: CS_Item = { id: 1, name: "Item 1", rarity: CS_RARITY_COMMON_COLOR, type: "weapon" };
        CS_Economy.use([item]);

        const result1 = CS_Economy.get(1);
        const result2 = CS_Economy.get(item);

        expect(result1).toEqual(item);
        expect(result2).toEqual(item);
    });

    test("applyTranslation should apply translations to the items", () => {
        const translation = {
            1: { name: "Translated Item 1" },
            2: { name: "Translated Item 2" }
        };

        const items: CS_Item[] = [
            { id: 1, name: "Item 1", rarity: CS_RARITY_COMMON_COLOR, type: "weapon" },
            { id: 2, name: "Item 2", rarity: CS_RARITY_COMMON_COLOR, type: "weapon" },
            { id: 3, name: "Item 3", rarity: CS_RARITY_COMMON_COLOR, type: "weapon" }
        ];

        CS_Economy.use(items);
        CS_Economy.applyTranslation(translation);

        const translatedItem1 = CS_Economy.getById(1);
        const translatedItem2 = CS_Economy.getById(2);
        const untranslatedItem = CS_Economy.getById(3);

        expect(translatedItem1.name).toBe("Translated Item 1");
        expect(translatedItem2.name).toBe("Translated Item 2");
        expect(untranslatedItem.name).toBe("Item 3");

        CS_Economy.applyTranslation({});

        expect(CS_Economy.getById(1).name).toBe("Item 1");
        expect(CS_Economy.getById(2).name).toBe("Item 2");
        expect(CS_Economy.getById(3).name).toBe("Item 3");
    });
});

test("nametag validation", () => {
    expect(CS_Economy.safeValidateNametag(" fail")).toBeFalsy();
    expect(CS_Economy.safeValidateNametag("小島 秀夫")).toBeTruthy();
    expect(CS_Economy.safeValidateNametag("孔子")).toBeTruthy();
    expect(CS_Economy.safeValidateNametag("bo$$u")).toBeTruthy();
    expect(CS_Economy.safeValidateNametag("toolongnametagtoolongnametag")).toBeFalsy();
});

test("wear validation", () => {
    expect(CS_Economy.safeValidateWear(0.1)).toBeTruthy();
    expect(CS_Economy.safeValidateWear(0.5)).toBeTruthy();
    expect(CS_Economy.safeValidateWear(1)).toBeTruthy();
    expect(CS_Economy.safeValidateWear(1.1)).toBeFalsy();
    expect(CS_Economy.safeValidateWear(-0.1)).toBeFalsy();
    const item = {
        id: 1,
        name: "Item 1",
        rarity: CS_RARITY_COMMON_COLOR,
        type: "weapon" as const,
        wearmin: 0.2,
        wearmax: 0.6
    };
    expect(CS_Economy.safeValidateWear(0.1, item)).toBeFalsy();
    expect(CS_Economy.safeValidateWear(0.7, item)).toBeFalsy();
    expect(CS_Economy.safeValidateWear(0.3, item)).toBeTruthy();
});

test("has seed", () => {
    CS_Economy.use(CS_ITEMS);
    const baseGlove = CS_Economy.getById(56);
    const skinGlove = CS_Economy.getById(1707);
    expect(CS_Economy.hasSeed(baseGlove)).toBe(false);
    expect(CS_Economy.hasSeed(skinGlove)).toBe(true);
});

test("category check helpers", () => {
    expect(CS_Economy.getById(CS_WEAPON_CASE_ID).category).toBe("Weapon Cases");
    expect(CS_Economy.isWeaponCase(CS_Economy.getById(9131))).toBe(true);
    expect(CS_Economy.getById(CS_STICKER_CAPSULE_ID).category).toBe("Sticker Capsules");
    expect(CS_Economy.isStickerCapsule(CS_Economy.getById(9155))).toBe(true);
    expect(CS_Economy.getById(CS_GRAFFITI_BOX_ID).category).toBe("Graffiti Boxes");
    expect(CS_Economy.isGraffitiBox(CS_Economy.getById(11254))).toBe(true);
    expect(CS_Economy.getById(CS_SOUVENIR_CASE_ID).category).toBe("Souvenir Cases");
    expect(CS_Economy.isSouvenirCase(CS_Economy.getById(9153))).toBe(true);
});
