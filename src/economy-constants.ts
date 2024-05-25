/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Cs2ItemType, Cs2ItemTypeValues } from "./economy-types.js";
import { Cs2Team } from "./teams.js";

export const MIN_STATTRAK = 0;
export const MAX_STATTRAK = 999999;
export const WEAR_FACTOR = 0.000001;
export const MIN_WEAR = 0;
export const MAX_WEAR = 1;
export const DEFAULT_MIN_WEAR = 0.06;
export const DEFAULT_MAX_WEAR = 0.8;
export const MIN_FACTORY_NEW_WEAR = MIN_WEAR;
export const MAX_FACTORY_NEW_WEAR = 0.07;
export const MIN_MINIMAL_WEAR_WEAR = 0.070001;
export const MAX_MINIMAL_WEAR_WEAR = 0.15;
export const MIN_FIELD_TESTED_WEAR = 0.150001;
export const MAX_FIELD_TESTED_WEAR = 0.37;
export const MIN_WELL_WORN_WEAR = 0.370001;
export const MAX_WELL_WORN_WEAR = 0.44;
export const MIN_BATTLE_SCARRED_WEAR = 0.440001;
export const MAX_BATTLE_SCARRED_WEAR = MAX_WEAR;
export const MIN_SEED = 1;
export const MAX_SEED = 1000;
export const MIN_STICKER_WEAR = 0;
export const MAX_STICKER_WEAR = 0.9;

export const NONE = 0;
export const STICKER_WEAR_FACTOR = 0.1;

export const NAMETAG_RE = /^[A-Za-z0-9`!@#$%^&*-+=(){}\[\]\/\|\\,.?:;'_\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\s]{0,20}$/u;

export const NAMETAG_TOOL_DEF = 1200;
export const STATTRAK_SWAP_TOOL_DEF = 1324;
export const STORAGE_UNIT_TOOL_DEF = 1201;

export const GRAFFITI_BOX_ID = 11234;
export const SOUVENIR_CASE_ID = 9147;
export const STICKER_CAPSULE_ID = 9134;
export const WEAPON_CASE_ID = 9129;

export const NAMETAGGABLE_ITEMS: Cs2ItemTypeValues[] = [Cs2ItemType.Melee, Cs2ItemType.Weapon];
export const SEEDABLE_ITEMS: Cs2ItemTypeValues[] = [Cs2ItemType.Weapon, Cs2ItemType.Melee, Cs2ItemType.Gloves];
export const STATTRAKABLE_ITEMS: Cs2ItemTypeValues[] = [Cs2ItemType.Melee, Cs2ItemType.Weapon, Cs2ItemType.MusicKit]
export const STICKERABLE_ITEMS: Cs2ItemTypeValues[] = [Cs2ItemType.Weapon];
export const WEARABLE_ITEMS: Cs2ItemTypeValues[] = [Cs2ItemType.Gloves, Cs2ItemType.Melee, Cs2ItemType.Weapon];

export const TEAMS_BOTH = [Cs2Team.T, Cs2Team.CT];
export const TEAMS_CT = [Cs2Team.CT];
export const TEAMS_T = [Cs2Team.T];
