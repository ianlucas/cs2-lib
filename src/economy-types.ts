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

export interface CS2Item {
    altName?: string | undefined;
    base?: boolean | undefined;
    baseId?: number | undefined;
    category?: string | undefined;
    collection?: string | undefined;
    collectionImage?: string | undefined;
    containerType?: CS2ContainerType | undefined;
    contents?: number[] | undefined;
    def?: number | undefined;
    displaySeed?: number | undefined;
    free?: boolean | undefined;
    id: number;
    image?: string | undefined;
    index?: number | undefined;
    keychainOffsetXMax?: number | undefined;
    keychainOffsetXMin?: number | undefined;
    keychainOffsetYMax?: number | undefined;
    keychainOffsetYMin?: number | undefined;
    keychainOffsetZMax?: number | undefined;
    keychainOffsetZMin?: number | undefined;
    keys?: number[] | undefined;
    legacy?: boolean | undefined;
    legacyKeychainOffsetXMax?: number | undefined;
    legacyKeychainOffsetXMin?: number | undefined;
    legacyKeychainOffsetYMax?: number | undefined;
    legacyKeychainOffsetYMin?: number | undefined;
    legacyKeychainOffsetZMax?: number | undefined;
    legacyKeychainOffsetZMin?: number | undefined;
    legacyStickerOffsetXMax?: number | undefined;
    legacyStickerOffsetXMin?: number | undefined;
    legacyStickerOffsetYMax?: number | undefined;
    legacyStickerOffsetYMin?: number | undefined;
    /** Count of sticker schemas (StickerMarkup anchors) on the legacy mesh; see {@link CS2EconomyItem.getStickerSchemaCount}. */
    legacyStickerSchemaCount?: number | undefined;
    model?: string | undefined;
    paintMaterial?: string | undefined;
    playerModel?: string | undefined;
    rarity?: CS2RarityColor | undefined;
    specials?: number[] | undefined;
    specialsImage?: string | undefined;
    statTrakless?: boolean | undefined;
    statTrakOnly?: boolean | undefined;
    stickerId?: number | undefined;
    stickerOffsetXMax?: number | undefined;
    stickerOffsetXMin?: number | undefined;
    stickerOffsetYMax?: number | undefined;
    stickerOffsetYMin?: number | undefined;
    /** Count of sticker schemas (StickerMarkup anchors) on the HD mesh; see {@link CS2EconomyItem.getStickerSchemaCount}. */
    stickerSchemaCount?: number | undefined;
    teams?: CS2ItemTeam | undefined;
    tint?: number | undefined;
    type: CS2ItemType;
    wearMax?: number | undefined;
    wearMin?: number | undefined;
}

export interface CS2ItemTranslation {
    category?: string | undefined;
    collectionDesc?: string | undefined;
    collectionName?: string | undefined;
    desc?: string | undefined;
    name: string;
    tournamentDesc?: string | undefined;
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
