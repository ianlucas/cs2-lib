export const CS2_DEFAULT_MAX_WEAR = 0.8;
export const CS2_DEFAULT_MIN_WEAR = 0.06;

export const Cs2ItemTeam = {
    T: 0,
    CT: 1,
    Both: 2
} as const;

export type Cs2ItemTeamValues = (typeof Cs2ItemTeam)[keyof typeof Cs2ItemTeam];

export const Cs2ItemType = {
    Agent: "agent",
    Collectible: "collectible",
    Container: "container",
    ContainerKey: "container-key",
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

export type Cs2ItemTypeValues = (typeof Cs2ItemType)[keyof typeof Cs2ItemType];

export interface Cs2Item {
    altName?: string;
    base?: boolean;
    baseId?: number;
    category?: string;
    collection?: string;
    contents?: number[];
    def?: number;
    free?: boolean;
    id: number;
    image?: string;
    index?: number;
    keys?: number[];
    legacy?: boolean;
    model?: string;
    rarity?: string; //<- make sure it's not empty.
    specials?: number[];
    specialsImage?: boolean;
    statTrakless?: boolean;
    statTrakOnly?: boolean;
    teams?: Cs2ItemTeamValues;
    tint?: number;
    type: Cs2ItemTypeValues;
    voFallback?: boolean;
    voFemale?: boolean;
    voPrefix?: string;
    wearMax?: number;
    wearMin?: number;
}

export interface Cs2EconomyItem extends Cs2Item {
    baseItem?: Cs2EconomyItem;
    collectionDesc?: string;
    collectionName?: string;
    desc?: string;
    name: string;
    tournamentDesc?: string;
}
