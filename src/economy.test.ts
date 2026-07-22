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

test("getModelData derives from playerModel (.glb -> .json) with base inheritance", () => {
    const playerModel = "/models/weapon_knife_bayonet_ab9e13cc_331408bc.glb";
    const modelData = "/models/weapon_knife_bayonet_ab9e13cc_331408bc.json";
    const items: CS2Item[] = [
        { base: true, id: 1, playerModel, rarity: CS2RarityColor.Common, type: "weapon" },
        { baseId: 1, id: 2, rarity: CS2RarityColor.Rare, type: "weapon" }
    ];
    CS2Economy.load({
        items,
        language: {
            1: { name: "Bayonet" },
            2: { name: "Bayonet | Skin" }
        }
    });
    expect(CS2Economy.get(1).getPlayerModel()).toBe(CS2Economy.resolveUrl(playerModel));
    expect(CS2Economy.get(1).getModelData()).toBe(CS2Economy.resolveUrl(modelData));
    // A skin inherits the base model and derives the same data path.
    expect(CS2Economy.get(2).getModelData()).toBe(CS2Economy.resolveUrl(modelData));
});

test("playerModel and paintMaterial resolve own-first, then through the parent", () => {
    // Keychain-shaped data: the item carries its own model/material while its base (the shared
    // stub) carries none, and a display-case-shaped item carries none but its base carries both.
    const ownModel = "/models/kc_missinglink_ava_ab9e13cc_331408bc.glb";
    const ownMaterial = "/materials/kc_missinglink_ava_331408bc.vmat.json";
    const slabModel = "/models/kc_sticker_display_case_ab9e13cc_331408bc.glb";
    const slabMaterial = "/materials/kc_sticker_display_case_331408bc.vcompmat.json";
    const items: CS2Item[] = [
        { id: 1, rarity: CS2RarityColor.Common, type: "stub" },
        {
            baseId: 1,
            id: 2,
            paintMaterial: ownMaterial,
            playerModel: ownModel,
            rarity: CS2RarityColor.Rare,
            type: "keychain"
        },
        {
            baseId: 1,
            free: true,
            id: 3,
            paintMaterial: slabMaterial,
            playerModel: slabModel,
            rarity: CS2RarityColor.Common,
            type: "keychain"
        },
        { baseId: 3, id: 4, rarity: CS2RarityColor.Common, stickerId: 5, type: "keychain" }
    ];
    CS2Economy.load({
        items,
        language: {
            1: { name: "Keychain" },
            2: { name: "Keychain | Lil' Ava" },
            3: { name: "Keychain | Sticker Display Case" },
            4: { name: "Keychain | Sticker Display Case | Sticker" }
        }
    });
    // Own model/material win over the (empty) stub parent.
    expect(CS2Economy.get(2).getPlayerModel()).toBe(CS2Economy.resolveUrl(ownModel));
    expect(CS2Economy.get(2).getPaintMaterial()).toBe(CS2Economy.resolveUrl(ownMaterial));
    // The per-sticker display case falls back to the slab parent's model/material.
    expect(CS2Economy.get(4).getPlayerModel()).toBe(CS2Economy.resolveUrl(slabModel));
    expect(CS2Economy.get(4).getModelData()).toBe(CS2Economy.resolveUrl(slabModel.replace(/\.glb$/, ".json")));
    expect(CS2Economy.get(4).getPaintMaterial()).toBe(CS2Economy.resolveUrl(slabMaterial));
});

test("nametag validation", () => {
    CS2Economy.load({ items: CS2_ITEMS, language: english });
    expect(CS2Economy.safeValidateNameTag(" fail")).toBeFalsy();
    expect(CS2Economy.safeValidateNameTag("小島 秀夫")).toBeTruthy();
    expect(CS2Economy.safeValidateNameTag("孔子")).toBeTruthy();
    expect(CS2Economy.safeValidateNameTag("千古风流今在此，万里功名莫放休")).toBeTruthy();
    expect(CS2Economy.safeValidateNameTag("中文，句号。分号；感叹！")).toBeTruthy();
    expect(CS2Economy.safeValidateNameTag("bo$$u")).toBeTruthy();
    expect(CS2Economy.safeValidateNameTag("toolongnametagtoolongnametag")).toBeFalsy();
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

test("display-case keychain resolves model and material through the slab parent", () => {
    CS2Economy.load({ items: CS2_ITEMS, language: english });
    // 15200 is the Sticker Display Case slab (carries the shared model/material);
    // 15407 is a per-sticker display-case keychain that carries neither and inherits via baseId.
    const slab = CS2Economy.getById(15200);
    const displayCase = CS2Economy.getById(15407);
    expect(displayCase.playerModel).toBe(undefined);
    expect(displayCase.paintMaterial).toBe(undefined);
    expect(displayCase.getPlayerModel()).toBe(slab.getPlayerModel());
    expect(displayCase.getModelData()).toBe(slab.getModelData());
    expect(displayCase.getPaintMaterial()).toBe(slab.getPaintMaterial());
});
