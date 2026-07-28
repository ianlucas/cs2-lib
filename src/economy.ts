/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    CS2_CHARM_DETACHMENT_PACK_TOOL_DEFINITION_INDEX,
    CS2_CHARM_DETACHMENT_TOOL_DEFINITION_INDEX,
    CS2_CONTAINER_ITEMS,
    CS2_CONTRACT_TOOL_DEFINITION_INDEX,
    CS2_DISPLAY_ITEMS,
    CS2_EQUIPMENT_ITEMS,
    CS2_FALLBACK_PREVIEW_SEED,
    CS2_GRAPHIC_ART_ITEMS,
    CS2_KEYCHAINABLE_ITEMS,
    CS2_MACHINEGUN_MODEL_KEYS,
    CS2_MAX_CHARM_DETACHMENT_CHARGES,
    CS2_MAX_FACTORY_NEW_WEAR,
    CS2_MAX_FIELD_TESTED_WEAR,
    CS2_MAX_GRAFFITI_CHARGES,
    CS2_MAX_KEYCHAIN_SEED,
    CS2_MAX_MINIMAL_WEAR_WEAR,
    CS2_MAX_SEED,
    CS2_MAX_STATTRAK,
    CS2_MAX_STICKERS,
    CS2_MAX_WEAR,
    CS2_MAX_WELL_WORN_WEAR,
    CS2_MIDTIER_LOADOUT_CATEGORIES,
    CS2_MIN_CHARGES,
    CS2_MIN_KEYCHAIN_SEED,
    CS2_MIN_SEED,
    CS2_MIN_STATTRAK,
    CS2_MIN_WEAR,
    CS2_MISC_LOADOUT_CATEGORIES,
    CS2_NAMETAGGABLE_ITEMS,
    CS2_NAMETAG_RE,
    CS2_NAMETAG_TOOL_DEFINITION_INDEX,
    CS2_PAINTABLE_ITEMS,
    CS2_PATCHABLE_ITEMS,
    CS2_RIFLE_LOADOUT_CATEGORIES,
    CS2_SEEDABLE_ITEMS,
    CS2_SNIPER_RIFLE_MODEL_KEYS,
    CS2_STATTRAKABLE_ITEMS,
    CS2_STATTRAK_SWAP_TOOL_DEFINITION_INDEX,
    CS2_STICKERABLE_ITEMS,
    CS2_STORAGE_UNIT_TOOL_DEFINITION_INDEX,
    CS2_TEAMS_BOTH,
    CS2_TEAMS_CT,
    CS2_TEAMS_T,
    CS2_WEAR_FACTOR
} from "./economy-constants.ts";
import {
    type CS2RarityColor,
    CS2RarityColorName,
    CS2RarityColorOrder,
    CS2RaritySoundName,
    CS2_BASE_ODD,
    CS2_RARITY_COLOR_DEFAULT,
    CS2_RARITY_ORDER,
    CS2_STATTRAK_ODD,
    randomFloat,
    randomInt
} from "./economy-container.ts";
import {
    CS2ContainerType,
    type CS2Item,
    CS2ItemTeam,
    type CS2ItemTranslation,
    type CS2ItemTranslationMap,
    CS2ItemType,
    CS2ItemWear,
    CS2StatTrakMode,
    type CS2UnlockedItem
} from "./economy-types.ts";
import { type CS2Team } from "./teams.ts";
import { type Interface, assert, compare, ensure, isFactorPrecise, safe, truncateToFactor } from "./utils.ts";

type CS2EconomyItemPredicate = Partial<CS2EconomyItem> & { usableByTeam?: CS2Team };

function filterItems(predicate: CS2EconomyItemPredicate): (item: CS2EconomyItem) => boolean {
    return function filter(item: CS2EconomyItem) {
        return (
            compare(predicate.type, item.type) &&
            compare(predicate.isDefault, item.isDefault) &&
            compare(predicate.modelKey, item.modelKey) &&
            compare(predicate.isBase, item.isBase) &&
            compare(predicate.loadoutCategory, item.loadoutCategory) &&
            (predicate.usableByTeam === undefined ||
                item.teams === undefined ||
                item.teams.includes(predicate.usableByTeam))
        );
    };
}

export class CS2EconomyInstance {
    baseUrl = "https://cdn.cstrike.app";
    categories: Set<string> = new Set<string>();
    items: Map<number, CS2EconomyItem> = new Map<number, CS2EconomyItem>();
    itemsAsArray: CS2EconomyItem[] = [];
    stickers: Set<CS2EconomyItem> = new Set<CS2EconomyItem>();

    private charmDetachment: CS2EconomyItem | undefined;

    load({
        assetsBaseUrl,
        items,
        language
    }: {
        assetsBaseUrl?: string;
        items: CS2Item[];
        language?: CS2ItemTranslationMap;
    }): void {
        this.baseUrl = assetsBaseUrl ?? this.baseUrl;
        this.categories.clear();
        this.items.clear();
        this.stickers.clear();
        this.itemsAsArray = [];
        this.charmDetachment = undefined;
        for (const item of items) {
            const economyItem = new CS2EconomyItem(
                this,
                item,
                language !== undefined ? ensure(language[item.id]) : { name: String(item.id) }
            );
            this.items.set(item.id, economyItem);
            if (economyItem.isSticker()) {
                this.stickers.add(economyItem);
                if (language !== undefined) {
                    this.categories.add(ensure(economyItem.categoryName));
                }
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
        assert(items.length > 0);
        return items;
    }

    validateWear(wear?: number, item?: CS2EconomyItem): boolean {
        if (wear === undefined) {
            return true;
        }
        assert(isFactorPrecise(wear, CS2_WEAR_FACTOR));
        assert(wear >= CS2_MIN_WEAR && wear <= CS2_MAX_WEAR);
        if (item !== undefined) {
            assert(item.hasWear());
            assert(item.wearMin === undefined || wear >= item.wearMin);
            assert(item.wearMax === undefined || wear <= item.wearMax);
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
        assert(Number.isFinite(seed));
        assert(Number.isInteger(seed));
        assert(item === undefined || item.hasSeed());
        assert(seed >= (item?.getMinimumSeed() ?? CS2_MIN_SEED) && seed <= (item?.getMaximumSeed() ?? CS2_MAX_SEED));
        return true;
    }

    safeValidateSeed(seed?: number, item?: CS2EconomyItem): boolean {
        return safe(() => this.validateSeed(seed, item));
    }

    trimNameTag(nameTag?: string): string | undefined {
        const trimmed = nameTag?.trim();
        return trimmed === "" ? undefined : trimmed;
    }

    validateNameTag(nameTag?: string, item?: CS2EconomyItem): boolean {
        if (nameTag !== undefined) {
            assert(item === undefined || item.hasNameTag());
            assert(nameTag[0] !== " " && CS2_NAMETAG_RE.test(nameTag));
        }
        return true;
    }

    safeValidateNameTag(nameTag?: string, item?: CS2EconomyItem): boolean {
        return safe(() => this.validateNameTag(nameTag, item));
    }

    requireNameTag(nameTag?: string, item?: CS2EconomyItem): boolean {
        assert(nameTag === undefined || nameTag.trim().length > 0);
        return this.validateNameTag(nameTag, item);
    }

    safeRequireNameTag(nameTag?: string, item?: CS2EconomyItem): boolean {
        return safe(() => this.requireNameTag(nameTag, item));
    }

    validateCharges(charges?: number, item?: CS2EconomyItem): boolean {
        if (charges === undefined) {
            return true;
        }
        assert(item === undefined || item.hasCharges());
        assert(Number.isInteger(charges));
        assert(charges >= CS2_MIN_CHARGES && charges <= (item?.getMaximumCharges() ?? Number.MAX_SAFE_INTEGER));
        return true;
    }

    safeValidateCharges(charges?: number, item?: CS2EconomyItem): boolean {
        return safe(() => this.validateCharges(charges, item));
    }

    validateStatTrak(statTrak?: number, item?: CS2EconomyItem): boolean {
        if (statTrak === undefined) {
            return true;
        }
        assert(item === undefined || item.hasStatTrak());
        assert(Number.isInteger(statTrak));
        assert(statTrak >= CS2_MIN_STATTRAK && statTrak <= CS2_MAX_STATTRAK);
        return true;
    }

    safeValidateStatTrak(statTrak?: number, item?: CS2EconomyItem): boolean {
        return safe(() => this.validateStatTrak(statTrak, item));
    }

    getWearFromValue(value: number): CS2ItemWear {
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

    getCharmDetachment(): CS2EconomyItem {
        this.charmDetachment ??= ensure(this.itemsAsArray.find((item) => item.isCharmDetachment()));
        return this.charmDetachment;
    }

    validateContainerAndKey(containerItem: number | CS2EconomyItem, keyItem?: number | CS2EconomyItem): boolean {
        containerItem = this.get(containerItem);
        containerItem.expectContainer();
        keyItem = keyItem !== undefined ? this.get(keyItem) : undefined;
        if (keyItem !== undefined) {
            keyItem.expectKey();
            assert(containerItem.keyIds !== undefined);
            assert(containerItem.keyIds.includes(keyItem.id));
        } else {
            assert(containerItem.keyIds === undefined);
        }
        return true;
    }

    safeValidateContainerAndKey(containerItem: number | CS2EconomyItem, keyItem?: number | CS2EconomyItem): boolean {
        return safe(() => this.validateContainerAndKey(containerItem, keyItem));
    }

    expectUnlockedItem(
        item: number | CS2EconomyItem,
        { id }: ReturnType<InstanceType<typeof CS2EconomyItem>["unlockContainer"]>
    ): void {
        item = this.get(item).expectContainer();
        assert(item.contentIds?.includes(id) || item.specialIds?.includes(id));
    }

    resolveUrl(path?: string): string {
        return `${this.baseUrl}${path}`;
    }
}

export class CS2EconomyItem implements Interface<
    CS2Item &
        CS2ItemTranslation & {
            contents: CS2EconomyItem[] | undefined;
            teams: CS2Team[] | undefined;
        }
> {
    alternateName: string | undefined;
    categoryName: string | undefined;
    collectionDescription: string | undefined;
    collectionImagePath: string | undefined;
    collectionKey: string | undefined;
    collectionName: string | undefined;
    containerType: CS2ContainerType | undefined;
    contentIds: number[] | undefined;
    definitionIndex: number | undefined;
    description: string | undefined;
    displayedStickerId: number | undefined;
    hasColliderData: boolean | undefined;
    id: number = null!;
    imagePath: string | undefined;
    isBase: boolean | undefined;
    isDefault: boolean | undefined;
    isLegacyModel: boolean | undefined;
    keychainOffsetXMax: number | undefined;
    keychainOffsetXMin: number | undefined;
    keychainOffsetYMax: number | undefined;
    keychainOffsetYMin: number | undefined;
    keychainOffsetZMax: number | undefined;
    keychainOffsetZMin: number | undefined;
    keyIds: number[] | undefined;
    legacyKeychainOffsetXMax: number | undefined;
    legacyKeychainOffsetXMin: number | undefined;
    legacyKeychainOffsetYMax: number | undefined;
    legacyKeychainOffsetYMin: number | undefined;
    legacyKeychainOffsetZMax: number | undefined;
    legacyKeychainOffsetZMin: number | undefined;
    legacyStickerOffsetXMax: number | undefined;
    legacyStickerOffsetXMin: number | undefined;
    legacyStickerOffsetYMax: number | undefined;
    legacyStickerOffsetYMin: number | undefined;
    legacyStickerSchemaCount: number | undefined;
    loadoutCategory: string | undefined;
    materialPath: string | undefined;
    modelKey: string | undefined;
    modelPath: string | undefined;
    name: string = null!;
    parentId: number | undefined;
    previewSeed: number | undefined;
    rarityColor: CS2RarityColor = null!;
    specialIds: number[] | undefined;
    specialsImagePath: string | undefined;
    statTrakMode: CS2StatTrakMode | undefined;
    stickerOffsetXMax: number | undefined;
    stickerOffsetXMin: number | undefined;
    stickerOffsetYMax: number | undefined;
    stickerOffsetYMin: number | undefined;
    stickerSchemaCount: number | undefined;
    team: CS2ItemTeam | undefined;
    tintIndex: number | undefined;
    tournamentDescription: string | undefined;
    type: CS2ItemType = null!;
    variantIndex: number | undefined;
    wearMax: number | undefined;
    wearMin: number | undefined;

    constructor(
        public economy: CS2EconomyInstance,
        public item: CS2Item,
        public language: CS2ItemTranslation
    ) {
        Object.assign(this, item);
        Object.assign(this, language);
        assert(typeof this.id === "number");
        assert(this.name);
        assert(this.type);
        assert(item.type === CS2ItemType.Stub || typeof this.rarityColor === "string");
    }

    get contents(): CS2EconomyItem[] {
        this.expectContainer();
        return ensure(this.contentIds).map((id) => this.economy.get(id));
    }

    get displayedSticker(): CS2EconomyItem | undefined {
        return this.displayedStickerId !== undefined ? this.economy.get(this.displayedStickerId) : undefined;
    }

    get parent(): CS2EconomyItem | undefined {
        return this.parentId !== undefined
            ? this.economy.items.has(this.parentId)
                ? this.economy.get(this.parentId)
                : undefined
            : undefined;
    }

    get specials(): CS2EconomyItem[] | undefined {
        this.expectContainer();
        return this.specialIds?.map((id) => this.economy.get(id));
    }

    get teams(): CS2Team[] | undefined {
        switch (this.team) {
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
        return this.loadoutCategory === "c4";
    }

    isPistol(): boolean {
        return this.loadoutCategory === "secondary";
    }

    isSMG(): boolean {
        return this.loadoutCategory === "smg";
    }

    isRifle(): boolean {
        return this.loadoutCategory === "rifle";
    }

    isSniperRifle(): boolean {
        return this.modelKey !== undefined && CS2_SNIPER_RIFLE_MODEL_KEYS.includes(this.modelKey);
    }

    isMachinegun(): boolean {
        return this.modelKey !== undefined && CS2_MACHINEGUN_MODEL_KEYS.includes(this.modelKey);
    }

    isHeavy(): boolean {
        return this.loadoutCategory === "heavy";
    }

    isEquipment(): boolean {
        return this.loadoutCategory === "equipment";
    }

    isInMidTiers(): boolean {
        return this.loadoutCategory !== undefined && CS2_MIDTIER_LOADOUT_CATEGORIES.includes(this.loadoutCategory);
    }

    isInRifles(): boolean {
        return this.loadoutCategory !== undefined && CS2_RIFLE_LOADOUT_CATEGORIES.includes(this.loadoutCategory);
    }

    isInMisc(): boolean {
        return this.loadoutCategory !== undefined && CS2_MISC_LOADOUT_CATEGORIES.includes(this.loadoutCategory);
    }

    isAgent(): boolean {
        return this.type === CS2ItemType.Agent;
    }

    isCollectible(): boolean {
        return this.type === CS2ItemType.Collectible;
    }

    isContainer(): boolean {
        return this.type === CS2ItemType.Container;
    }

    isKey(): boolean {
        return this.type === CS2ItemType.Key;
    }

    isGloves(): boolean {
        return this.type === CS2ItemType.Gloves;
    }

    isGraffiti(): boolean {
        return this.type === CS2ItemType.Graffiti;
    }

    isMelee(): boolean {
        return this.type === CS2ItemType.Melee;
    }

    isMusicKit(): boolean {
        return this.type === CS2ItemType.MusicKit;
    }

    isPatch(): boolean {
        return this.type === CS2ItemType.Patch;
    }

    isSticker(): boolean {
        return this.type === CS2ItemType.Sticker;
    }

    isKeychain(): boolean {
        return this.type === CS2ItemType.Keychain;
    }

    isStub(): boolean {
        return this.type === CS2ItemType.Stub;
    }

    isTool(): boolean {
        return this.type === CS2ItemType.Tool;
    }

    isWeapon(): boolean {
        return this.type === CS2ItemType.Weapon;
    }

    isStorageUnit(): boolean {
        return this.isTool() && this.definitionIndex === CS2_STORAGE_UNIT_TOOL_DEFINITION_INDEX;
    }

    isNameTag(): boolean {
        return this.isTool() && this.definitionIndex === CS2_NAMETAG_TOOL_DEFINITION_INDEX;
    }

    isStatTrakSwapTool(): boolean {
        return this.isTool() && this.definitionIndex === CS2_STATTRAK_SWAP_TOOL_DEFINITION_INDEX;
    }

    isContract(): boolean {
        return this.isTool() && this.definitionIndex === CS2_CONTRACT_TOOL_DEFINITION_INDEX;
    }

    isCharmDetachment(): boolean {
        return this.isTool() && this.definitionIndex === CS2_CHARM_DETACHMENT_TOOL_DEFINITION_INDEX;
    }

    isCharmDetachmentPack(): boolean {
        return this.isTool() && this.definitionIndex === CS2_CHARM_DETACHMENT_PACK_TOOL_DEFINITION_INDEX;
    }

    expectAgent(): this {
        assert(this.isAgent());
        return this;
    }

    expectPatch(): this {
        assert(this.isPatch());
        return this;
    }

    expectSticker(): this {
        assert(this.isSticker());
        return this;
    }

    expectKeychain(): this {
        assert(this.isKeychain());
        return this;
    }

    expectStorageUnit(): this {
        assert(this.isStorageUnit());
        return this;
    }

    expectNameTag(): this {
        assert(this.isNameTag());
        return this;
    }

    expectStatTrakSwapTool(): this {
        assert(this.isStatTrakSwapTool());
        return this;
    }

    expectCharmDetachmentPack(): this {
        assert(this.isCharmDetachmentPack());
        return this;
    }

    expectContainer(): this {
        assert(this.isContainer());
        return this;
    }

    expectKey(): this {
        assert(this.isKey());
        return this;
    }

    hasWear(): boolean {
        return CS2_PAINTABLE_ITEMS.includes(this.type) && !this.isDefault && this.variantIndex !== 0;
    }

    hasSeed(): boolean {
        return CS2_SEEDABLE_ITEMS.includes(this.type) && !this.isDefault && this.variantIndex !== 0;
    }

    hasStickers(): boolean {
        return CS2_STICKERABLE_ITEMS.includes(this.type) && !this.isC4();
    }

    hasKeychains(): boolean {
        return CS2_KEYCHAINABLE_ITEMS.includes(this.type) && !this.isC4();
    }

    hasPatches(): boolean {
        return CS2_PATCHABLE_ITEMS.includes(this.type);
    }

    hasNameTag(): boolean {
        return CS2_NAMETAGGABLE_ITEMS.includes(this.type) || this.isStorageUnit();
    }

    hasStatTrak(): boolean {
        return CS2_STATTRAKABLE_ITEMS.includes(this.type) && !this.isDefault;
    }

    hasCharges(): boolean {
        return this.isGraffiti() || this.isCharmDetachment();
    }

    getDefaultCharges(): number {
        return this.isGraffiti() ? CS2_MAX_GRAFFITI_CHARGES : CS2_MIN_CHARGES;
    }

    getMaximumCharges(): number {
        return this.isGraffiti() ? CS2_MAX_GRAFFITI_CHARGES : CS2_MAX_CHARM_DETACHMENT_CHARGES;
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

    isInEquipments(): boolean {
        return CS2_EQUIPMENT_ITEMS.includes(this.type);
    }

    isInGraphicArts(): boolean {
        return CS2_GRAPHIC_ART_ITEMS.includes(this.type);
    }

    isInContainers(): boolean {
        return CS2_CONTAINER_ITEMS.includes(this.type);
    }

    isInDisplay(): boolean {
        return CS2_DISPLAY_ITEMS.includes(this.type);
    }

    isPaintable(): boolean {
        return CS2_PAINTABLE_ITEMS.includes(this.type);
    }

    getImageUrl(wear?: number): string {
        assert(this.imagePath);
        const url = this.economy.resolveUrl(this.imagePath);
        if (this.hasWear() && wear !== undefined) {
            switch (true) {
                case wear < 1 / 3:
                    return url.replace(".webp", "_light.webp");
                case wear < 2 / 3:
                    return url.replace(".webp", "_medium.webp");
                default:
                    return url.replace(".webp", "_heavy.webp");
            }
        }
        return url;
    }

    getCollectionImageUrl(): string {
        return this.economy.resolveUrl(this.collectionImagePath);
    }

    getSpecialsImageUrl(): string {
        this.expectContainer();
        assert(this.specialIds);
        assert(this.specialsImagePath);
        return this.economy.resolveUrl(this.specialsImagePath);
    }

    getMaterialUrl(): string {
        return this.economy.resolveUrl(this.materialPath ?? this.parent?.materialPath);
    }

    getModelUrl(): string {
        const modelPath = this.modelPath ?? this.parent?.modelPath;
        return this.economy.resolveUrl(modelPath);
    }

    getModelDataUrl(): string {
        const modelPath = this.modelPath ?? this.parent?.modelPath;
        return this.economy.resolveUrl(modelPath?.replace(/\.glb$/, ".json"));
    }

    getColliderDataUrl(): string | undefined {
        if (!(this.hasColliderData ?? this.parent?.hasColliderData)) {
            return undefined;
        }
        const modelPath = this.modelPath ?? this.parent?.modelPath;
        return this.economy.resolveUrl(modelPath?.replace(/\.glb$/, ".collider.json"));
    }

    getMinimumWear(): number {
        return this.wearMin ?? CS2_MIN_WEAR;
    }

    getMaximumWear(): number {
        return this.wearMax ?? CS2_MAX_WEAR;
    }

    getMinimumSeed(): number {
        return this.isKeychain() ? CS2_MIN_KEYCHAIN_SEED : CS2_MIN_SEED;
    }

    getMaximumSeed(): number {
        return this.isKeychain() ? CS2_MAX_KEYCHAIN_SEED : CS2_MAX_SEED;
    }

    /**
     * The seed this item's own artwork is rendered at — the inventory image, the 3D preview. It is
     * not a fallback an instance inherits: an item stored without a seed is unseeded, not this.
     */
    getPreviewSeed(): number {
        return this.previewSeed ?? CS2_FALLBACK_PREVIEW_SEED;
    }

    getStickerSchemaCount(): number {
        const item = this.parent ?? this;
        const count = (this.isLegacyModel ? item.legacyStickerSchemaCount : undefined) ?? item.stickerSchemaCount;
        return count ?? CS2_MAX_STICKERS;
    }

    getMinimumStickerOffsetX(): number | undefined {
        const item = this.parent ?? this;
        return (this.isLegacyModel ? item.legacyStickerOffsetXMin : undefined) ?? item.stickerOffsetXMin;
    }

    getMaximumStickerOffsetX(): number | undefined {
        const item = this.parent ?? this;
        return (this.isLegacyModel ? item.legacyStickerOffsetXMax : undefined) ?? item.stickerOffsetXMax;
    }

    getMinimumStickerOffsetY(): number | undefined {
        const item = this.parent ?? this;
        return (this.isLegacyModel ? item.legacyStickerOffsetYMin : undefined) ?? item.stickerOffsetYMin;
    }

    getMaximumStickerOffsetY(): number | undefined {
        const item = this.parent ?? this;
        return (this.isLegacyModel ? item.legacyStickerOffsetYMax : undefined) ?? item.stickerOffsetYMax;
    }

    getMinimumKeychainOffsetX(): number | undefined {
        const item = this.parent ?? this;
        return (this.isLegacyModel ? item.legacyKeychainOffsetXMin : undefined) ?? item.keychainOffsetXMin;
    }

    getMaximumKeychainOffsetX(): number | undefined {
        const item = this.parent ?? this;
        return (this.isLegacyModel ? item.legacyKeychainOffsetXMax : undefined) ?? item.keychainOffsetXMax;
    }

    getMinimumKeychainOffsetY(): number | undefined {
        const item = this.parent ?? this;
        return (this.isLegacyModel ? item.legacyKeychainOffsetYMin : undefined) ?? item.keychainOffsetYMin;
    }

    getMaximumKeychainOffsetY(): number | undefined {
        const item = this.parent ?? this;
        return (this.isLegacyModel ? item.legacyKeychainOffsetYMax : undefined) ?? item.keychainOffsetYMax;
    }

    getMinimumKeychainOffsetZ(): number | undefined {
        const item = this.parent ?? this;
        return (this.isLegacyModel ? item.legacyKeychainOffsetZMin : undefined) ?? item.keychainOffsetZMin;
    }

    getMaximumKeychainOffsetZ(): number | undefined {
        const item = this.parent ?? this;
        return (this.isLegacyModel ? item.legacyKeychainOffsetZMax : undefined) ?? item.keychainOffsetZMax;
    }

    groupContents(): Record<string, CS2EconomyItem[]> {
        const items: Record<string, CS2EconomyItem[]> = {};
        const specials = this.specials;
        for (const item of this.contents) {
            const rarity = CS2RarityColorName[item.rarityColor];
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
                (CS2RarityColorOrder[a.rarityColor] ?? CS2_RARITY_COLOR_DEFAULT) -
                (CS2RarityColorOrder[b.rarityColor] ?? CS2_RARITY_COLOR_DEFAULT)
            );
        });
    }

    /** @see https://www.csgo.com.cn/news/gamebroad/20170911/206155.shtml */
    unlockContainer(options?: {
        computeOdds?: (rarities: (typeof CS2_RARITY_ORDER)[number][]) => number[] | undefined;
    }): CS2UnlockedItem {
        const contents = this.groupContents();
        const keys = Object.keys(contents);
        const rarities = CS2_RARITY_ORDER.filter((rarity) => keys.includes(rarity));
        const odds = options?.computeOdds?.(rarities) ?? rarities.map((_, index) => CS2_BASE_ODD / Math.pow(5, index));
        const total = odds.reduce((acc, cur) => acc + cur, 0);
        const entries = rarities.map((rarity, index) => [rarity, ensure(odds[index]) / total] as const);
        const roll = Math.random();
        let [rollRarity] = ensure(entries[0]);
        let acc = 0;
        for (const [rarity, odd] of entries) {
            acc += odd;
            if (roll <= acc) {
                rollRarity = rarity;
                break;
            }
        }
        const stack = ensure(contents[rollRarity]);
        const unlocked = ensure(stack[Math.floor(Math.random() * stack.length)]);
        return {
            attributes: {
                containerId: this.id,
                seed: unlocked.hasSeed() ? randomInt(CS2_MIN_SEED, CS2_MAX_SEED) : undefined,
                statTrak:
                    unlocked.hasStatTrak() && this.statTrakMode !== CS2StatTrakMode.Excluded
                        ? this.statTrakMode === CS2StatTrakMode.Guaranteed || Math.random() <= CS2_STATTRAK_ODD
                            ? 0
                            : undefined
                        : undefined,
                wear: unlocked.hasWear()
                    ? truncateToFactor(
                          randomFloat(unlocked.wearMin ?? CS2_MIN_WEAR, unlocked.wearMax ?? CS2_MAX_WEAR),
                          CS2_WEAR_FACTOR
                      )
                    : undefined
            },
            id: unlocked.id,
            rarity: CS2RaritySoundName[unlocked.rarityColor],
            special: rollRarity === "special"
        };
    }
}

export const CS2Economy: CS2EconomyInstance = new CS2EconomyInstance();
