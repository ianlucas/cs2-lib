import { CS_Item } from "./economy";
import { CS_ITEMS } from "./items";
import fetch from "node-fetch";

const itemMap = new Map<number, CS_Item>();

test("has every types and categories", () => {
    const weaponCategories = new Set<string>();
    const itemTypes = new Set<string>();

    for (const item of CS_ITEMS) {
        itemMap.set(item.id, item);
        if (item.type === "weapon") {
            if (item.category === undefined) {
                throw new Error("weapon with category undefined.");
            }
            weaponCategories.add(item.category);
        }
        itemTypes.add(item.type);
    }

    expect(Array.from(weaponCategories).sort()).toMatchObject(["c4", "heavy", "rifle", "secondary", "smg"].sort());
    expect(Array.from(itemTypes).sort()).toMatchObject(
        [
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
        ].sort()
    );
});

test("compare repository items with current items", async () => {
    const repositoryItems = (await (
        await fetch("https://raw.githubusercontent.com/ianlucas/cslib/main/assets/data/items.json")
    ).json()) as CS_Item[];

    for (const repItem of repositoryItems) {
        const item = itemMap.get(repItem.id);
        if (item === undefined) {
            throw new Error(`item not found.`);
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
