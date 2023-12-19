import { CS_ITEMS } from "./items";

test("has every weapon categories", () => {
    const weaponCategories = new Set<string>();
    const itemTypes = new Set<string>();

    for (const item of CS_ITEMS) {
        if (item.type === "weapon") {
            if (item.category === undefined) {
                throw new Error("weapon with category undefined.");
            }
            weaponCategories.add(item.category);
        }
        itemTypes.add(item.type);
    }

    expect(Array.from(weaponCategories)).toMatchObject(["rifle", "c4", "secondary", "heavy", "smg"]);
    expect(Array.from(itemTypes)).toMatchObject([
        "weapon",
        "glove",
        "melee",
        "musickit",
        "agent",
        "sticker",
        "pin",
        "case",
        "graffiti",
        "patch",
        "key",
        "tool"
    ]);
});
