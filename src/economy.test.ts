/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { assert, describe, expect, test } from "vitest";
import { english } from "../src/translations/english.ts";
import { CS2RarityColor } from "./economy-container.ts";
import { type CS2Item } from "./economy-types.ts";
import { CS2Economy, CS2EconomyItem } from "./economy.ts";
import { CS2_ITEMS } from "./items.ts";

describe("CS2Economy", () => {
    test("use should add items to the economy", () => {
        const items: CS2Item[] = [
            { id: 1, rarity: CS2RarityColor.Common, type: "weapon" },
            { id: 2, rarity: CS2RarityColor.Common, type: "weapon" },
            { id: 3, rarity: CS2RarityColor.Common, type: "weapon" }
        ];
        CS2Economy.load({
            items,
            language: {
                1: { name: "Item 1" },
                2: { name: "Item 2" },
                3: { name: "Item 3" }
            }
        });
        expect(CS2Economy.items.size).toBe(3);
        expect(CS2Economy.items.get(1)).toEqual(new CS2EconomyItem(CS2Economy, items[0]!, { name: "Item 1" }));
        expect(CS2Economy.items.get(2)).toEqual(new CS2EconomyItem(CS2Economy, items[1]!, { name: "Item 2" }));
        expect(CS2Economy.items.get(3)).toEqual(new CS2EconomyItem(CS2Economy, items[2]!, { name: "Item 3" }));
    });

    test("getById should return the item with the given id", () => {
        const item: CS2Item = { id: 1, rarity: CS2RarityColor.Common, type: "weapon" };
        const economyItem = new CS2EconomyItem(CS2Economy, item, { name: "Item 1" });
        CS2Economy.load({
            items: [item],
            language: {
                1: { name: "Item 1" }
            }
        });
        const result = CS2Economy.getById(1);
        expect(result).toEqual(economyItem);
    });

    test("get should return the item with the given id or item object", () => {
        const item: CS2Item = { id: 1, rarity: CS2RarityColor.Common, type: "weapon" };
        const economyItem = new CS2EconomyItem(CS2Economy, item, { name: "Item 1" });

        CS2Economy.load({
            items: [item],
            language: {
                1: { name: "Item 1" }
            }
        });

        const result1 = CS2Economy.get(1);
        const result2 = CS2Economy.get(economyItem);

        expect(result1).toEqual(economyItem);
        expect(result2).toEqual(economyItem);
    });
});

test("getStickerMask resolves hd/legacy masks with base inheritance", () => {
    const hd = "/textures/weapon_rif_ak47_sticker_mask_hd_tga_8e7a83c3_abc12345.webp";
    const legacy = "/textures/weapon_rif_ak47_sticker_mask_legacy_tga_1bdb00a_def67890.webp";
    const hdOnly = "/textures/weapon_rif_m4a4_sticker_mask_hd_tga_5516e76c_aaaa1111.webp";
    const items: CS2Item[] = [
        {
            base: true,
            id: 1,
            rarity: CS2RarityColor.Common,
            stickerMask: hd,
            stickerMaskForLegacy: legacy,
            type: "weapon"
        },
        { baseId: 1, id: 2, rarity: CS2RarityColor.Rare, type: "weapon" },
        { baseId: 1, id: 3, legacy: true, rarity: CS2RarityColor.Rare, type: "weapon" },
        { base: true, id: 4, rarity: CS2RarityColor.Common, stickerMask: hdOnly, type: "weapon" },
        { baseId: 4, id: 5, legacy: true, rarity: CS2RarityColor.Rare, type: "weapon" }
    ];
    CS2Economy.load({
        items,
        language: {
            1: { name: "AK-47" },
            2: { name: "AK-47 | Skin" },
            3: { name: "AK-47 | Legacy Skin" },
            4: { name: "M4A4" },
            5: { name: "M4A4 | Legacy Skin" }
        }
    });
    // Base weapon and a non-legacy skin resolve the hd mask.
    expect(CS2Economy.get(1).getStickerMask()).toBe(CS2Economy.resolveUrl(hd));
    expect(CS2Economy.get(2).getStickerMask()).toBe(CS2Economy.resolveUrl(hd));
    // A legacy skin resolves the base's legacy mask.
    expect(CS2Economy.get(3).getStickerMask()).toBe(CS2Economy.resolveUrl(legacy));
    // A legacy skin whose base ships only an hd mask falls back to hd.
    expect(CS2Economy.get(5).getStickerMask()).toBe(CS2Economy.resolveUrl(hdOnly));
});

test("getModelData derives from modelPlayer (.glb -> .json) with base inheritance", () => {
    const modelPlayer = "/models/weapon_knife_bayonet_ab9e13cc_331408bc.glb";
    const modelData = "/models/weapon_knife_bayonet_ab9e13cc_331408bc.json";
    const items: CS2Item[] = [
        { base: true, id: 1, modelPlayer, rarity: CS2RarityColor.Common, type: "weapon" },
        { baseId: 1, id: 2, rarity: CS2RarityColor.Rare, type: "weapon" }
    ];
    CS2Economy.load({
        items,
        language: {
            1: { name: "Bayonet" },
            2: { name: "Bayonet | Skin" }
        }
    });
    expect(CS2Economy.get(1).getModelPlayer()).toBe(CS2Economy.resolveUrl(modelPlayer));
    expect(CS2Economy.get(1).getModelData()).toBe(CS2Economy.resolveUrl(modelData));
    // A skin inherits the base model and derives the same data path.
    expect(CS2Economy.get(2).getModelData()).toBe(CS2Economy.resolveUrl(modelData));
});

test("nametag validation", () => {
    CS2Economy.load({ items: CS2_ITEMS, language: english });
    expect(CS2Economy.safeValidateNametag(" fail")).toBeFalsy();
    expect(CS2Economy.safeValidateNametag("小島 秀夫")).toBeTruthy();
    expect(CS2Economy.safeValidateNametag("孔子")).toBeTruthy();
    expect(CS2Economy.safeValidateNametag("bo$$u")).toBeTruthy();
    expect(CS2Economy.safeValidateNametag("toolongnametagtoolongnametag")).toBeFalsy();
});

test("wear validation", () => {
    CS2Economy.load({ items: CS2_ITEMS, language: english });
    expect(CS2Economy.safeValidateWear(0.1)).toBeTruthy();
    expect(CS2Economy.safeValidateWear(0.5)).toBeTruthy();
    expect(CS2Economy.safeValidateWear(1)).toBeTruthy();
    expect(CS2Economy.safeValidateWear(1.1)).toBeFalsy();
    expect(CS2Economy.safeValidateWear(-0.1)).toBeFalsy();
    const item = new CS2EconomyItem(
        CS2Economy,
        {
            id: 1,
            rarity: CS2RarityColor.Common,
            type: "weapon" as const,
            wearMin: 0.2,
            wearMax: 0.6
        },
        { name: "Item 1" }
    );
    expect(CS2Economy.safeValidateWear(0.1, item)).toBeFalsy();
    expect(CS2Economy.safeValidateWear(0.7, item)).toBeFalsy();
    expect(CS2Economy.safeValidateWear(0.3, item)).toBeTruthy();
});

test("has seed", () => {
    CS2Economy.load({ items: CS2_ITEMS, language: english });
    const baseGloves = CS2Economy.getById(56);
    const skinGloves = CS2Economy.getById(1707);
    expect(baseGloves.hasSeed()).toBe(false);
    expect(skinGloves.hasSeed()).toBe(true);
});

test("default cdn url", () => {
    CS2Economy.load({ items: CS2_ITEMS, language: english });
    const dragonLore = CS2Economy.getById(307);
    assert(dragonLore.getImage().endsWith(".webp"));
    assert(dragonLore.getImage(1 / 3 - 0.1).endsWith("_light.webp"));
    assert(dragonLore.getImage(2 / 3 - 0.1).endsWith("_medium.webp"));
    assert(dragonLore.getImage(3 / 3 - 0.1).endsWith("_heavy.webp"));

    const baseGloves = CS2Economy.getById(56);
    expect(baseGloves.getImage().startsWith("https://cdn.cstrike.app/images"));
});
