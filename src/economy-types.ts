/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EnumValues } from "./utils.js";

export const Cs2ItemTeam = {
    T: 0,
    CT: 1,
    Both: 2
} as const;

export type Cs2ItemTeamValues = EnumValues<typeof Cs2ItemTeam>;

export const Cs2ItemType = {
    Agent: "agent",
    Collectible: "collectible",
    Container: "container",
    ContainerKey: "containerkey",
    Gloves: "gloves",
    Graffiti: "graffiti",
    Melee: "melee",
    MusicKit: "musickit",
    Patch: "patch",
    Sticker: "sticker",
    Stub: "stub",
    Tool: "tool",
    Weapon: "weapon"
} as const;

export type Cs2ItemTypeValues = EnumValues<typeof Cs2ItemType>;

export const Cs2ItemWear = {
    FactoryNew: 0,
    MinimalWear: 1,
    FieldTested: 2,
    WellWorn: 3,
    BattleScarred: 4
} as const;

export type Cs2ItemWearValues = EnumValues<typeof Cs2ItemWear>;

export interface Cs2Item {
    altName?: string | undefined;
    base?: boolean | undefined;
    baseId?: number | undefined;
    category?: string | undefined;
    collection?: string | undefined;
    contents?: number[] | undefined;
    def?: number | undefined;
    free?: boolean | undefined;
    id: number;
    image?: string | undefined;
    index?: number | undefined;
    keys?: number[] | undefined;
    legacy?: boolean | undefined;
    model?: string | undefined;
    rarity?: string | undefined;
    specials?: number[] | undefined;
    specialsImage?: boolean | undefined;
    statTrakless?: boolean | undefined;
    statTrakOnly?: boolean | undefined;
    teams?: Cs2ItemTeamValues | undefined;
    tint?: number | undefined;
    type: Cs2ItemTypeValues;
    voFallback?: boolean | undefined;
    voFemale?: boolean | undefined;
    voPrefix?: string | undefined;
    wearMax?: number | undefined;
    wearMin?: number | undefined;
}

export interface Cs2ItemLanguage {
    category?: string | undefined;
    collectionDesc?: string | undefined;
    collectionName?: string | undefined;
    desc?: string | undefined;
    name: string;
    tournamentDesc?: string | undefined;
}

export type Cs2ItemLanguageFile = Record<string, Cs2ItemLanguage | undefined>;
