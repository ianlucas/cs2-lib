/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    CS2_CONTAINER_OR_TOOL_ITEM,
    CS2_MAX_FACTORY_NEW_WEAR,
    CS2_MAX_FIELD_TESTED_WEAR,
    CS2_MAX_MINIMAL_WEAR_WEAR,
    CS2_MAX_SEED,
    CS2_MAX_STATTRAK,
    CS2_MAX_WEAR,
    CS2_MAX_WELL_WORN_WEAR,
    CS2_MIN_SEED,
    CS2_MIN_STATTRAK,
    CS2_MIN_WEAR,
    CS2_NAMETAGGABLE_ITEMS,
    CS2_NAMETAG_RE,
    CS2_NAMETAG_TOOL_DEF,
    CS2_SEEDABLE_ITEMS,
    CS2_STATTRAKABLE_ITEMS,
    CS2_STATTRAK_SWAP_TOOL_DEF,
    CS2_STICKERABLE_ITEMS,
    CS2_STORAGE_UNIT_TOOL_DEF,
    CS2_TEAMS_BOTH,
    CS2_TEAMS_CT,
    CS2_TEAMS_T,
    CS2_WEARABLE_ITEMS,
    CS2_WEAR_FACTOR
} from "./economy-constants.js";
import {
    CS2RarityColorName,
    CS2RarityColorOrder,
    CS2RarityColorValues,
    CS2RaritySoundName,
    CS2RaritySoundNameValues,
    CS2_BASE_ODD,
    CS2_RARITY_COLOR_DEFAULT,
    CS2_RARITY_ORDER,
    CS2_STATTRAK_ODD,
    randomFloat,
    randomInt
} from "./economy-container.js";
import {
    CS2ContainerType,
    CS2ContainerTypeValues,
    CS2Item,
    CS2ItemLocalization,
    CS2ItemLocalizationMap,
    CS2ItemTeam,
    CS2ItemTeamValues,
    CS2ItemType,
    CS2ItemTypeValues,
    CS2ItemWear,
    CS2ItemWearValues
} from "./economy-types.js";
import { CS2TeamValues } from "./teams.js";
import { Interface, assert, compare, ensure, safe } from "./utils.js";

type CS2EconomyItemPredicate = Partial<CS2EconomyItem> & { team?: CS2TeamValues };

function filterItems(predicate: CS2EconomyItemPredicate): (item: CS2EconomyItem) => boolean {
    return function filter(item: CS2EconomyItem) {
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

export class CS2EconomyInstance {
    categories = new Set<string>();
    items = new Map<number, CS2EconomyItem>();
    itemsAsArray: CS2EconomyItem[] = [];
    stickers = new Set<CS2EconomyItem>();

    use({ items, language }: { items: CS2Item[]; language: CS2ItemLocalizationMap }) {
        this.categories.clear();
        this.items.clear();
        this.stickers.clear();
        this.itemsAsArray = [];
        for (const item of items) {
            if (item.type === CS2ItemType.Stub) {
                continue;
            }
            const economyItem = new CS2EconomyItem(this, item, ensure(language[item.id]));
            this.items.set(item.id, economyItem);
            if (economyItem.isSticker()) {
                this.stickers.add(economyItem);
                this.categories.add(ensure(economyItem.category));
            }
            this.itemsAsArray.push(economyItem);
        }
    }

    getById(id: number): CS2EconomyItem {
        return ensure(this.items.get(id));
    }

    get(idOrItem: number | CS2EconomyItem): CS2EconomyItem {
        return typeof idOrItem === "number" ? this.getById(idOrItem) : idOrItem;
    }

    findItem(predicate: CS2EconomyItemPredicate): CS2EconomyItem {
        return ensure(this.itemsAsArray.find(filterItems(predicate)));
    }

    filterItems(predicate: CS2EconomyItemPredicate): CS2EconomyItem[] {
        const items = this.itemsAsArray.filter(filterItems(predicate));
        assert(items.length > 0, "No items found.");
        return items;
    }

    validateWear(wear?: number, item?: CS2EconomyItem): boolean {
        if (wear === undefined) {
            return true;
        }
        assert(!Number.isNaN(wear), "Wear must be a number.");
        assert(String(wear).length <= String(CS2_WEAR_FACTOR).length, "Wear value is too long.");
        assert(wear >= CS2_MIN_WEAR && wear <= CS2_MAX_WEAR, "Wear value must be between CS_MIN_WEAR and CS_MAX_WEAR.");
        if (item !== undefined) {
            assert(item.hasWear(), "Item does not have wear.");
            assert(item.wearMin === undefined || wear >= item.wearMin, "Wear value is below the minimum allowed.");
            assert(item.wearMax === undefined || wear <= item.wearMax, "Wear value is above the maximum allowed.");
        }
        return true;
    }

    safeValidateWear(wear?: number, item?: CS2EconomyItem): boolean {
        return safe(() => this.validateWear(wear, item));
    }

    validateSeed(seed?: number, item?: CS2EconomyItem): boolean {
        if (seed === undefined) {
            return true;
        }
        assert(!Number.isNaN(seed), "Seed must be a valid number.");
        assert(item === undefined || item.hasSeed(), "Item does not have a seed.");
        assert(Number.isInteger(seed), "Seed must be an integer.");
        assert(seed >= CS2_MIN_SEED && seed <= CS2_MAX_SEED, `Seed must be between CS_MIN_SEED and CS_MAX_SEED.`);
        return true;
    }

    safeValidateSeed(seed?: number, item?: CS2EconomyItem): boolean {
        return safe(() => this.validateSeed(seed, item));
    }

    trimNametag(nametag?: string): string | undefined {
        const trimmed = nametag?.trim();
        return trimmed === "" ? undefined : trimmed;
    }

    validateNametag(nametag?: string, item?: CS2EconomyItem): boolean {
        if (nametag !== undefined) {
            assert(item === undefined || item.hasNametag(), "The provided item does not have a nametag.");
            assert(nametag[0] !== " " && CS2_NAMETAG_RE.test(nametag), "Invalid nametag format.");
        }
        return true;
    }

    safeValidateNametag(nametag?: string, item?: CS2EconomyItem): boolean {
        return safe(() => this.validateNametag(nametag, item));
    }

    requireNametag(nametag?: string, item?: CS2EconomyItem): boolean {
        assert(nametag === undefined || nametag.trim().length > 0, "Nametag is required.");
        return this.validateNametag(nametag, item);
    }

    safeRequireNametag(nametag?: string, item?: CS2EconomyItem): boolean {
        return safe(() => this.requireNametag(nametag, item));
    }

    validateStatTrak(stattrak?: number, item?: CS2EconomyItem): boolean {
        if (stattrak === undefined) {
            return true;
        }
        assert(item === undefined || item.hasStatTrak(), "The provided item does not support stattrak.");
        assert(Number.isInteger(stattrak), "Stattrak value must be an integer.");
        assert(
            stattrak >= CS2_MIN_STATTRAK && stattrak <= CS2_MAX_STATTRAK,
            "Stattrak value must be between CS_MIN_STATTRAK and CS_MAX_STATTRAK."
        );
        return true;
    }

    safeValidateStatTrak(stattrak?: number, item?: CS2EconomyItem): boolean {
        return safe(() => this.validateStatTrak(stattrak, item));
    }

    getWearFromValue(value: number): CS2ItemWearValues {
        switch (true) {
            case value <= CS2_MAX_FACTORY_NEW_WEAR:
                return CS2ItemWear.FactoryNew;
            case value <= CS2_MAX_MINIMAL_WEAR_WEAR:
                return CS2ItemWear.MinimalWear;
            case value <= CS2_MAX_FIELD_TESTED_WEAR:
                return CS2ItemWear.FieldTested;
            case value <= CS2_MAX_WELL_WORN_WEAR:
                return CS2ItemWear.WellWorn;
            default:
                return CS2ItemWear.BattleScarred;
        }
    }

    getStickerCategories(): string[] {
        return Array.from(this.categories).sort();
    }

    getStickers(): CS2EconomyItem[] {
        return Array.from(this.stickers);
    }

    resolveItemImage(baseUrl: string, item: number | CS2EconomyItem, wear?: number): string {
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

    resolveCollectionImage(baseUrl: string, item: number | CS2EconomyItem): string {
        const { collection } = this.get(item);
        assert(collection, "Item does not have a collection.");
        return `${baseUrl}/${collection}.png`;
    }

    resolveContainerSpecialsImage(baseUrl: string, item: number | CS2EconomyItem): string {
        item = this.get(item).expectContainer();
        const { id, specialsImage, rawSpecials } = item;
        assert(rawSpecials, "Container does not have special items.");
        return specialsImage ? `${baseUrl}/${id}_rare.png` : `${baseUrl}/default_rare_item.png`;
    }

    validateContainerAndKey(containerItem: number | CS2EconomyItem, keyItem?: number | CS2EconomyItem): boolean {
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

    safeValidateContainerAndKey(containerItem: number | CS2EconomyItem, keyItem?: number | CS2EconomyItem): boolean {
        return safe(() => this.validateContainerAndKey(containerItem, keyItem));
    }

    validateUnlockedItem(
        item: number | CS2EconomyItem,
        { id }: ReturnType<InstanceType<typeof CS2EconomyItem>["unlock"]>
    ): void {
        item = this.get(item).expectContainer();
        assert(
            item.rawContents?.includes(id) || item.rawSpecials?.includes(id),
            `Unlocked item is not from this container.`
        );
    }
}

export class CS2EconomyItem
    implements
        Interface<
            Omit<CS2Item, "contents" | "specials" | "teams"> &
                CS2ItemLocalization & {
                    contents: CS2EconomyItem[] | undefined;
                    teams: CS2TeamValues[] | undefined;
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
    containerType: CS2ContainerTypeValues | undefined;
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
    rarity: CS2RarityColorValues = null!;
    specialsImage: boolean | undefined;
    statTrakless: boolean | undefined;
    statTrakOnly: boolean | undefined;
    tint: number | undefined;
    tournamentDesc: string | undefined;
    type: CS2ItemTypeValues = null!;
    voFallback: boolean | undefined;
    voFemale: boolean | undefined;
    voPrefix: string | undefined;
    wearMax: number | undefined;
    wearMin: number | undefined;

    private _contents: number[] | undefined;
    private _economy: CS2EconomyInstance;
    private _specials: number[] | undefined;
    private _teams: CS2ItemTeamValues | undefined;

    constructor(economyInstance: CS2EconomyInstance, item: CS2Item, language: CS2ItemLocalization) {
        this._economy = economyInstance;
        Object.assign(this, item);
        Object.assign(this, language);
        assert(typeof this.id === "number");
        assert(this.name);
        assert(this.rarity);
        assert(this.type);
    }

    set contents(value: number[] | undefined) {
        this._contents = value;
    }

    get contents(): CS2EconomyItem[] {
        this.expectContainer();
        return ensure(this._contents).map((id) => this._economy.get(id));
    }

    get parent(): CS2EconomyItem | undefined {
        return this.baseId !== undefined ? this._economy.get(this.baseId) : undefined;
    }

    get rawContents(): number[] | undefined {
        return this._contents;
    }

    get rawSpecials(): number[] | undefined {
        return this._specials;
    }

    set specials(value: number[] | undefined) {
        this._specials = value;
    }

    get specials(): CS2EconomyItem[] | undefined {
        this.expectContainer();
        return this._specials?.map((id) => this._economy.get(id));
    }

    set teams(value: CS2ItemTeamValues) {
        this._teams = value;
    }

    get teams(): CS2TeamValues[] | undefined {
        switch (this._teams) {
            case CS2ItemTeam.Both:
                return CS2_TEAMS_BOTH;
            case CS2ItemTeam.T:
                return CS2_TEAMS_T;
            case CS2ItemTeam.CT:
                return CS2_TEAMS_CT;
            default:
                return undefined;
        }
    }

    isC4(): boolean {
        return this.category === "c4";
    }

    isAgent(): boolean {
        return this.type === CS2ItemType.Agent;
    }

    isSticker(): boolean {
        return this.type === CS2ItemType.Sticker;
    }

    isPatch(): boolean {
        return this.type === CS2ItemType.Patch;
    }

    isGloves(): boolean {
        return this.type === CS2ItemType.Gloves;
    }

    isStorageUnit(): boolean {
        return this.type === CS2ItemType.Tool && this.def === CS2_STORAGE_UNIT_TOOL_DEF;
    }

    isNameTag(): boolean {
        return this.type === CS2ItemType.Tool && this.def === CS2_NAMETAG_TOOL_DEF;
    }

    isStatTrakSwapTool(): boolean {
        return this.type === CS2ItemType.Tool && this.def === CS2_STATTRAK_SWAP_TOOL_DEF;
    }

    isContainer(): boolean {
        return this.type === CS2ItemType.Container;
    }

    isContainerKey(): boolean {
        return this.type === CS2ItemType.ContainerKey;
    }

    isContainerOrTool(): boolean {
        return CS2_CONTAINER_OR_TOOL_ITEM.includes(this.type);
    }

    isTool(): boolean {
        return this.type === CS2ItemType.Tool;
    }

    expectPatch(): this {
        assert(this.isPatch(), "Expected a Patch.");
        return this;
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
        return CS2_WEARABLE_ITEMS.includes(this.type) && !this.free && this.index !== 0;
    }

    hasSeed(): boolean {
        return CS2_SEEDABLE_ITEMS.includes(this.type) && !this.free && this.index !== 0;
    }

    hasStickers(): boolean {
        return CS2_STICKERABLE_ITEMS.includes(this.type) && !this.isC4();
    }

    hasNametag(): boolean {
        return CS2_NAMETAGGABLE_ITEMS.includes(this.type) || this.isStorageUnit();
    }

    hasStatTrak(): boolean {
        return CS2_STATTRAKABLE_ITEMS.includes(this.type) && !this.free;
    }

    isWeaponCase(): boolean {
        return this.containerType === CS2ContainerType.WeaponCase;
    }

    isStickerCapsule(): boolean {
        return this.containerType === CS2ContainerType.StickerCapsule;
    }

    isGraffitiBox(): boolean {
        return this.containerType === CS2ContainerType.GraffitiBox;
    }

    isSouvenirCase(): boolean {
        return this.containerType === CS2ContainerType.SouvenirCase;
    }

    groupContents(): Record<string, CS2EconomyItem[]> {
        const items: Record<string, CS2EconomyItem[]> = {};
        const specials = this.specials;
        for (const item of this.contents) {
            const rarity = CS2RarityColorName[item.rarity];
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

    listContents(hideSpecials = false): CS2EconomyItem[] {
        const specials = this.specials;
        const items = [...this.contents, ...(!hideSpecials && specials !== undefined ? specials : [])];
        return items.sort((a, b) => {
            return (
                (CS2RarityColorOrder[a.rarity] ?? CS2_RARITY_COLOR_DEFAULT) -
                (CS2RarityColorOrder[b.rarity] ?? CS2_RARITY_COLOR_DEFAULT)
            );
        });
    }

    unlock(): {
        attributes: {
            containerId: number;
            seed: number | undefined;
            statTrak: number | undefined;
            wear: number | undefined;
        };
        id: number;
        rarity: CS2RaritySoundNameValues;
        special: boolean;
    } {
        // @see https://www.csgo.com.cn/news/gamebroad/20170911/206155.shtml
        const contents = this.groupContents();
        const keys = Object.keys(contents);
        const rarities = CS2_RARITY_ORDER.filter((rarity) => keys.includes(rarity));
        const odds = rarities.map((_, index) => CS2_BASE_ODD / Math.pow(5, index));
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
                containerId: this.id,
                seed: unlocked.hasSeed() ? randomInt(CS2_MIN_SEED, CS2_MAX_SEED) : undefined,
                statTrak: hasStatTrak
                    ? unlocked.hasStatTrak()
                        ? alwaysStatTrak || Math.random() <= CS2_STATTRAK_ODD
                            ? 0
                            : undefined
                        : undefined
                    : undefined,
                wear: unlocked.hasWear()
                    ? Number(
                          randomFloat(unlocked.wearMin ?? CS2_MIN_WEAR, unlocked.wearMax ?? CS2_MAX_WEAR)
                              .toString()
                              .substring(0, CS2_WEAR_FACTOR.toString().length)
                      )
                    : undefined
            },
            id: unlocked.id,
            rarity: CS2RaritySoundName[unlocked.rarity],
            special: rollRarity === "special"
        };
    }
}

export const CS2Economy = new CS2EconomyInstance();
