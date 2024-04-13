import fetch from "node-fetch";
import { CS_Item } from "./economy";
import { CS_ITEMS } from "./items";
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
        expect(item.type).toBe((repItem.type as any) === "pin" ? "collectible" : repItem.type);
        if (item.type === "weapon") {
            expect(item.category).toBe(repItem.category);
        }
        if (item.type === "agent") {
            expect(item.model).not.toBeUndefined();
        }
        if (item.type === "musickit" && !repItem.name.startsWith("Music Kit | ")) {
            expect(item.name).toBe(`Music Kit | ${repItem.name}`);
        }
        if (item.type === "sticker" && !repItem.name.startsWith("Sticker | ")) {
            expect(item.name).toBe("Sticker | " + repItem.name);
        }
        if (item.type === "graffiti" && !repItem.name.startsWith("Graffiti | ")) {
            expect(item.name).toBe(`Graffiti | ${repItem.name}`);
        }
        if (item.type === "patch" && !repItem.name.startsWith("Patch | ")) {
            expect(item.name).toBe(`Patch | ${repItem.name}`);
        }
        expect(item.def).toBe(repItem.def);
        expect(item.index).toBe(repItem.index);
    }
});
