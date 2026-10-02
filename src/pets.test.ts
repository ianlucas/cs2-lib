/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, test } from "vitest";
import {
    CS2_CHICKEN_EGG_TOOL_DEFINITION_INDEX,
    CS2_CHICKEN_FEED_TOOL_DEFINITION_INDEX,
    CS2_MAX_PET_SEED,
    CS2_MAX_SEED,
    CS2_MIN_PET_SEED,
    CS2_NAMETAG_TOOL_DEFINITION_INDEX,
    CS2_PET_CHICK_UPGRADE_LEVEL,
    CS2_PET_CHICK_VARIANT_INDEX,
    CS2_PET_EGG_UPGRADE_LEVEL,
    CS2_PET_EGG_VARIANT_INDEX,
    CS2_PET_HEN_UPGRADE_LEVEL,
    CS2_PET_PULLET_UPGRADE_LEVEL,
    CS2_STORAGE_UNIT_TOOL_DEFINITION_INDEX
} from "./economy-constants.ts";
import { CS2RarityColor } from "./economy-container.ts";
import { CS2ItemType } from "./economy-types.ts";
import { CS2EconomyInstance } from "./economy.ts";
import {
    CS2_INVENTORY_RULES,
    checkInventoryItem,
    isStorableInStorageUnit,
    reconcileInventoryItems,
    repairInventoryItem
} from "./inventory-rules.ts";
import type { CS2BaseInventoryItem } from "./inventory-types.ts";
import { CS2Inventory } from "./inventory.ts";
import { CS2Team } from "./teams.ts";
import { ensure } from "./utils.ts";

const PET_DEFINITION_INDEX = 4681;
const CATALANA_STYLE_COUNT = 13;
const SILKIE_STYLE_COUNT = 9;

const EGG_ID = 1;
const CHICK_ID = 2;
const CATALANA_ID = 3;
const SILKIE_ID = 4;
const CHICKEN_EGG_ID = 5;
const CHICKEN_FEED_ID = 6;
const STORAGE_UNIT_ID = 7;
const NAMETAG_ID = 8;
const WEAPON_ID = 9;

function pet(id: number, variantIndex: number, styleCount?: number) {
    return {
        id,
        type: CS2ItemType.Pet,
        rarityColor: CS2RarityColor.Rare,
        definitionIndex: PET_DEFINITION_INDEX,
        variantIndex,
        styleCount
    };
}

function tool(id: number, definitionIndex: number) {
    return { id, type: CS2ItemType.Tool, rarityColor: CS2RarityColor.Common, definitionIndex };
}

// The catalog is published by the Update workflow, so the pets are not in CS2_ITEMS until it
// runs. These mirror what the item generator emits for them.
const economy = new CS2EconomyInstance();
economy.load({
    items: [
        pet(EGG_ID, CS2_PET_EGG_VARIANT_INDEX),
        pet(CHICK_ID, CS2_PET_CHICK_VARIANT_INDEX),
        pet(CATALANA_ID, 3, CATALANA_STYLE_COUNT),
        pet(SILKIE_ID, 4, SILKIE_STYLE_COUNT),
        tool(CHICKEN_EGG_ID, CS2_CHICKEN_EGG_TOOL_DEFINITION_INDEX),
        tool(CHICKEN_FEED_ID, CS2_CHICKEN_FEED_TOOL_DEFINITION_INDEX),
        tool(STORAGE_UNIT_ID, CS2_STORAGE_UNIT_TOOL_DEFINITION_INDEX),
        tool(NAMETAG_ID, CS2_NAMETAG_TOOL_DEFINITION_INDEX),
        { id: WEAPON_ID, type: CS2ItemType.Weapon, rarityColor: CS2RarityColor.Common, variantIndex: 1 }
    ]
});

const PETS = [EGG_ID, CHICK_ID, CATALANA_ID, SILKIE_ID];
const PET_TOOLS = [CHICKEN_EGG_ID, CHICKEN_FEED_ID];
const noPolicy = { maxItems: 256, storageUnitMaxItems: 32 };

// The most recently added item with this id.
function uidOf(inventory: CS2Inventory, id: number): number {
    const uids = inventory
        .getAll()
        .filter((item) => item.id === id)
        .map((item) => item.uid);
    return ensure(uids.sort((a, b) => b - a)[0]);
}

describe("pet economy items", () => {
    test("the five definitions are pets and the egg and feed are tools", () => {
        for (const id of PETS) {
            expect(economy.getById(id).isPet()).toBe(true);
            expect(economy.getById(id).expectPet().id).toBe(id);
        }
        expect(economy.getById(CHICKEN_EGG_ID).isChickenEgg()).toBe(true);
        expect(economy.getById(CHICKEN_FEED_ID).isChickenFeed()).toBe(true);
        for (const id of PET_TOOLS) {
            expect(economy.getById(id).isPet()).toBe(false);
            expect(economy.getById(id).isTool()).toBe(true);
            expect(() => economy.getById(id).expectPet()).toThrow();
        }
    });

    test("only the egg definition is the egg", () => {
        expect(economy.getById(EGG_ID).isPetEgg()).toBe(true);
        expect(economy.getById(CHICK_ID).isPetEgg()).toBe(false);
        expect(economy.getById(CATALANA_ID).isPetEgg()).toBe(false);
        expect(economy.getById(CHICKEN_EGG_ID).isPetEgg()).toBe(false);
    });

    test("every pet is seeded over the pet range", () => {
        for (const id of PETS) {
            const item = economy.getById(id);
            expect(item.hasSeed()).toBe(true);
            expect(item.getMinimumSeed()).toBe(CS2_MIN_PET_SEED);
            expect(item.getMaximumSeed()).toBe(CS2_MAX_PET_SEED);
        }
        expect(economy.getById(CHICKEN_EGG_ID).hasSeed()).toBe(false);
        expect(economy.getById(CHICKEN_FEED_ID).hasSeed()).toBe(false);
        expect(economy.getById(WEAPON_ID).getMaximumSeed()).toBe(CS2_MAX_SEED);
    });

    test("only a breed has styles", () => {
        expect(economy.getById(CATALANA_ID).hasStyle()).toBe(true);
        expect(economy.getById(CATALANA_ID).getStyleCount()).toBe(CATALANA_STYLE_COUNT);
        expect(economy.getById(SILKIE_ID).getStyleCount()).toBe(SILKIE_STYLE_COUNT);
        for (const id of [EGG_ID, CHICK_ID, CHICKEN_EGG_ID, WEAPON_ID]) {
            expect(economy.getById(id).hasStyle()).toBe(false);
            expect(economy.getById(id).getStyleCount()).toBe(0);
        }
    });

    test("an upgrade level is the stage of what the pet is", () => {
        expect(economy.getById(CHICK_ID).isPetChick()).toBe(true);
        expect(economy.getById(EGG_ID).isPetChick()).toBe(false);
        expect(economy.getById(CATALANA_ID).isPetChick()).toBe(false);
        expect(economy.getById(EGG_ID).getUpgradeLevels()).toEqual([CS2_PET_EGG_UPGRADE_LEVEL]);
        expect(economy.getById(CHICK_ID).getUpgradeLevels()).toEqual([CS2_PET_CHICK_UPGRADE_LEVEL]);
        for (const id of [CATALANA_ID, SILKIE_ID]) {
            expect(economy.getById(id).getUpgradeLevels()).toEqual([
                CS2_PET_PULLET_UPGRADE_LEVEL,
                CS2_PET_HEN_UPGRADE_LEVEL
            ]);
        }
        expect(economy.getById(EGG_ID).getDefaultUpgradeLevel()).toBe(CS2_PET_EGG_UPGRADE_LEVEL);
        expect(economy.getById(CHICK_ID).getDefaultUpgradeLevel()).toBe(CS2_PET_CHICK_UPGRADE_LEVEL);
        expect(economy.getById(CATALANA_ID).getDefaultUpgradeLevel()).toBe(CS2_PET_HEN_UPGRADE_LEVEL);
        for (const id of PETS) {
            expect(economy.getById(id).hasUpgradeLevel()).toBe(true);
        }
        for (const id of [CHICKEN_EGG_ID, CHICKEN_FEED_ID, WEAPON_ID]) {
            expect(economy.getById(id).hasUpgradeLevel()).toBe(false);
            expect(economy.getById(id).getUpgradeLevels()).toEqual([]);
            expect(economy.getById(id).getDefaultUpgradeLevel()).toBeUndefined();
        }
    });

    test("every pet but the egg can be named", () => {
        expect(economy.getById(EGG_ID).hasNameTag()).toBe(false);
        expect(economy.getById(EGG_ID).isNameablePet()).toBe(false);
        for (const id of [CHICK_ID, CATALANA_ID, SILKIE_ID]) {
            expect(economy.getById(id).hasNameTag()).toBe(true);
            expect(economy.getById(id).isNameablePet()).toBe(true);
        }
        for (const id of PET_TOOLS) {
            expect(economy.getById(id).hasNameTag()).toBe(false);
        }
    });

    test("a pet is equipment", () => {
        for (const id of PETS) {
            expect(economy.getById(id).isInEquipments()).toBe(true);
        }
        expect(economy.getById(CHICKEN_FEED_ID).isInEquipments()).toBe(false);
    });
});

describe("pet inventory rules", () => {
    test("a seed is checked against the pet range, not the weapon one", () => {
        expect(checkInventoryItem(economy, { id: CATALANA_ID, seed: CS2_MIN_PET_SEED })).toBe(true);
        expect(checkInventoryItem(economy, { id: CATALANA_ID, seed: CS2_MAX_PET_SEED })).toBe(true);
        expect(checkInventoryItem(economy, { id: EGG_ID, seed: CS2_MAX_PET_SEED })).toBe(true);
        expect(checkInventoryItem(economy, { id: CATALANA_ID, seed: CS2_MIN_PET_SEED - 1 })).toBe(false);
        expect(checkInventoryItem(economy, { id: CATALANA_ID, seed: CS2_MAX_PET_SEED + 1 })).toBe(false);
        expect(checkInventoryItem(economy, { id: WEAPON_ID, seed: CS2_MAX_SEED + 1 })).toBe(false);
        expect(checkInventoryItem(economy, { id: CHICKEN_FEED_ID, seed: 1 })).toBe(false);
    });

    test("a seed out of range is clamped by repair", () => {
        const item: CS2BaseInventoryItem = { id: CHICK_ID, seed: CS2_MAX_PET_SEED + 500 };
        expect(repairInventoryItem(economy, item)).toBe(true);
        expect(item.seed).toBe(CS2_MAX_PET_SEED);
    });

    test("a style runs from 1 to the breed's style count", () => {
        expect(checkInventoryItem(economy, { id: CATALANA_ID })).toBe(true);
        expect(checkInventoryItem(economy, { id: CATALANA_ID, style: 1 })).toBe(true);
        expect(checkInventoryItem(economy, { id: CATALANA_ID, style: CATALANA_STYLE_COUNT })).toBe(true);
        expect(checkInventoryItem(economy, { id: CATALANA_ID, style: 0 })).toBe(false);
        expect(checkInventoryItem(economy, { id: CATALANA_ID, style: CATALANA_STYLE_COUNT + 1 })).toBe(false);
        expect(checkInventoryItem(economy, { id: CATALANA_ID, style: 1.5 })).toBe(false);
        expect(checkInventoryItem(economy, { id: SILKIE_ID, style: SILKIE_STYLE_COUNT })).toBe(true);
        expect(checkInventoryItem(economy, { id: SILKIE_ID, style: SILKIE_STYLE_COUNT + 1 })).toBe(false);
    });

    test("only a breed takes a style", () => {
        for (const id of [EGG_ID, CHICK_ID, CHICKEN_EGG_ID, CHICKEN_FEED_ID, WEAPON_ID]) {
            expect(checkInventoryItem(economy, { id, style: 1 })).toBe(false);
        }
    });

    test("a style that is not valid is removed by repair, not clamped", () => {
        for (const style of [0, -1, CATALANA_STYLE_COUNT + 1, 2.5, Number.NaN]) {
            const item: CS2BaseInventoryItem = { id: CATALANA_ID, style };
            expect(repairInventoryItem(economy, item)).toBe(true);
            expect(item.style).toBeUndefined();
        }
        const stray: CS2BaseInventoryItem = { id: CHICK_ID, style: 1 };
        expect(repairInventoryItem(economy, stray)).toBe(true);
        expect(stray.style).toBeUndefined();
        const valid: CS2BaseInventoryItem = { id: CATALANA_ID, style: 7 };
        expect(repairInventoryItem(economy, valid)).toBe(true);
        expect(valid.style).toBe(7);
    });

    test("the style rule repairs into what it checks", () => {
        const item = economy.getById(CATALANA_ID);
        for (const style of [undefined, 0, 1, 13, 14, 2.5, Number.POSITIVE_INFINITY]) {
            const repaired = CS2_INVENTORY_RULES.itemStyle.repair(style, item);
            expect(CS2_INVENTORY_RULES.itemStyle.check(repaired, item)).toBe(true);
        }
    });

    test("an upgrade level is one the pet allows", () => {
        expect(checkInventoryItem(economy, { id: EGG_ID, upgradeLevel: 0 })).toBe(true);
        expect(checkInventoryItem(economy, { id: CHICK_ID, upgradeLevel: 1 })).toBe(true);
        expect(checkInventoryItem(economy, { id: CATALANA_ID, upgradeLevel: 2 })).toBe(true);
        expect(checkInventoryItem(economy, { id: CATALANA_ID, upgradeLevel: 3 })).toBe(true);
        expect(checkInventoryItem(economy, { id: EGG_ID, upgradeLevel: 1 })).toBe(false);
        expect(checkInventoryItem(economy, { id: CHICK_ID, upgradeLevel: 3 })).toBe(false);
        for (const upgradeLevel of [-1, 0, 1, 2.5, 4, Number.NaN]) {
            expect(checkInventoryItem(economy, { id: CATALANA_ID, upgradeLevel })).toBe(false);
        }
    });

    test("only a pet takes an upgrade level", () => {
        for (const id of [CHICKEN_EGG_ID, CHICKEN_FEED_ID, WEAPON_ID]) {
            for (const upgradeLevel of [0, 1, 2, 3]) {
                expect(checkInventoryItem(economy, { id, upgradeLevel })).toBe(false);
            }
        }
        expect(economy.validateUpgradeLevel(3)).toBe(true);
        expect(economy.safeValidateUpgradeLevel(4)).toBe(false);
    });

    test("an upgrade level that is not valid is removed by repair, not clamped", () => {
        for (const upgradeLevel of [-1, 1, 4, 2.5, Number.NaN]) {
            const item: CS2BaseInventoryItem = { id: CATALANA_ID, upgradeLevel };
            expect(repairInventoryItem(economy, item)).toBe(true);
            expect(item.upgradeLevel).toBeUndefined();
        }
        const stray: CS2BaseInventoryItem = { id: WEAPON_ID, upgradeLevel: 3 };
        expect(repairInventoryItem(economy, stray)).toBe(true);
        expect(stray.upgradeLevel).toBeUndefined();
        const valid: CS2BaseInventoryItem = { id: CATALANA_ID, upgradeLevel: 2 };
        expect(repairInventoryItem(economy, valid)).toBe(true);
        expect(valid.upgradeLevel).toBe(2);
    });

    test("the upgrade level rule repairs into what it checks", () => {
        for (const id of [EGG_ID, CHICK_ID, CATALANA_ID, WEAPON_ID]) {
            const item = economy.getById(id);
            for (const upgradeLevel of [undefined, -1, 0, 1, 2, 3, 4, 2.5, Number.POSITIVE_INFINITY]) {
                const repaired = CS2_INVENTORY_RULES.itemUpgradeLevel.repair(upgradeLevel, item);
                expect(CS2_INVENTORY_RULES.itemUpgradeLevel.check(repaired, item)).toBe(true);
            }
        }
    });

    test("a name is accepted on every pet but the egg", () => {
        expect(checkInventoryItem(economy, { id: CHICK_ID, nameTag: "Peep" })).toBe(true);
        expect(checkInventoryItem(economy, { id: CATALANA_ID, nameTag: "Henrietta" })).toBe(true);
        expect(checkInventoryItem(economy, { id: EGG_ID, nameTag: "Yolk" })).toBe(false);
        expect(checkInventoryItem(economy, { id: CHICKEN_EGG_ID, nameTag: "Yolk" })).toBe(false);
    });

    test("a name on the egg is removed by repair", () => {
        const item: CS2BaseInventoryItem = { id: EGG_ID, nameTag: "Yolk" };
        expect(repairInventoryItem(economy, item)).toBe(true);
        expect(item.nameTag).toBeUndefined();
    });

    test("no pet, egg or feed is storable in a storage unit", () => {
        for (const id of [...PETS, ...PET_TOOLS]) {
            expect(isStorableInStorageUnit({}, economy.getById(id))).toBe(false);
            expect(checkInventoryItem(economy, { id: STORAGE_UNIT_ID, storage: { 0: { id } } })).toBe(false);
        }
        expect(isStorableInStorageUnit({}, economy.getById(WEAPON_ID))).toBe(true);
    });

    test("a stored pet is dropped as policy, leaving the rest of the unit", () => {
        const items: Record<number, CS2BaseInventoryItem> = {
            0: { id: STORAGE_UNIT_ID, nameTag: "Coop", storage: { 0: { id: CATALANA_ID }, 1: { id: WEAPON_ID } } }
        };
        expect(reconcileInventoryItems(economy, items, noPolicy)).toEqual([
            { uid: 0, id: CATALANA_ID, reason: "policy", storageUid: 0 }
        ]);
        expect(items[0]?.storage).toEqual({ 1: { id: WEAPON_ID } });
    });
});

describe("pet inventory operations", () => {
    let inventory: CS2Inventory;

    beforeEach(() => {
        inventory = new CS2Inventory({ economy, ...noPolicy });
    });

    test("a pet is added with its seed and style", () => {
        inventory.add({ id: CATALANA_ID, seed: 4242, style: 6 });
        const item = inventory.get(uidOf(inventory, CATALANA_ID));
        expect(item.seed).toBe(4242);
        expect(item.style).toBe(6);
        expect(() => inventory.add({ id: CATALANA_ID, style: CATALANA_STYLE_COUNT + 1 })).toThrow();
        expect(() => inventory.add({ id: CHICK_ID, style: 1 })).toThrow();
    });

    test("a pet without an upgrade level is at its default one", () => {
        inventory.add({ id: EGG_ID });
        inventory.add({ id: CHICK_ID });
        inventory.add({ id: CATALANA_ID });
        inventory.add({ id: SILKIE_ID, upgradeLevel: CS2_PET_PULLET_UPGRADE_LEVEL });
        inventory.add({ id: WEAPON_ID });
        expect(inventory.get(uidOf(inventory, EGG_ID)).getUpgradeLevel()).toBe(CS2_PET_EGG_UPGRADE_LEVEL);
        expect(inventory.get(uidOf(inventory, CHICK_ID)).getUpgradeLevel()).toBe(CS2_PET_CHICK_UPGRADE_LEVEL);
        expect(inventory.get(uidOf(inventory, CATALANA_ID)).upgradeLevel).toBeUndefined();
        expect(inventory.get(uidOf(inventory, CATALANA_ID)).getUpgradeLevel()).toBe(CS2_PET_HEN_UPGRADE_LEVEL);
        expect(inventory.get(uidOf(inventory, SILKIE_ID)).getUpgradeLevel()).toBe(CS2_PET_PULLET_UPGRADE_LEVEL);
        expect(inventory.get(uidOf(inventory, WEAPON_ID)).getUpgradeLevel()).toBeUndefined();
        expect(() => inventory.add({ id: CATALANA_ID, upgradeLevel: 1 })).toThrow();
        expect(() => inventory.add({ id: WEAPON_ID, upgradeLevel: 3 })).toThrow();
    });

    test("any number of pets can be owned", () => {
        inventory.add({ id: CATALANA_ID });
        inventory.add({ id: CATALANA_ID });
        inventory.add({ id: SILKIE_ID });
        inventory.add({ id: EGG_ID });
        expect(inventory.size()).toBe(4);
    });

    test("the egg and the feed sit in the inventory as tools with no operation", () => {
        inventory.add({ id: CHICKEN_EGG_ID });
        inventory.add({ id: CHICKEN_FEED_ID });
        expect(inventory.size()).toBe(2);
        expect(() => inventory.equip(uidOf(inventory, CHICKEN_EGG_ID))).toThrow();
        expect(() => inventory.equip(uidOf(inventory, CHICKEN_FEED_ID))).toThrow();
    });

    test("a pet is equipped without a team", () => {
        for (const id of PETS) {
            inventory.add({ id });
            const uid = uidOf(inventory, id);
            inventory.equip(uid);
            expect(inventory.get(uid).equipped).toBe(true);
        }
        inventory.add({ id: CATALANA_ID });
        expect(() => inventory.equip(uidOf(inventory, CATALANA_ID), CS2Team.CT)).toThrow();
    });

    test("equipping a pet unequips the one equipped before it", () => {
        inventory.add({ id: CATALANA_ID });
        inventory.add({ id: SILKIE_ID });
        const catalana = uidOf(inventory, CATALANA_ID);
        const silkie = uidOf(inventory, SILKIE_ID);
        inventory.equip(catalana);
        inventory.equip(silkie);
        expect(inventory.get(catalana).equipped).toBeUndefined();
        expect(inventory.get(silkie).equipped).toBe(true);
        inventory.unequip(silkie);
        expect(inventory.get(silkie).equipped).toBeUndefined();
    });

    test("renamePet names a pet without consuming anything", () => {
        inventory.add({ id: NAMETAG_ID });
        inventory.add({ id: CATALANA_ID });
        const uid = uidOf(inventory, CATALANA_ID);
        inventory.renamePet(uid, "  Henrietta ");
        expect(inventory.get(uid).nameTag).toBe("Henrietta");
        inventory.renamePet(uid, "Clucky");
        expect(inventory.get(uid).nameTag).toBe("Clucky");
        expect(inventory.size()).toBe(2);
    });

    test("renamePet takes a name, and only on a pet that can have one", () => {
        inventory.add({ id: CATALANA_ID });
        inventory.add({ id: EGG_ID });
        inventory.add({ id: WEAPON_ID });
        inventory.add({ id: CHICKEN_EGG_ID });
        const catalana = uidOf(inventory, CATALANA_ID);
        expect(() => inventory.renamePet(catalana, "")).toThrow();
        expect(() => inventory.renamePet(catalana, "   ")).toThrow();
        expect(() => inventory.renamePet(catalana, "a".repeat(21))).toThrow();
        expect(() => inventory.renamePet(uidOf(inventory, EGG_ID), "Yolk")).toThrow();
        expect(() => inventory.renamePet(uidOf(inventory, WEAPON_ID), "Yolk")).toThrow();
        expect(() => inventory.renamePet(uidOf(inventory, CHICKEN_EGG_ID), "Yolk")).toThrow();
        expect(inventory.get(catalana).nameTag).toBeUndefined();
    });

    test("a Name Tag is never spent on a pet", () => {
        inventory.add({ id: NAMETAG_ID });
        inventory.add({ id: CATALANA_ID });
        const nameTag = uidOf(inventory, NAMETAG_ID);
        const catalana = uidOf(inventory, CATALANA_ID);
        expect(() => inventory.renameItem(nameTag, catalana, "Henrietta")).toThrow();
        expect(() => inventory.addWithNameTag(nameTag, SILKIE_ID, "Fluff")).toThrow();
        expect(inventory.get(nameTag).isNameTag()).toBe(true);
        expect(inventory.get(catalana).nameTag).toBeUndefined();
        expect(inventory.size()).toBe(2);
    });

    test("a pet's name cannot be cleared", () => {
        inventory.add({ id: CATALANA_ID });
        const uid = uidOf(inventory, CATALANA_ID);
        inventory.renamePet(uid, "Henrietta");
        expect(() => inventory.clearNameTag(uid)).toThrow();
        expect(inventory.get(uid).nameTag).toBe("Henrietta");
    });

    test("edit writes a pet's name and style directly", () => {
        inventory.add({ id: CATALANA_ID, nameTag: "Henrietta", style: 2 });
        const uid = uidOf(inventory, CATALANA_ID);
        inventory.edit(uid, { nameTag: undefined, style: 9 });
        expect(inventory.get(uid).nameTag).toBeUndefined();
        expect(inventory.get(uid).style).toBe(9);
        expect(() => inventory.edit(uid, { style: 0 })).toThrow();
        expect(inventory.get(uid).style).toBe(9);
    });

    test("edit writes a pet's upgrade level directly", () => {
        inventory.add({ id: CATALANA_ID });
        const uid = uidOf(inventory, CATALANA_ID);
        inventory.edit(uid, { upgradeLevel: CS2_PET_PULLET_UPGRADE_LEVEL });
        expect(inventory.get(uid).upgradeLevel).toBe(CS2_PET_PULLET_UPGRADE_LEVEL);
        expect(() => inventory.edit(uid, { upgradeLevel: CS2_PET_CHICK_UPGRADE_LEVEL })).toThrow();
        expect(inventory.get(uid).upgradeLevel).toBe(CS2_PET_PULLET_UPGRADE_LEVEL);
        inventory.edit(uid, { upgradeLevel: undefined });
        expect(inventory.get(uid).getUpgradeLevel()).toBe(CS2_PET_HEN_UPGRADE_LEVEL);
    });

    test("nothing from the pet slot is deposited into a storage unit", () => {
        inventory.add({ id: STORAGE_UNIT_ID });
        const storage = uidOf(inventory, STORAGE_UNIT_ID);
        inventory.renameStorageUnit(storage, "Coop");
        for (const id of [CATALANA_ID, EGG_ID, CHICKEN_EGG_ID, CHICKEN_FEED_ID]) {
            inventory.add({ id });
            expect(() => inventory.depositToStorageUnit(storage, [uidOf(inventory, id)])).toThrow();
        }
        expect(inventory.size()).toBe(5);
    });

    test("a pet survives a round trip through the serialized form", () => {
        inventory.add({ id: CATALANA_ID, seed: 77777, style: 13, nameTag: "Henrietta", upgradeLevel: 2 });
        inventory.equip(uidOf(inventory, CATALANA_ID));
        const loaded = CS2Inventory.load(inventory.stringify(), { economy, ...noPolicy });
        const item = loaded.get(uidOf(loaded, CATALANA_ID));
        expect(item.seed).toBe(77777);
        expect(item.style).toBe(13);
        expect(item.upgradeLevel).toBe(2);
        expect(item.nameTag).toBe("Henrietta");
        expect(item.equipped).toBe(true);
        expect(loaded.loadChanges?.dropped).toEqual([]);
        expect(loaded.loadChanges?.repairedUids).toEqual([]);
    });
});
