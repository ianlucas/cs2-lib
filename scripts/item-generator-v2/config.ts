/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from "path";
import { availableParallelism } from "os";
import { CS2, SCRIPTS_DIR, WORKDIR_DIR } from "../cs2.ts";

export const GAME_IMAGES_DIR = join(WORKDIR_DIR, "decompiled/panorama/images");
export const GAME_ITEMS_PATH = join(WORKDIR_DIR, "decompiled/scripts/items/items_game.txt");
export const GAME_RESOURCE_DIR = join(WORKDIR_DIR, "decompiled/resource");
export const OUTPUT_DIR = join(WORKDIR_DIR, "output");

export const V2_WORKDIR_DIR = join(WORKDIR_DIR, "item-generator-v2");
export const V2_CACHE_DIR = join(V2_WORKDIR_DIR, "cache");
export const V2_STATE_DIR = join(V2_WORKDIR_DIR, "state");
export const V2_REPORTS_DIR = join(V2_WORKDIR_DIR, "reports");
export const V2_BUILD_DIR = join(V2_WORKDIR_DIR, "build");

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

export const PARITY_IGNORED_FIELDS = new Set([
    "image",
    "collectionImage",
    "specialsImage",
    "modelData",
    "modelPlayer",
    "compositeMaterial"
]);

export type ItemGeneratorV2Mode = "limited" | "full";

export function detectItemGeneratorV2Mode() {
    return new CS2().local ? "full" : "limited" as ItemGeneratorV2Mode;
}
