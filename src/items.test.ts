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
        if (item.type === "key" && !repItem.name.startsWith("Key | ")) {
            expect(item.name).toBe(`Key | ${repItem.name}`);
        }
        if (item.type === "case" && !repItem.name.startsWith("Container | ")) {
            expect(item.name).toBe(`Container | ${repItem.name}`);
        }
        if (item.type === "tool" && !repItem.name.startsWith("Tool | ")) {
            expect(item.name).toBe(`Tool | ${repItem.name}`);
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
