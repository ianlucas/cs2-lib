import { CS_Item } from "./economy";
import { CS_ITEMS } from "./items";
import fetch from "node-fetch";
import { fail } from "./util";

const itemMap = new Map<number, CS_Item>();

test("has every types and categories", () => {
    const weaponCategories = new Set<string>();
    const itemTypes = new Set<string>();

    for (const item of CS_ITEMS) {
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
        "glove",
        "graffiti",
        "key",
        "melee",
        "musickit",
        "patch",
        "pin",
        "sticker",
        "tool",
        "weapon"
    ].sort();

    expect(Array.from(weaponCategories).sort()).toEqual(expectedWeaponCategories);
    expect(Array.from(itemTypes).sort()).toEqual(expectedItemTypes);
});

test("compare repository items with current items", async () => {
    const repositoryItems = (await (
        await fetch("https://raw.githubusercontent.com/ianlucas/cslib/main/assets/data/items.json")
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
        expect(item.def).toBe(repItem.def);
        expect(item.index).toBe(repItem.index);
    }
});
