/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { assert } from "./util";

export interface CS_Map {
    mapname: string;
    name: string;
}

export const CS_ANCIENT_MAP: CS_Map = {
    mapname: "de_ancient",
    name: "Ancient"
};

export const CS_ANUBIS_MAP: CS_Map = {
    mapname: "de_anubis",
    name: "Anubis"
};

export const CS_INFERNO_MAP: CS_Map = {
    mapname: "de_inferno",
    name: "Inferno"
};

export const CS_MIRAGE_MAP: CS_Map = {
    mapname: "de_mirage",
    name: "Mirage"
};

export const CS_DUST2_MAP: CS_Map = {
    mapname: "de_dust2",
    name: "Dust 2"
};

export const CS_NUKE_MAP: CS_Map = {
    mapname: "de_nuke",
    name: "Nuke"
};

export const CS_OVERPASS_MAP: CS_Map = {
    mapname: "de_overpass",
    name: "Overpass"
};

export const CS_VERTIGO_MAP: CS_Map = {
    mapname: "de_vertigo",
    name: "Vertigo"
};

export const CS_TRAIN_MAP: CS_Map = {
    mapname: "de_train",
    name: "Train"
};

export const CS_ACTIVE_MAP_POOL = [
    CS_ANCIENT_MAP,
    CS_ANUBIS_MAP,
    CS_DUST2_MAP,
    CS_INFERNO_MAP,
    CS_MIRAGE_MAP,
    CS_NUKE_MAP,
    CS_VERTIGO_MAP
];

export const CS_ALL_MAPS = [
    CS_ANCIENT_MAP,
    CS_ANUBIS_MAP,
    CS_DUST2_MAP,
    CS_INFERNO_MAP,
    CS_MIRAGE_MAP,
    CS_NUKE_MAP,
    CS_TRAIN_MAP,
    CS_OVERPASS_MAP,
    CS_VERTIGO_MAP
];

export function CS_getMapnameName(mapname: string): string {
    const name = CS_ALL_MAPS.find((map) => map.mapname.includes(mapname))?.name;
    assert(name !== undefined, `Mapname ${mapname} not found in CS_ALL_MAPS`);
    return name;
}
