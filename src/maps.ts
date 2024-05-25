/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ensure } from "./utils.js";
export interface Cs2Map {
    mapname: string;
    name: string;
}

export const ANCIENT_MAP: Cs2Map = {
    mapname: "de_ancient",
    name: "Ancient"
};

export const ANUBIS_MAP: Cs2Map = {
    mapname: "de_anubis",
    name: "Anubis"
};

export const INFERNO_MAP: Cs2Map = {
    mapname: "de_inferno",
    name: "Inferno"
};

export const MIRAGE_MAP: Cs2Map = {
    mapname: "de_mirage",
    name: "Mirage"
};

export const DUST2_MAP: Cs2Map = {
    mapname: "de_dust2",
    name: "Dust 2"
};

export const NUKE_MAP: Cs2Map = {
    mapname: "de_nuke",
    name: "Nuke"
};

export const OVERPASS_MAP: Cs2Map = {
    mapname: "de_overpass",
    name: "Overpass"
};

export const VERTIGO_MAP: Cs2Map = {
    mapname: "de_vertigo",
    name: "Vertigo"
};

export const TRAIN_MAP: Cs2Map = {
    mapname: "de_train",
    name: "Train"
};

export const ACTIVE_MAP_POOL = [ANCIENT_MAP, ANUBIS_MAP, DUST2_MAP, INFERNO_MAP, MIRAGE_MAP, NUKE_MAP, VERTIGO_MAP];

export const ALL_MAPS = [
    ANCIENT_MAP,
    ANUBIS_MAP,
    DUST2_MAP,
    INFERNO_MAP,
    MIRAGE_MAP,
    NUKE_MAP,
    TRAIN_MAP,
    OVERPASS_MAP,
    VERTIGO_MAP
];

export function getMapnameName(mapname: string): string {
    return ensure(ALL_MAPS.find((map) => map.mapname.includes(mapname))?.name);
}
