/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import fetch from "node-fetch";
import english from "../assets/translations/items-english.json";
import { CS_Economy, CS_Item } from "./economy";
import { CS_ITEMS } from "./items";
import { fail } from "./util";

const itemMap = new Map<number, CS_Item>();
CS_Economy.use({ items: CS_ITEMS, translation: english as any });

test("has every types and categories", () => {
    const weaponCategories = new Set<string>();
    const itemTypes = new Set<string>();

    for (const item of CS_Economy.itemsAsArray) {
        itemMap.set(item.id, item);
        if (item.type === "weapon") {
            if (item.category === undefined) {
                fail("Weapon with category undefined.");
            }
            weaponCategories.add(item.category);
        }
        itemTypes.add(item.type);
    }

    const expectedWeaponCategories = ["c4", "equipment", "heavy", "rifle", "secondary", "smg"].sort();
    const expectedItemTypes = [
        "agent",
        "case",
        "collectible",
        "glove",
        "graffiti",
        "key",
        "melee",
        "musickit",
        "patch",
        "sticker",
        "tool",
        "weapon"
    ].sort();

    expect(Array.from(weaponCategories).sort()).toEqual(expectedWeaponCategories);
    expect(Array.from(itemTypes).sort()).toEqual(expectedItemTypes);
});

test("compare repository items with current items", async () => {
    const repositoryItems = (await (
        await fetch("https://raw.githubusercontent.com/ianlucas/cs2-lib/main/assets/data/items.json")
    ).json()) as CS_Item[];

    for (const repItem of repositoryItems) {
        const item = itemMap.get(repItem.id);
        if (item === undefined) {
            fail(`item not found.`);
        }
        expect(item.type).toBe(repItem.type);
        if (item.type === "weapon") {
            expect(item.category).toBe(repItem.category);
        }
        if (item.type === "agent") {
            expect(item.model).not.toBeUndefined();
        }
        switch (item.type) {
            case "agent":
                expect(item.name).toContain("Agent | ");
                break;
            case "case":
                expect(item.name).toContain("Container | ");
                break;
            case "collectible":
                expect(item.name).toContain("Collectible | ");
                break;
            case "glove":
                !item.free && !item.base && expect(item.name).toContain(" | ");
                break;
            case "graffiti":
                expect(item.name).toContain("Graffiti | ");
                break;
            case "key":
                expect(item.name).toContain("Key | ");
                break;
            case "melee":
                !item.free && !item.base && expect(item.name).toContain(" | ");
                break;
            case "musickit":
                expect(item.name).toContain("Music Kit | ");
                break;
            case "patch":
                expect(item.name).toContain("Patch | ");
                break;
            case "sticker":
                expect(item.name).toContain("Sticker | ");
                break;
            case "tool":
                expect(item.name).toContain("Tool | ");
                break;
            case "weapon":
                !item.free && !item.base && expect(item.name).toContain(" | ");
                break;
        }
        expect(item.def).toBe(repItem.def);
        expect(item.index).toBe(repItem.index);
    }
});
