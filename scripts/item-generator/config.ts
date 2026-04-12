/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from "path";
import { availableParallelism } from "os";
import { CWD_PATH, CS2_CSGO_PATH } from "../env.ts";
import { type Cs2SourceMode } from "../cs2-tools/types.ts";

export const SCRIPTS_DIR: string = join(CWD_PATH, "scripts");
export const WORKDIR_DIR: string = join(SCRIPTS_DIR, "workdir");
export const DECOMPILED_DIR: string = join(WORKDIR_DIR, "decompiled");

export const GAME_IMAGES_DIR: string = join(DECOMPILED_DIR, "panorama/images");
export const GAME_ITEMS_PATH: string = join(DECOMPILED_DIR, "scripts/items/items_game.txt");
export const GAME_RESOURCE_DIR: string = join(DECOMPILED_DIR, "resource");
export const OUTPUT_DIR: string = join(WORKDIR_DIR, "output");

export const ITEM_GENERATOR_WORKDIR_DIR: string = join(WORKDIR_DIR, "item-generator");
export const ITEM_GENERATOR_CACHE_DIR: string = join(ITEM_GENERATOR_WORKDIR_DIR, "cache");
export const ITEM_GENERATOR_BUILD_DIR: string = join(ITEM_GENERATOR_WORKDIR_DIR, "build");

export const ITEM_IDS_JSON_PATH: string = "scripts/data/items-ids.json";
export const ITEMS_JSON_PATH: string = "scripts/data/items.json";
export const ITEMS_TS_PATH: string = "src/items.ts";
export const TRANSLATIONS_TS_PATH: string = "src/translations/%s.ts";
export const ENGLISH_JSON_PATH: string = "scripts/data/english.json";

export const FORMATTED_STRING_RE: RegExp = /%s(\d+)/g;
export const LANGUAGE_FILE_RE: RegExp = /csgo_([^\._]+)\.txt$/;
export const LOOT_ITEM_RE: RegExp = /^\[([^\]]+)\](.*)$/;
export const SKIN_PHASE_RE: RegExp = /_phase(\d)/;
export const WEAPON_CATEGORY_RE: RegExp = /(c4|[^\d]+)/;

export const BASE_WEAPON_EQUIPMENT: string[] = ["weapon_taser"];
export const FREE_MUSIC_KITS: string[] = ["1", "70"];
export const HEAVY_WEAPONS: string[] = [
    "weapon_m249",
    "weapon_mag7",
    "weapon_negev",
    "weapon_nova",
    "weapon_sawedoff",
    "weapon_xm1014"
];
export const PAINT_IMAGE_SUFFIXES: readonly ["light", "medium", "heavy"] = ["light", "medium", "heavy"];
export const UNCATEGORIZED_STICKERS: string[] = [
    "community_mix01",
    "community02",
    "danger_zone",
    "standard",
    "stickers2",
    "tournament_assets"
];
export const REMOVE_KEYCHAIN_TOOL_INDEX: string = "65";
export const OUTPUT_WEBP_OPTIONS = { quality: 95, exact: true } as const;
export const CDN_UPLOAD_CONCURRENCY: number = 40;
export const EXTERNAL_CONCURRENCY: number = Math.max(2, availableParallelism());

export const STATIC_IMAGES_DIR: string = join(SCRIPTS_DIR, "images");

export type ItemGeneratorMode = "limited" | "full";

export function detectItemGeneratorMode(): ItemGeneratorMode {
    return process.env.CS2_CSGO_PATH !== undefined ? ("full" as ItemGeneratorMode) : "limited";
}

export function detectItemGeneratorSourceMode(): Cs2SourceMode {
    return detectItemGeneratorMode() === "full" ? "installed_game" : "workspace_depot";
}

export function getInstalledGamePath(source: Cs2SourceMode): string | undefined {
    return source === "installed_game" ? CS2_CSGO_PATH : undefined;
}
