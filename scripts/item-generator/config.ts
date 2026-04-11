/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from "path";
import { availableParallelism } from "os";
import { CWD_PATH, CS2_CSGO_PATH } from "../env.ts";
import { Cs2SourceMode } from "../cs2-tools/types.ts";

export const SCRIPTS_DIR = join(CWD_PATH, "scripts");
export const WORKDIR_DIR = join(SCRIPTS_DIR, "workdir");
export const DECOMPILED_DIR = join(WORKDIR_DIR, "decompiled");

export const GAME_IMAGES_DIR = join(DECOMPILED_DIR, "panorama/images");
export const GAME_ITEMS_PATH = join(DECOMPILED_DIR, "scripts/items/items_game.txt");
export const GAME_RESOURCE_DIR = join(DECOMPILED_DIR, "resource");
export const OUTPUT_DIR = join(WORKDIR_DIR, "output");

export const ITEM_GENERATOR_WORKDIR_DIR = join(WORKDIR_DIR, "item-generator");
export const ITEM_GENERATOR_CACHE_DIR = join(ITEM_GENERATOR_WORKDIR_DIR, "cache");
export const ITEM_GENERATOR_BUILD_DIR = join(ITEM_GENERATOR_WORKDIR_DIR, "build");

export const ITEM_IDS_JSON_PATH = "scripts/data/items-ids.json";
export const ITEMS_JSON_PATH = "scripts/data/items.json";
export const ITEMS_TS_PATH = "src/items.ts";
export const STICKER_MARKUP_TS_PATH = "src/sticker-markup.ts";
export const TRANSLATIONS_TS_PATH = "src/translations/%s.ts";
export const ENGLISH_JSON_PATH = "scripts/data/english.json";

export const FORMATTED_STRING_RE = /%s(\d+)/g;
export const LANGUAGE_FILE_RE = /csgo_([^\._]+)\.txt$/;
export const LOOT_ITEM_RE = /^\[([^\]]+)\](.*)$/;
export const SKIN_PHASE_RE = /_phase(\d)/;
export const WEAPON_CATEGORY_RE = /(c4|[^\d]+)/;

export const BASE_WEAPON_EQUIPMENT = ["weapon_taser"];
export const FREE_MUSIC_KITS = ["1", "70"];
export const HEAVY_WEAPONS = [
    "weapon_m249",
    "weapon_mag7",
    "weapon_negev",
    "weapon_nova",
    "weapon_sawedoff",
    "weapon_xm1014"
];
export const PAINT_IMAGE_SUFFIXES = ["light", "medium", "heavy"] as const;
export const UNCATEGORIZED_STICKERS = [
    "community_mix01",
    "community02",
    "danger_zone",
    "standard",
    "stickers2",
    "tournament_assets"
];
export const REMOVE_KEYCHAIN_TOOL_INDEX = "65";
export const OUTPUT_IMAGE_QUALITY = 95;
export const CDN_UPLOAD_CONCURRENCY = 40;
export const EXTERNAL_CONCURRENCY = Math.max(2, availableParallelism());

export const STATIC_IMAGES_DIR = join(SCRIPTS_DIR, "images");

export type ItemGeneratorMode = "limited" | "full";

export function detectItemGeneratorMode() {
    return process.env.CS2_CSGO_PATH !== undefined ? ("full" as ItemGeneratorMode) : "limited";
}

export function detectItemGeneratorSourceMode(): Cs2SourceMode {
    return detectItemGeneratorMode() === "full" ? "installed_game" : "workspace_depot";
}

export function getInstalledGamePath(source: Cs2SourceMode) {
    return source === "installed_game" ? CS2_CSGO_PATH : undefined;
}
