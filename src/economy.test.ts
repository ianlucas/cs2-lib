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
            { id: 1, rarityColor: CS2RarityColor.Common, type: "weapon" },
            { id: 2, rarityColor: CS2RarityColor.Common, type: "weapon" },
            { id: 3, rarityColor: CS2RarityColor.Common, type: "weapon" }
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
        const item: CS2Item = { id: 1, rarityColor: CS2RarityColor.Common, type: "weapon" };
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
        const item: CS2Item = { id: 1, rarityColor: CS2RarityColor.Common, type: "weapon" };
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

test("getModelDataUrl derives from modelPath (.glb -> .json) with base inheritance", () => {
    const modelPath = "/models/weapon_knife_bayonet_ab9e13cc_331408bc.glb";
    const modelData = "/models/weapon_knife_bayonet_ab9e13cc_331408bc.json";
    const items: CS2Item[] = [
        { id: 1, isBase: true, modelPath, rarityColor: CS2RarityColor.Common, type: "weapon" },
        { parentId: 1, id: 2, rarityColor: CS2RarityColor.Rare, type: "weapon" }
    ];
    CS2Economy.load({
        items,
        language: {
            1: { name: "Bayonet" },
            2: { name: "Bayonet | Skin" }
        }
    });
    expect(CS2Economy.get(1).getModelUrl()).toBe(CS2Economy.resolveUrl(modelPath));
    expect(CS2Economy.get(1).getModelDataUrl()).toBe(CS2Economy.resolveUrl(modelData));
    // A skin inherits the base model and derives the same data path.
    expect(CS2Economy.get(2).getModelDataUrl()).toBe(CS2Economy.resolveUrl(modelData));
});

test("generated base glove models are complete and inherited by their finishes", () => {
    CS2Economy.load({ items: CS2_ITEMS, language: english });
    const gloves = CS2Economy.itemsAsArray.filter((item) => item.isGloves());
    const baseGloves = gloves.filter((item) => item.isBase);
    const gloveFinishes = gloves.filter((item) => !item.isBase);

    expect(baseGloves).toHaveLength(10);
    const generatedBaseGloves = baseGloves.filter((glove) => glove.modelPath != null);
    expect(generatedBaseGloves.length).toBeOneOf([0, baseGloves.length]);
    for (const glove of generatedBaseGloves) {
        expect(glove.modelPath, glove.name).toMatch(/^\/models\/.+\.glb$/);
    }
    for (const glove of gloveFinishes) {
        expect(glove.modelPath, glove.name).toBeUndefined();
        if (generatedBaseGloves.length > 0) {
            expect(glove.getModelUrl(), glove.name).toBe(glove.parent?.getModelUrl());
        }
    }
});

test("modelPath and materialPath resolve own-first, then through the parent", () => {
    // Keychain-shaped data: the item carries its own model/material while its base (the shared
    // stub) carries none, and a display-case-shaped item carries none but its base carries both.
    const ownModel = "/models/kc_missinglink_ava_ab9e13cc_331408bc.glb";
    const ownMaterial = "/materials/kc_missinglink_ava_331408bc.vmat.json";
    const slabModel = "/models/kc_sticker_display_case_ab9e13cc_331408bc.glb";
    const slabMaterial = "/materials/kc_sticker_display_case_331408bc.vcompmat.json";
    const items: CS2Item[] = [
        { id: 1, rarityColor: CS2RarityColor.Common, type: "stub" },
        {
            parentId: 1,
            id: 2,
            materialPath: ownMaterial,
            modelPath: ownModel,
            rarityColor: CS2RarityColor.Rare,
            type: "keychain"
        },
        {
            parentId: 1,
            id: 3,
            isDefault: true,
            materialPath: slabMaterial,
            modelPath: slabModel,
            rarityColor: CS2RarityColor.Common,
            type: "keychain"
        },
        { parentId: 3, id: 4, rarityColor: CS2RarityColor.Common, displayedStickerId: 5, type: "keychain" }
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
    expect(CS2Economy.get(2).getModelUrl()).toBe(CS2Economy.resolveUrl(ownModel));
    expect(CS2Economy.get(2).getMaterialUrl()).toBe(CS2Economy.resolveUrl(ownMaterial));
    // The per-sticker display case falls back to the slab parent's model/material.
    expect(CS2Economy.get(4).getModelUrl()).toBe(CS2Economy.resolveUrl(slabModel));
    expect(CS2Economy.get(4).getModelDataUrl()).toBe(CS2Economy.resolveUrl(slabModel.replace(/\.glb$/, ".json")));
    expect(CS2Economy.get(4).getMaterialUrl()).toBe(CS2Economy.resolveUrl(slabMaterial));
});

test("nametag validation", () => {
    CS2Economy.load({ items: CS2_ITEMS, language: english });
    for (const nameTag of [
        "小島 秀夫",
        "Калашников",
        "안녕하세요",
        "مرحبا",
        "🎉",
        "\u00a0name",
        "name\u00a0",
        "🎉".repeat(20)
    ]) {
        expect(CS2Economy.safeValidateNameTag(nameTag), `validating ${nameTag}`).toBeTruthy();
    }
    for (const nameTag of [" fail", "fail ", "\tname", "name\n", "name\u007f", "name\u0085", "🎉".repeat(21)]) {
        expect(CS2Economy.safeValidateNameTag(nameTag), `validating ${nameTag}`).toBeFalsy();
    }
    expect(CS2Economy.safeValidateNameTag("")).toBeTruthy();
    expect(CS2Economy.safeRequireNameTag("")).toBeFalsy();
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
            rarityColor: CS2RarityColor.Common,
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
    assert(dragonLore.getImageUrl().endsWith(".webp"));
    assert(dragonLore.getImageUrl(1 / 3 - 0.1).endsWith("_light.webp"));
    assert(dragonLore.getImageUrl(2 / 3 - 0.1).endsWith("_medium.webp"));
    assert(dragonLore.getImageUrl(3 / 3 - 0.1).endsWith("_heavy.webp"));

    const baseGloves = CS2Economy.getById(56);
    expect(baseGloves.getImageUrl().startsWith("https://cdn.cstrike.app/images"));
});

test("display-case keychain resolves model and material through the slab parent", () => {
    CS2Economy.load({ items: CS2_ITEMS, language: english });
    // 15200 is the Sticker Slab, a paid tool that carries the shared model/material;
    // 15407 is a per-sticker display-case keychain that carries neither and inherits via parentId.
    const slab = CS2Economy.getById(15200);
    const displayCase = CS2Economy.getById(15407);
    expect(slab.isTool()).toBe(true);
    expect(slab.isDefault).toBeUndefined();
    expect(displayCase.isKeychain()).toBe(true);
    expect(displayCase.modelPath).toBe(undefined);
    expect(displayCase.materialPath).toBe(undefined);
    expect(displayCase.getModelUrl()).toBe(slab.getModelUrl());
    expect(displayCase.getModelDataUrl()).toBe(slab.getModelDataUrl());
    expect(displayCase.getMaterialUrl()).toBe(slab.getMaterialUrl());
});

test("sticker slab predicates and display-case lookup", () => {
    CS2Economy.load({ items: CS2_ITEMS, language: english });
    const slab = CS2Economy.getById(15200);
    const displayCase = CS2Economy.getById(15407);
    const sticker = CS2Economy.getById(1847);
    expect(slab.isStickerSlab()).toBe(true);
    expect(displayCase.isStickerSlab()).toBe(false);
    expect(displayCase.isStickerDisplayCase()).toBe(true);
    expect(slab.isStickerDisplayCase()).toBe(false);
    expect(sticker.hasDisplayCase()).toBe(true);
    expect(sticker.getDisplayCase()).toBe(displayCase);
    // Only stickers can be looked up.
    expect(() => slab.getDisplayCase()).toThrow();
    expect(() => displayCase.hasDisplayCase()).toThrow();
});

test("getDisplayCase throws for a sticker without a display case", () => {
    const items: CS2Item[] = [{ id: 1, rarityColor: CS2RarityColor.Common, type: "sticker" }];
    CS2Economy.load({ items });
    const sticker = CS2Economy.getById(1);
    expect(sticker.hasDisplayCase()).toBe(false);
    expect(() => sticker.getDisplayCase()).toThrow();
});

test("getStickerOffsetBounds returns per-axis bounds; legacy models read only legacy fields", () => {
    const items: CS2Item[] = [
        {
            id: 1,
            rarityColor: CS2RarityColor.Common,
            type: "weapon",
            stickerOffsetXMin: -0.5,
            stickerOffsetXMax: 0.5,
            stickerOffsetYMin: -0.25,
            stickerOffsetYMax: 0.25,
            legacyStickerOffsetXMin: -1,
            legacyStickerOffsetXMax: 1
        },
        { id: 2, rarityColor: CS2RarityColor.Common, type: "weapon", parentId: 1, isLegacyModel: true },
        { id: 3, rarityColor: CS2RarityColor.Common, type: "weapon", parentId: 1 },
        { id: 4, rarityColor: CS2RarityColor.Common, type: "weapon" }
    ];
    CS2Economy.load({
        items,
        language: { 1: { name: "Parent" }, 2: { name: "Legacy" }, 3: { name: "Child" }, 4: { name: "Bare" } }
    });
    expect(CS2Economy.getById(1).getStickerOffsetBounds()).toEqual({
        x: { min: -0.5, max: 0.5 },
        y: { min: -0.25, max: 0.25 }
    });
    expect(CS2Economy.getById(2).getStickerOffsetBounds()).toEqual({
        x: { min: -1, max: 1 },
        y: { min: undefined, max: undefined }
    });
    expect(CS2Economy.getById(3).getStickerOffsetBounds()).toEqual({
        x: { min: -0.5, max: 0.5 },
        y: { min: -0.25, max: 0.25 }
    });
    expect(CS2Economy.getById(4).getStickerOffsetBounds()).toEqual({
        x: { min: undefined, max: undefined },
        y: { min: undefined, max: undefined }
    });
});

test("getKeychainPositionBounds returns per-axis bounds; legacy models read only legacy fields", () => {
    const items: CS2Item[] = [
        {
            id: 1,
            rarityColor: CS2RarityColor.Common,
            type: "weapon",
            keychainPositionXMin: 0,
            keychainPositionXMax: 10,
            keychainPositionYMin: -2,
            keychainPositionYMax: 2,
            keychainPositionZMin: -4,
            keychainPositionZMax: 4,
            legacyKeychainPositionZMin: -8,
            legacyKeychainPositionZMax: 8
        },
        { id: 2, rarityColor: CS2RarityColor.Common, type: "weapon", parentId: 1, isLegacyModel: true },
        { id: 3, rarityColor: CS2RarityColor.Common, type: "weapon" }
    ];
    CS2Economy.load({
        items,
        language: { 1: { name: "Parent" }, 2: { name: "Legacy" }, 3: { name: "Bare" } }
    });
    expect(CS2Economy.getById(1).getKeychainPositionBounds()).toEqual({
        x: { min: 0, max: 10 },
        y: { min: -2, max: 2 },
        z: { min: -4, max: 4 }
    });
    expect(CS2Economy.getById(2).getKeychainPositionBounds()).toEqual({
        x: { min: undefined, max: undefined },
        y: { min: undefined, max: undefined },
        z: { min: -8, max: 8 }
    });
    expect(CS2Economy.getById(3).getKeychainPositionBounds()).toEqual({
        x: { min: undefined, max: undefined },
        y: { min: undefined, max: undefined },
        z: { min: undefined, max: undefined }
    });
});
