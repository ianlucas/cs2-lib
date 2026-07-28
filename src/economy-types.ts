/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CS2RarityColor, CS2RaritySoundName } from "./economy-container.ts";
import type { EnumValues } from "./utils.ts";

export const CS2ItemTeam = {
    T: 0,
    CT: 1,
    Both: 2
} as const;

export type CS2ItemTeam = EnumValues<typeof CS2ItemTeam>;

export const CS2ItemType = {
    Agent: "agent",
    Collectible: "collectible",
    Container: "case",
    Gloves: "glove",
    Graffiti: "graffiti",
    Key: "key",
    Keychain: "keychain",
    Melee: "melee",
    MusicKit: "musickit",
    Patch: "patch",
    Sticker: "sticker",
    Stub: "stub",
    Tool: "tool",
    Utility: "utility",
    Weapon: "weapon"
} as const;

export type CS2ItemType = EnumValues<typeof CS2ItemType>;

export const CS2ItemWear = {
    FactoryNew: "FN",
    MinimalWear: "MW",
    FieldTested: "FT",
    WellWorn: "WW",
    BattleScarred: "BS"
} as const;

export type CS2ItemWear = EnumValues<typeof CS2ItemWear>;

export const CS2ContainerType = {
    WeaponCase: 0,
    StickerCapsule: 1,
    GraffitiBox: 2,
    SouvenirCase: 3
} as const;

export type CS2ContainerType = EnumValues<typeof CS2ContainerType>;

/** Absent means the normal roll — see CS2_STATTRAK_ODD. */
export const CS2StatTrakMode = {
    Excluded: "excluded",
    Guaranteed: "guaranteed"
} as const;

export type CS2StatTrakMode = EnumValues<typeof CS2StatTrakMode>;

export interface CS2Item {
    alternateName?: string | undefined;
    collectionImagePath?: string | undefined;
    collectionKey?: string | undefined;
    containerType?: CS2ContainerType | undefined;
    contentIds?: number[] | undefined;
    definitionIndex?: number | undefined;
    displayedStickerId?: number | undefined;
    hasColliderData?: boolean | undefined;
    id: number;
    imagePath?: string | undefined;
    isBase?: boolean | undefined;
    isDefault?: boolean | undefined;
    isLegacyModel?: boolean | undefined;
    keychainPositionXMax?: number | undefined;
    keychainPositionXMin?: number | undefined;
    keychainPositionYMax?: number | undefined;
    keychainPositionYMin?: number | undefined;
    keychainPositionZMax?: number | undefined;
    keychainPositionZMin?: number | undefined;
    keyIds?: number[] | undefined;
    legacyKeychainPositionXMax?: number | undefined;
    legacyKeychainPositionXMin?: number | undefined;
    legacyKeychainPositionYMax?: number | undefined;
    legacyKeychainPositionYMin?: number | undefined;
    legacyKeychainPositionZMax?: number | undefined;
    legacyKeychainPositionZMin?: number | undefined;
    legacyStickerOffsetXMax?: number | undefined;
    legacyStickerOffsetXMin?: number | undefined;
    legacyStickerOffsetYMax?: number | undefined;
    legacyStickerOffsetYMin?: number | undefined;
    legacyStickerSchemaCount?: number | undefined;
    loadoutCategory?: string | undefined;
    materialPath?: string | undefined;
    modelKey?: string | undefined;
    modelPath?: string | undefined;
    parentId?: number | undefined;
    previewSeed?: number | undefined;
    rarityColor?: CS2RarityColor | undefined;
    specialIds?: number[] | undefined;
    specialsImagePath?: string | undefined;
    statTrakMode?: CS2StatTrakMode | undefined;
    stickerOffsetXMax?: number | undefined;
    stickerOffsetXMin?: number | undefined;
    stickerOffsetYMax?: number | undefined;
    stickerOffsetYMin?: number | undefined;
    stickerSchemaCount?: number | undefined;
    team?: CS2ItemTeam | undefined;
    tintIndex?: number | undefined;
    type: CS2ItemType;
    variantIndex?: number | undefined;
    wearMax?: number | undefined;
    wearMin?: number | undefined;
}

export interface CS2ItemTranslation {
    categoryName?: string | undefined;
    collectionDescription?: string | undefined;
    collectionName?: string | undefined;
    description?: string | undefined;
    name: string;
    tournamentDescription?: string | undefined;
}

export type CS2ItemTranslationMap = Record<string, CS2ItemTranslation | undefined>;
export type CS2ItemTranslationByLanguage = Record<string, CS2ItemTranslationMap>;

export interface CS2UnlockedItem {
    attributes: {
        containerId: number;
        seed: number | undefined;
        statTrak: number | undefined;
        wear: number | undefined;
    };
    id: number;
    rarity: CS2RaritySoundName;
    special: boolean;
}
