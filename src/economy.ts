/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    GRAFFITI_BOX_ID,
    MAX_FACTORY_NEW_WEAR,
    MAX_FIELD_TESTED_WEAR,
    MAX_MINIMAL_WEAR_WEAR,
    MAX_SEED,
    MAX_STATTRAK,
    MAX_STICKER_WEAR,
    MAX_WEAR,
    MAX_WELL_WORN_WEAR,
    MIN_SEED,
    MIN_STATTRAK,
    MIN_STICKER_WEAR,
    MIN_WEAR,
    NAMETAGGABLE_ITEMS,
    NAMETAG_RE,
    NAMETAG_TOOL_DEF,
    NONE,
    SEEDABLE_ITEMS,
    SOUVENIR_CASE_ID,
    STATTRAKABLE_ITEMS,
    STATTRAK_SWAP_TOOL_DEF,
    STICKERABLE_ITEMS,
    STICKER_CAPSULE_ID,
    STICKER_WEAR_FACTOR,
    STORAGE_UNIT_TOOL_DEF,
    TEAMS_BOTH,
    TEAMS_CT,
    TEAMS_T,
    WEAPON_CASE_ID,
    WEARABLE_ITEMS,
    WEAR_FACTOR
} from "./economy-constants.js";
import {
    BASE_ODD,
    RARITY_COLORS,
    RARITY_COLOR_DEFAULT,
    RARITY_COLOR_ORDER,
    RARITY_FOR_SOUNDS,
    RARITY_ORDER,
    STATTRAK_ODD,
    randomFloat,
    randomInt
} from "./economy-container.js";
import {
    Cs2Item,
    Cs2ItemLanguage,
    Cs2ItemLanguageFile,
    Cs2ItemTeam,
    Cs2ItemTeamValues,
    Cs2ItemType,
    Cs2ItemTypeValues,
    Cs2ItemWear,
    Cs2ItemWearValues
} from "./economy-types.js";
import { Cs2TeamValues } from "./teams.js";
import { Interface, assert, compare, ensure, safe } from "./utils.js";

type CSEconomyItemPredicate = Partial<Cs2EconomyItem> & { team?: Cs2TeamValues };

function filterItems(predicate: CSEconomyItemPredicate) {
    return function filter(item: Cs2EconomyItem) {
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

export class Cs2EconomyInstance {
    categories = new Set<string>();
    items = new Map<number, Cs2EconomyItem>();
    itemsAsArray: Cs2EconomyItem[] = [];
    stickers = new Set<Cs2EconomyItem>();

    use({ items, language }: { items: Cs2Item[]; language: Cs2ItemLanguageFile }) {
        this.categories.clear();
        this.items.clear();
        this.itemsAsArray = [];
        this.stickers.clear();
        for (const item of items) {
            const economyItem = new Cs2EconomyItem(this, item, ensure(language[item.id]));
            this.itemsAsArray.push(economyItem);
            this.items.set(item.id, economyItem);
            if (economyItem.isSticker()) {
                this.stickers.add(economyItem);
                this.categories.add(ensure(economyItem.category));
            }
        }
    }

    getById(id: number): Cs2EconomyItem {
        return ensure(this.items.get(id));
    }

    get(idOrItem: number | Cs2EconomyItem): Cs2EconomyItem {
        return typeof idOrItem === "number" ? this.getById(idOrItem) : idOrItem;
    }

    findItem(predicate: CSEconomyItemPredicate): Cs2EconomyItem {
        return ensure(this.itemsAsArray.find(filterItems(predicate)));
    }

    filterItems(predicate: CSEconomyItemPredicate): Cs2EconomyItem[] {
        const items = this.itemsAsArray.filter(filterItems(predicate));
        assert(items.length > 0, "No items found.");
        return items;
    }

    validateWear(wear?: number, item?: Cs2EconomyItem): boolean {
        if (wear === undefined) {
            return true;
        }
        assert(!Number.isNaN(wear), "Wear must be a number.");
        assert(String(wear).length <= String(WEAR_FACTOR).length, "Wear value is too long.");
        assert(wear >= MIN_WEAR && wear <= MAX_WEAR, "Wear value must be between MIN_WEAR and MAX_WEAR.");
        if (item !== undefined) {
            assert(item.hasWear(), "Item does not have wear.");
            assert(item.wearMin === undefined || wear >= item.wearMin, "Wear value is below the minimum allowed.");
            assert(item.wearMax === undefined || wear <= item.wearMax, "Wear value is above the maximum allowed.");
        }
        return true;
    }

    safeValidateWear(wear?: number, item?: Cs2EconomyItem): boolean {
        return safe(() => this.validateWear(wear, item));
    }

    validateSeed(seed?: number, item?: Cs2EconomyItem): boolean {
        if (seed === undefined) {
            return true;
        }
        assert(!Number.isNaN(seed), "Seed must be a valid number.");
        assert(item === undefined || item.hasSeed(), "Item does not have a seed.");
        assert(Number.isInteger(seed), "Seed must be an integer.");
        assert(seed >= MIN_SEED && seed <= MAX_SEED, `Seed must be between MIN_SEED and MAX_SEED.`);
        return true;
    }

    safeValidateSeed(seed?: number, item?: Cs2EconomyItem): boolean {
        return safe(() => this.validateSeed(seed, item));
    }

    validateStickers(stickers?: number[], wears?: number[], item?: Cs2EconomyItem): boolean {
        if (stickers === undefined) {
            assert(wears === undefined, "Stickers array is undefined.");
            return true;
        }
        assert(stickers.length === 4, "Stickers array must contain exactly 4 elements.");
        assert(wears === undefined || wears.length === 4, "Stickers wear array must contain exactly 4 elements.");
        assert(item === undefined || item.hasStickers(), "The provided item does not have stickers.");
        for (const [slot, stickerId] of stickers.entries()) {
            if (stickerId === NONE) {
                assert(wears === undefined || wears[slot] === NONE, "Sticker wear value is invalid.");
                continue;
            }
            this.get(stickerId).expectSticker();
            if (wears !== undefined) {
                const wear = wears[slot];
                assert(!Number.isNaN(wear), "Sticker wear value must be a valid number.");
                assert(String(wear).length <= String(STICKER_WEAR_FACTOR).length, "Sticker wear value is too long.");
                assert(
                    wear >= MIN_STICKER_WEAR && wear <= MAX_STICKER_WEAR,
                    "Sticker wear value must be between MIN_STICKER_WEAR and MAX_STICKER_WEAR."
                );
            }
        }
        return true;
    }

    trimNametag(nametag?: string): string | undefined {
        const trimmed = nametag?.trim();
        return trimmed === "" ? undefined : trimmed;
    }

    validateNametag(nametag?: string, item?: Cs2EconomyItem): boolean {
        if (nametag !== undefined) {
            assert(item === undefined || item.hasNametag(), "The provided item does not have a nametag.");
            assert(nametag[0] !== " " && NAMETAG_RE.test(nametag), "Invalid nametag format.");
        }
        return true;
    }

    safeValidateNametag(nametag?: string, item?: Cs2EconomyItem): boolean {
        return safe(() => this.validateNametag(nametag, item));
    }

    requireNametag(nametag?: string, item?: Cs2EconomyItem): boolean {
        assert(nametag === undefined || nametag.trim().length > 0, "Nametag is required.");
        return this.validateNametag(nametag, item);
    }

    safeRequireNametag(nametag?: string, item?: Cs2EconomyItem): boolean {
        return safe(() => this.requireNametag(nametag, item));
    }

    validateStatTrak(stattrak?: number, item?: Cs2EconomyItem): boolean {
        if (stattrak === undefined) {
            return true;
        }
        assert(item === undefined || item.hasStatTrak(), "The provided item does not support stattrak.");
        assert(Number.isInteger(stattrak), "Stattrak value must be an integer.");
        assert(
            stattrak >= MIN_STATTRAK && stattrak <= MAX_STATTRAK,
            "Stattrak value must be between MIN_STATTRAK and MAX_STATTRAK."
        );
        return true;
    }

    safeValidateStatTrak(stattrak?: number, item?: Cs2EconomyItem): boolean {
        return safe(() => this.validateStatTrak(stattrak, item));
    }

    getWearFromValue(value: number): Cs2ItemWearValues {
        switch (true) {
            case value <= MAX_FACTORY_NEW_WEAR:
                return Cs2ItemWear.FactoryNew;
            case value <= MAX_MINIMAL_WEAR_WEAR:
                return Cs2ItemWear.MinimalWear;
            case value <= MAX_FIELD_TESTED_WEAR:
                return Cs2ItemWear.FieldTested;
            case value <= MAX_WELL_WORN_WEAR:
                return Cs2ItemWear.WellWorn;
            default:
                return Cs2ItemWear.BattleScarred;
        }
    }

    getStickerCategories(): string[] {
        return Array.from(this.categories).sort();
    }

    getStickers(): Cs2EconomyItem[] {
        return Array.from(this.stickers);
    }

    resolveItemImage(baseUrl: string, item: number | Cs2EconomyItem, wear?: number): string {
        item = this.get(item);
        const { id, image } = item;
        if (item.hasWear() && wear !== undefined) {
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

    resolveCollectionImage(baseUrl: string, item: number | Cs2EconomyItem): string {
        const { collection } = this.get(item);
        assert(collection, "Item does not have a collection.");
        return `${baseUrl}/${collection}.png`;
    }

    resolveContainerSpecialsImage(baseUrl: string, item: number | Cs2EconomyItem): string {
        item = this.get(item).expectContainer();
        const { id, specialsImage, rawSpecials } = item;
        assert(rawSpecials, "Container does not have special items.");
        return specialsImage ? `${baseUrl}/${id}_rare.png` : `${baseUrl}/default_rare_item.png`;
    }

    validateContainerAndKey(containerItem: number | Cs2EconomyItem, keyItem?: number | Cs2EconomyItem) {
        containerItem = this.get(containerItem);
        containerItem.expectContainer();
        keyItem = keyItem !== undefined ? this.get(keyItem) : undefined;
        if (keyItem !== undefined) {
            keyItem.expectContainerKey();
            assert(containerItem.keys !== undefined, "Container does not require a key.");
            assert(containerItem.keys.includes(keyItem.id), "Invalid key for this container.");
        } else {
            assert(containerItem.keys === undefined, "Container requires a key.");
        }
        return true;
    }

    safeValidateContainerAndKey(containerItem: number | Cs2EconomyItem, keyItem?: number | Cs2EconomyItem) {
        return safe(() => this.validateContainerAndKey(containerItem, keyItem));
    }

    validateUnlockedItem(
        item: number | Cs2EconomyItem,
        { id }: ReturnType<InstanceType<typeof Cs2EconomyItem>["unlock"]>
    ) {
        item = this.get(item).expectContainer();
        assert(
            item.rawContents?.includes(id) || item.rawSpecials?.includes(id),
            `Unlocked item is not from this container.`
        );
    }
}

export class Cs2EconomyItem
    implements
        Interface<
            Omit<Cs2Item, "contents" | "specials" | "teams"> &
                Cs2ItemLanguage & {
                    contents: Cs2EconomyItem[] | undefined;
                    teams: Cs2TeamValues[] | undefined;
                }
        >
{
    altName: string | undefined;
    base: boolean | undefined;
    baseId: number | undefined;
    category: string | undefined;
    collection: string | undefined;
    collectionDesc: string | undefined;
    collectionName: string | undefined;
    def: number | undefined;
    desc: string | undefined;
    free: boolean | undefined;
    id: number = null!;
    image: string | undefined;
    index: number | undefined;
    keys: number[] | undefined;
    legacy: boolean | undefined;
    model: string | undefined;
    name: string = null!;
    rarity: string = null!;
    specialsImage: boolean | undefined;
    statTrakless: boolean | undefined;
    statTrakOnly: boolean | undefined;
    tint: number | undefined;
    tournamentDesc: string | undefined;
    type: Cs2ItemTypeValues = null!;
    voFallback: boolean | undefined;
    voFemale: boolean | undefined;
    voPrefix: string | undefined;
    wearMax: number | undefined;
    wearMin: number | undefined;

    private $contents: number[] | undefined;
    private $economyInstance: Cs2EconomyInstance;
    private $specials: number[] | undefined;
    private $teams: Cs2ItemTeamValues | undefined;

    constructor(economyInstance: Cs2EconomyInstance, item: Cs2Item, language: Cs2ItemLanguage) {
        this.$economyInstance = economyInstance;
        Object.assign(this, { ...item, teams: undefined });
        Object.assign(this, language);
        assert(this.id);
        assert(this.type);
        assert(this.name);
        assert(this.rarity);
        assert(this.type);
    }

    set contents(value: number[] | undefined) {
        this.$contents = value;
    }

    get contents(): Cs2EconomyItem[] {
        this.expectContainer();
        return ensure(this.$contents).map((id) => this.$economyInstance.get(id));
    }

    get parent(): Cs2EconomyItem | undefined {
        return this.baseId !== undefined ? this.$economyInstance.get(this.baseId) : undefined;
    }

    get rawContents(): number[] | undefined {
        return this.$contents;
    }

    get rawSpecials(): number[] | undefined {
        return this.$specials;
    }

    set specials(value: number[] | undefined) {
        this.$specials = value;
    }

    get specials(): Cs2EconomyItem[] | undefined {
        this.expectContainer();
        return this.$specials?.map((id) => this.$economyInstance.get(id));
    }

    set teams(value: Cs2ItemTeamValues) {
        this.$teams = value;
    }

    get teams(): Cs2TeamValues[] | undefined {
        switch (this.$teams) {
            case Cs2ItemTeam.Both:
                return TEAMS_BOTH;
            case Cs2ItemTeam.T:
                return TEAMS_T;
            case Cs2ItemTeam.CT:
                return TEAMS_CT;
            default:
                return undefined;
        }
    }

    isC4(): boolean {
        return this.category === "c4";
    }

    isSticker(): boolean {
        return this.type === Cs2ItemType.Sticker;
    }

    isGloves(): boolean {
        return this.type === Cs2ItemType.Gloves;
    }

    isStorageUnit(): boolean {
        return this.type === Cs2ItemType.Tool && this.def === STORAGE_UNIT_TOOL_DEF;
    }

    isNameTag(): boolean {
        return this.type === Cs2ItemType.Tool && this.def === NAMETAG_TOOL_DEF;
    }

    isStatTrakSwapTool(): boolean {
        return this.type === Cs2ItemType.Tool && this.def === STATTRAK_SWAP_TOOL_DEF;
    }

    isContainer(): boolean {
        return this.type === Cs2ItemType.Container;
    }

    isContainerKey(): boolean {
        return this.type === Cs2ItemType.ContainerKey;
    }

    expectSticker(): this {
        assert(this.isSticker(), "Expected a Sticker.");
        return this;
    }

    expectStorageUnit(): this {
        assert(this.isStorageUnit(), "Expected a Storage Unit.");
        return this;
    }

    expectNameTag(): this {
        assert(this.isNameTag(), "Expected a Name Tag.");
        return this;
    }

    expectStatTrakSwapTool(): this {
        assert(this.isStatTrakSwapTool(), "Expected a StatTrak Swap Tool.");
        return this;
    }

    expectContainer(): this {
        assert(this.isContainer(), "Expected a Container.");
        return this;
    }

    expectContainerKey(): this {
        assert(this.isContainerKey(), "Expected a Key.");
        return this;
    }

    hasWear(): boolean {
        return WEARABLE_ITEMS.includes(this.type) && !this.free && this.index !== 0;
    }

    hasSeed(): boolean {
        return SEEDABLE_ITEMS.includes(this.type) && !this.free && this.index !== 0;
    }

    hasStickers(): boolean {
        return STICKERABLE_ITEMS.includes(this.type) && !this.isC4();
    }

    hasNametag(): boolean {
        return NAMETAGGABLE_ITEMS.includes(this.type) || this.isStorageUnit();
    }

    hasStatTrak(): boolean {
        return STATTRAKABLE_ITEMS.includes(this.type) && !this.free;
    }

    isWeaponCase(): boolean {
        return this.category === this.$economyInstance.getById(WEAPON_CASE_ID).category;
    }

    isStickerCapsule(): boolean {
        return this.category === this.$economyInstance.getById(STICKER_CAPSULE_ID).category;
    }

    isGraffitiBox(): boolean {
        return this.category === this.$economyInstance.getById(GRAFFITI_BOX_ID).category;
    }

    isSouvenirCase(): boolean {
        return this.category === this.$economyInstance.getById(SOUVENIR_CASE_ID).category;
    }

    groupContents(): Record<string, Cs2EconomyItem[]> {
        const items: Record<string, Cs2EconomyItem[]> = {};
        const specials = this.specials;
        for (const item of this.contents) {
            const rarity = RARITY_COLORS[item.rarity];
            if (!items[rarity]) {
                items[rarity] = [];
            }
            items[rarity].push(item);
        }
        if (specials !== undefined) {
            for (const item of specials) {
                const rarity = "special";
                if (!items[rarity]) {
                    items[rarity] = [];
                }
                items[rarity].push(item);
            }
        }
        return items;
    }

    listContents(hideSpecials = false): Cs2EconomyItem[] {
        const specials = this.specials;
        const items = [...this.contents, ...(!hideSpecials && specials !== undefined ? specials : [])];
        return items.sort((a, b) => {
            return (
                (RARITY_COLOR_ORDER[a.rarity] ?? RARITY_COLOR_DEFAULT) -
                (RARITY_COLOR_ORDER[b.rarity] ?? RARITY_COLOR_DEFAULT)
            );
        });
    }

    unlock(): {
        attributes: {
            containerid: number;
            seed: number | undefined;
            stattrak: number | undefined;
            wear: number | undefined;
        };
        id: number;
        rarity: string;
        special: boolean;
    } {
        // @see https://www.csgo.com.cn/news/gamebroad/20170911/206155.shtml
        const contents = this.groupContents();
        const keys = Object.keys(contents);
        const rarities = RARITY_ORDER.filter((rarity) => keys.includes(rarity));
        const odds = rarities.map((_, index) => BASE_ODD / Math.pow(5, index));
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
        const hasStatTrak = this.statTrakless !== true;
        const alwaysStatTrak = this.statTrakOnly === true;
        return {
            attributes: {
                containerid: this.id,
                seed: unlocked.hasSeed() ? randomInt(MIN_SEED, MAX_SEED) : undefined,
                stattrak: hasStatTrak
                    ? unlocked.hasStatTrak()
                        ? alwaysStatTrak || Math.random() <= STATTRAK_ODD
                            ? 0
                            : undefined
                        : undefined
                    : undefined,
                wear: unlocked.hasWear()
                    ? Number(
                          randomFloat(unlocked.wearMin ?? MIN_WEAR, unlocked.wearMax ?? MAX_WEAR)
                              .toString()
                              .substring(0, WEAR_FACTOR.toString().length)
                      )
                    : undefined
            },
            id: unlocked.id,
            rarity: RARITY_FOR_SOUNDS[unlocked.rarity],
            special: rollRarity === "special"
        };
    }
}

export const Cs2Economy = new Cs2EconomyInstance();
