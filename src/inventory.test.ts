/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CS_Economy } from "./economy";
import { CS_Inventory, CS_MutableInventory } from "./inventory";
import { CS_ITEMS } from "./items";
import { CS_TEAM_CT, CS_TEAM_T } from "./teams";

CS_Economy.initialize(CS_ITEMS);

function run(inventory: CS_Inventory | CS_MutableInventory) {
    test("initially is empty", () => {
        expect(inventory.getItems().length).toBe(0);
    });
    test("added one item", () => {
        inventory = inventory.add({
            id: 307
        });
        expect(inventory.getItems().length).toBe(1);
    });
    test("try to invalid item", () => {
        // this is a sticker item.
        inventory = inventory.safeAdd({
            id: 5683,
            wear: 8,
            stattrak: 2
        });
        expect(inventory.getItems().length).toBe(1);
    });
    test("try to add more than limit", () => {
        for (let i = 0; i < 5; i++) {
            inventory = inventory.add({
                id: 307
            });
        }
        expect(inventory.full()).toBeTruthy();
        expect(inventory.getItems().length).toBe(5);
    });
    test("equip item to T and CT", () => {
        inventory = inventory.equip(0, CS_TEAM_CT);
        inventory = inventory.equip(0, CS_TEAM_T);
        const inventoryItem = inventory.getItems()[0];
        expect(inventoryItem.equippedCT).toBeTruthy();
        expect(inventoryItem.equippedT).toBeTruthy();
    });
    test("remove item", () => {
        inventory = inventory.remove(1);
        expect(inventory.getItems().length).toBe(4);
    });
    test("unequip item", () => {
        let inventoryItem = inventory.getItems()[0];
        expect(inventoryItem.equippedCT).toBeTruthy();
        expect(inventoryItem.equippedT).toBeTruthy();
        inventory = inventory.unequip(0, CS_TEAM_CT);
        inventory = inventory.unequip(0, CS_TEAM_T);
        inventoryItem = inventory.getItems()[0];
        expect(inventoryItem.equippedCT).toBeUndefined();
        expect(inventoryItem.equippedT).toBeUndefined();
    });
}

run(new CS_Inventory([], 5));
run(new CS_MutableInventory([], 5));
