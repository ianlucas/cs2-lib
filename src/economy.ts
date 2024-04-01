/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    CS_BASE_ODD,
    CS_RARITY_COLORS,
    CS_RARITY_COLOR_DEFAULT,
    CS_RARITY_COLOR_ORDER,
    CS_RARITY_FOR_SOUNDS,
    CS_RARITY_ORDER,
    CS_STATTRAK_ODD,
    CS_randomFloat,
    CS_randomInt
} from "./economy-case.js";
import { CS_Team } from "./teams.js";
import { assert, compare, safe } from "./util.js";

export interface CS_Item {
    altname?: string;
    base?: boolean;
    category?: string;
    collection?: string;
    collectiondesc?: string;
    collectionname?: string;
    contents?: number[];
    def?: number;
    free?: boolean;
    id: number;
    image?: string;
    index?: number;
    keys?: number[];
    legacy?: boolean;
    model?: string;
    name: string;
    specials?: number[];
    specialsimage?: boolean;
    stattrakonly?: boolean;
    stattrakless?: boolean;
    rarity: string;
    teams?: CS_Team[];
    tint?: number;
    type:
        | "agent"
        | "case"
        | "glove"
        | "graffiti"
        | "key"
        | "melee"
        | "musickit"
        | "patch"
        | "pin"
        | "sticker"
        | "tool"
        | "weapon";
    wearmax?: number;
    wearmin?: number;
}

export type CS_ItemTranslations = Record<string, Record<number, Record<string, string>>>;

export const CS_MIN_STATTRAK = 0;
export const CS_MAX_STATTRAK = 999999;
export const CS_WEAR_FACTOR = 0.000001;
export const CS_MIN_WEAR = 0;
export const CS_MAX_WEAR = 1;
export const CS_DEFAULT_MIN_WEAR = 0.06;
export const CS_DEFAULT_MAX_WEAR = 0.8;
export const CS_MIN_FACTORY_NEW_WEAR = CS_MIN_WEAR;
export const CS_MAX_FACTORY_NEW_WEAR = 0.07;
export const CS_MIN_MINIMAL_WEAR_WEAR = 0.070001;
export const CS_MAX_MINIMAL_WEAR_WEAR = 0.15;
export const CS_MIN_FIELD_TESTED_WEAR = 0.150001;
export const CS_MAX_FIELD_TESTED_WEAR = 0.37;
export const CS_MIN_WELL_WORN_WEAR = 0.370001;
export const CS_MAX_WELL_WORN_WEAR = 0.44;
export const CS_MIN_BATTLE_SCARRED_WEAR = 0.440001;
export const CS_MAX_BATTLE_SCARRED_WEAR = CS_MAX_WEAR;
export const CS_MIN_SEED = 1;
export const CS_MAX_SEED = 1000;
export const CS_WEARABLE_ITEMS = ["glove", "melee", "weapon"];
export const CS_NAMETAGGABLE_ITEMS = ["melee", "weapon"];
export const CS_SEEDABLE_ITEMS = ["weapon", "melee", "glove"];
export const CS_STATTRAKABLE_ITEMS = ["melee", "weapon", "musickit"];
export const CS_STICKERABLE_ITEMS = ["weapon"];
export const CS_NAMETAG_RE =
    /^[A-Za-z0-9`!@#$%^&*-+=(){}\[\]\/\|\\,.?:;'_\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\s]{0,20}$/u;
export const CS_STICKER_WEAR_FACTOR = 0.1;
export const CS_MIN_STICKER_WEAR = 0;
export const CS_MAX_STICKER_WEAR = 0.9;
export const CS_NAMETAG_TOOL_DEF = 1200;
export const CS_STATTRAK_SWAP_TOOL_DEF = 1324;
export const CS_STORAGE_UNIT_TOOL_DEF = 1201;
export const CS_NONE = 0;

type CS_EconomyPredicate = Partial<CS_Item> & { team?: CS_Team };

function filterItems(predicate: CS_EconomyPredicate) {
    return function filter(item: CS_Item) {
        return (
            compare(predicate.type, item.type) &&
            compare(predicate.free, item.free) &&
            compare(predicate.model, item.model) &&
            compare(predicate.base, item.base) &&
            compare(predicate.category, item.category) &&
            (predicate.team === undefined || item.teams === undefined || item.teams.includes(predicate.team))
        );
    };
}

export class CS_EconomyInstance {
    categories = new Set<string>();
    items = new Map<number, CS_Item>();
    itemsAsArray: CS_Item[] = [];
    texts = new Map<number, Record<string, string>>();
    stickers = new Set<CS_Item>();

    use(items: CS_Item[]) {
        this.categories.clear();
        this.items.clear();
        this.itemsAsArray = [];
        this.texts.clear();
        this.stickers.clear();
        for (const item of items) {
            const clone = { ...item };
            this.itemsAsArray.push(clone);
            this.items.set(item.id, clone);
            this.texts.set(item.id, {
                name: item.name,
                category: item.category!,
                collectionname: item.collectionname!,
                collectiondesc: item.collectiondesc!
            });
            if (this.isSticker(item)) {
                assert(item.category, `Sticker item '${item.id}' does not have a category.`);
                this.stickers.add(clone);
                this.categories.add(item.category);
            }
        }
    }

    getById(id: number) {
        const item = this.items.get(id);
        assert(item, `The given id '${id}' was not present in CS_Economy.items.`);
        return item;
    }

    get(idOrItem: number | CS_Item) {
        return typeof idOrItem === "number" ? this.getById(idOrItem) : idOrItem;
    }

    applyTranslation(translation: CS_ItemTranslations[number]) {
        this.categories.clear();
        for (const [id, fields] of this.texts.entries()) {
            const item = this.items.get(Number(id));
            if (item === undefined) {
                continue;
            }
            Object.assign(item, fields);
            if (fields.category !== undefined && item.type === "sticker") {
                this.categories.add(fields.category);
            }
        }
        for (const [id, fields] of Object.entries(translation)) {
            const item = this.items.get(Number(id));
            if (item === undefined) {
                continue;
            }
            Object.assign(item, fields);
            if (fields.category !== undefined && item.type === "sticker") {
                this.categories.add(fields.category);
            }
        }
    }

    findItem(predicate: CS_EconomyPredicate): CS_Item {
        const item = this.itemsAsArray.find(filterItems(predicate));
        assert(item, "No items found.");
        return item;
    }

    filterItems(predicate: CS_EconomyPredicate): CS_Item[] {
        const items = this.itemsAsArray.filter(filterItems(predicate));
        assert(items.length > 0, "No items found.");
        return items;
    }

    isC4(item: number | CS_Item): boolean {
        return this.get(item).category === "c4";
    }

    isSticker(item: number | CS_Item): boolean {
        return this.get(item).type === "sticker";
    }

    isGlove(item: number | CS_Item): boolean {
        return this.get(item).type === "glove";
    }

    expectSticker(item: number | CS_Item) {
        assert(this.isSticker(item), `Item is not a sticker.`);
        return true;
    }

    hasWear(item: CS_Item): boolean {
        return CS_WEARABLE_ITEMS.includes(item.type) && !item.free && item.index !== 0;
    }

    validateWear(wear?: number, item?: CS_Item): boolean {
        if (wear === undefined) {
            return true;
        }
        assert(!Number.isNaN(wear), "Wear must be a number.");
        assert(String(wear).length <= String(CS_WEAR_FACTOR).length, "Wear value is too long.");
        assert(wear >= CS_MIN_WEAR && wear <= CS_MAX_WEAR, "Wear value must be between CS_MIN_WEAR and CS_MAX_WEAR.");
        if (item !== undefined) {
            assert(this.hasWear(item), "Item does not have wear.");
            assert(item.wearmin === undefined || wear >= item.wearmin, "Wear value is below the minimum allowed.");
            assert(item.wearmax === undefined || wear <= item.wearmax, "Wear value is above the maximum allowed.");
        }
        return true;
    }

    safeValidateWear = safe(this.validateWear);

    hasSeed(item: CS_Item): boolean {
        return CS_SEEDABLE_ITEMS.includes(item.type) && !item.free && item.index !== 0;
    }

    validateSeed(seed?: number, item?: CS_Item): boolean {
        if (seed === undefined) {
            return true;
        }
        assert(!Number.isNaN(seed), "Seed must be a valid number.");
        assert(item === undefined || this.hasSeed(item), "Item does not have a seed.");
        assert(Number.isInteger(seed), "Seed must be an integer.");
        assert(seed >= CS_MIN_SEED && seed <= CS_MAX_SEED, `Seed must be between CS_MIN_SEED and CS_MAX_SEED.`);
        return true;
    }

    safeValidateSeed = safe(this.validateSeed);

    hasStickers(item: CS_Item): boolean {
        return CS_STICKERABLE_ITEMS.includes(item.type) && !this.isC4(item);
    }

    validateStickers(stickers?: number[], wears?: number[], item?: CS_Item): boolean {
        if (stickers === undefined) {
            assert(wears === undefined, "Stickers array is undefined.");
            return true;
        }
        assert(stickers.length === 4, "Stickers array must contain exactly 4 elements.");
        assert(wears === undefined || wears.length === 4, "Stickers wear array must contain exactly 4 elements.");
        assert(item === undefined || this.hasStickers(item), "The provided item does not have stickers.");
        for (const [index, stickerId] of stickers.entries()) {
            if (stickerId === CS_NONE) {
                assert(wears === undefined || wears[index] === CS_NONE, "Sticker wear value is invalid.");
                continue;
            }
            assert(this.isSticker(stickerId), "The provided ID does not correspond to a sticker.");
            if (wears !== undefined) {
                const wear = wears[index];
                assert(!Number.isNaN(wear), "Sticker wear value must be a valid number.");
                assert(String(wear).length <= String(CS_STICKER_WEAR_FACTOR).length, "Sticker wear value is too long.");
                assert(
                    wear >= CS_MIN_STICKER_WEAR && wear <= CS_MAX_STICKER_WEAR,
                    "Sticker wear value must be between CS_MIN_STICKER_WEAR and CS_MAX_STICKER_WEAR."
                );
            }
        }
        return true;
    }

    hasNametag(item: CS_Item): boolean {
        return CS_NAMETAGGABLE_ITEMS.includes(item.type) || this.isStorageUnitTool(item);
    }

    trimNametag(nametag?: string) {
        const trimmed = nametag?.trim();
        return trimmed === "" ? undefined : trimmed;
    }

    validateNametag(nametag?: string, item?: CS_Item): boolean {
        if (nametag !== undefined) {
            assert(item === undefined || this.hasNametag(item), "The provided item does not have a nametag.");
            assert(nametag[0] !== " " && CS_NAMETAG_RE.test(nametag), "Invalid nametag format.");
        }
        return true;
    }

    safeValidateNametag = safe(this.validateNametag);

    requireNametag(nametag?: string, item?: CS_Item): boolean {
        assert(nametag === undefined || nametag.trim().length > 0, "Nametag is required.");
        return this.validateNametag(nametag, item);
    }

    safeRequireNametag = safe(this.requireNametag);

    hasStatTrak(item: CS_Item): boolean {
        return CS_STATTRAKABLE_ITEMS.includes(item.type) && !item.free;
    }

    validateStatTrak(stattrak?: number, item?: CS_Item): boolean {
        if (stattrak === undefined) {
            return true;
        }
        assert(item === undefined || this.hasStatTrak(item), "The provided item does not support stattrak.");
        assert(Number.isInteger(stattrak), "Stattrak value must be an integer.");
        assert(
            stattrak >= CS_MIN_STATTRAK && stattrak <= CS_MAX_STATTRAK,
            "Stattrak value must be between CS_MIN_STATTRAK and CS_MAX_STATTRAK."
        );
        return true;
    }

    safeValidateStatTrak = safe(this.validateStatTrak);

    isStorageUnitTool(item: number | CS_Item): boolean {
        const { def, type } = this.get(item);
        return type === "tool" && def === CS_STORAGE_UNIT_TOOL_DEF;
    }

    expectStorageUnitTool(item: CS_Item) {
        assert(this.isStorageUnitTool(item), "Item is not a storage unit.");
        return true;
    }

    isNametagTool(toolItem: number | CS_Item): boolean {
        const { def, type } = this.get(toolItem);
        return type === "tool" && def === CS_NAMETAG_TOOL_DEF;
    }

    expectNametagTool(item: number | CS_Item) {
        assert(this.isNametagTool(item), "Item is not a nametag tool");
        return true;
    }

    isStatTrakSwapTool(item: number | CS_Item): boolean {
        const { def, type } = this.get(item);
        return type === "tool" && def === CS_STATTRAK_SWAP_TOOL_DEF;
    }

    expectStatTrakSwapTool(item: CS_Item) {
        assert(this.isStatTrakSwapTool(item), "Item is not a stattrak swap tool.");
        return true;
    }

    getWearLabel(wear: number): string {
        switch (true) {
            case wear <= CS_MAX_FACTORY_NEW_WEAR:
                return "FN";
            case wear <= CS_MAX_MINIMAL_WEAR_WEAR:
                return "MW";
            case wear <= CS_MAX_FIELD_TESTED_WEAR:
                return "FT";
            case wear <= CS_MAX_WELL_WORN_WEAR:
                return "WW";
            default:
                return "BS";
        }
    }

    getStickerCategories(): string[] {
        return Array.from(this.categories).sort();
    }

    getStickers(): CS_Item[] {
        return Array.from(this.stickers);
    }

    resolveItemImage(baseUrl: string, item: number | CS_Item, wear?: number): string {
        item = this.get(item);
        const { id, image } = item;
        if (this.hasWear(item) && wear !== undefined) {
            switch (true) {
                case wear < 1 / 3:
                    return `${baseUrl}/${id}_light.png`;
                case wear < 2 / 3:
                    return `${baseUrl}/${id}_medium.png`;
                default:
                    return `${baseUrl}/${id}_heavy.png`;
            }
        }
        if (image === undefined) {
            return `${baseUrl}/${id}.png`;
        }
        if (image.charAt(0) === "/") {
            return `${baseUrl}${image}`;
        }
        return image;
    }

    resolveCollectionImage(baseUrl: string, item: number | CS_Item): string {
        item = this.get(item);
        const { collection } = item;
        assert(collection, "Item does not have a collection.");
        return `${baseUrl}/${collection}.png`;
    }

    isCase(item: number | CS_Item) {
        return this.get(item).type === "case";
    }

    isKey(item: number | CS_Item) {
        return this.get(item).type === "key";
    }

    expectCase(item: number | CS_Item) {
        assert(this.isCase(item), "Item is not a case.");
        return true;
    }

    expectKey(item: number | CS_Item) {
        assert(this.isKey(item), `Item is not a key.`);
        return true;
    }

    validateCaseKey(caseItem: number | CS_Item, keyItem?: number | CS_Item) {
        caseItem = this.get(caseItem);
        this.expectCase(caseItem);
        keyItem = keyItem !== undefined ? this.get(keyItem) : undefined;
        if (keyItem !== undefined) {
            assert(caseItem.keys !== undefined, "Case does not require a key.");
            assert(this.expectKey(keyItem), "Invalid key item.");
            assert(caseItem.keys.includes(keyItem.id), "Invalid key for this case.");
        } else {
            assert(caseItem.keys === undefined, "Case requires a key.");
        }
    }

    safeValidateCaseKey = safe(this.validateCaseKey);

    getCaseContents(item: number | CS_Item) {
        item = this.get(item);
        this.expectCase(item);
        const { contents, specials } = item;
        assert(contents, `Case has no contents.`);
        return { contents, specials };
    }

    groupCaseContents(item: number | CS_Item) {
        const { contents, specials } = this.getCaseContents(item);
        const items: Record<string, CS_Item[]> = {};
        for (const id of contents) {
            const item = this.getById(id);
            const rarity = CS_RARITY_COLORS[item.rarity];
            if (!items[rarity]) {
                items[rarity] = [];
            }
            items[rarity].push(item);
        }
        if (specials) {
            for (const id of specials) {
                const item = this.getById(id);
                const rarity = "special";
                if (!items[rarity]) {
                    items[rarity] = [];
                }
                items[rarity].push(item);
            }
        }
        return items;
    }

    listCaseContents(item: number | CS_Item, hideSpecials = false) {
        const { contents, specials } = this.getCaseContents(item);
        const items = [...contents, ...(!hideSpecials && specials !== undefined ? specials : [])];
        return items
            .map((id) => this.getById(id))
            .sort((a, b) => {
                return (
                    (CS_RARITY_COLOR_ORDER[a.rarity] ?? CS_RARITY_COLOR_DEFAULT) -
                    (CS_RARITY_COLOR_ORDER[b.rarity] ?? CS_RARITY_COLOR_DEFAULT)
                );
            });
    }

    /**
     * @see https://www.csgo.com.cn/news/gamebroad/20170911/206155.shtml
     */
    unlockCase(item: number | CS_Item) {
        item = this.get(item);
        const contents = this.groupCaseContents(item);
        const keys = Object.keys(contents);
        const rarities = CS_RARITY_ORDER.filter((rarity) => keys.includes(rarity));
        const odds = rarities.map((_, index) => CS_BASE_ODD / Math.pow(5, index));
        const total = odds.reduce((acc, cur) => acc + cur, 0);
        const entries = rarities.map((rarity, index) => [rarity, odds[index] / total] as const);
        const roll = Math.random();
        let [rollRarity] = entries[0];
        let acc = 0;
        for (const [rarity, odd] of entries) {
            acc += odd;
            if (roll <= acc) {
                rollRarity = rarity;
                break;
            }
        }
        const unlocked = contents[rollRarity][Math.floor(Math.random() * contents[rollRarity].length)];
        const hasStatTrak = item.stattrakless !== true;
        const alwaysStatTrak = item.stattrakonly === true;
        return {
            attributes: {
                seed: this.hasSeed(unlocked) ? CS_randomInt(CS_MIN_SEED, CS_MAX_SEED) : undefined,
                stattrak: hasStatTrak
                    ? this.hasStatTrak(unlocked)
                        ? alwaysStatTrak || Math.random() <= CS_STATTRAK_ODD
                            ? 0
                            : undefined
                        : undefined
                    : undefined,
                wear: this.hasWear(unlocked)
                    ? Number(
                          CS_randomFloat(unlocked.wearmin ?? CS_MIN_WEAR, unlocked.wearmax ?? CS_MAX_WEAR)
                              .toString()
                              .substring(0, CS_WEAR_FACTOR.toString().length)
                      )
                    : undefined
            },
            id: unlocked.id,
            rarity: CS_RARITY_FOR_SOUNDS[unlocked.rarity],
            special: rollRarity === "special"
        };
    }

    validateUnlockedItem(item: number | CS_Item, { id }: ReturnType<typeof this.unlockCase>) {
        item = this.get(item);
        this.expectCase(item);
        const { contents, specials } = item;
        assert(contents?.includes(id) || specials?.includes(id), `Unlocked item is not from this case.`);
    }

    resolveCaseSpecialsImage(baseUrl: string, item: number | CS_Item): string {
        item = this.get(item);
        this.expectCase(item);
        const { id, specialsimage, specials } = item;
        assert(specials, "Case does not have special items.");
        if (specialsimage) {
            return `${baseUrl}/${id}_rare.png`;
        }
        return `${baseUrl}/default_rare_item.png`;
    }
}

export const CS_Economy = new CS_EconomyInstance();
