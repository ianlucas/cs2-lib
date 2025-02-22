/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { copyFileSync, existsSync, readFileSync } from "fs";
import { readFile, readdir, unlink } from "fs/promises";
import { resolve } from "path";
import sharp from "sharp";
import { stripHtml } from "string-strip-html";
import { format } from "util";
import { CS2_DEFAULT_MAX_WEAR, CS2_DEFAULT_MIN_WEAR } from "../src/economy-constants.js";
import { CS2RarityColorValues } from "../src/economy-container.js";
import {
    CS2ContainerType,
    CS2ItemLocalization,
    CS2ItemLocalizationByLanguage,
    CS2ItemTeam,
    CS2ItemType,
    CS2ItemTypeValues,
    CS2StickerMarkup
} from "../src/economy-types.js";
import { CS2KeyValues } from "../src/keyvalues.js";
import { CS2KeyValues3 } from "../src/keyvalues3.js";
import { assert, ensure, fail, isNotUndefined } from "../src/utils.js";
import { ContainerScraper } from "./container-scraper.js";
import { CS2_CSGO_PATH } from "./env.js";
import { ExternalCS2 } from "./external-cs2.js";
import { HARDCODED_SPECIALS } from "./item-generator-specials.js";
import { useItemsTemplate } from "./item-generator-templates.js";
import { CS2ExportItem, CS2ExtendedItem, CS2GameItems, CS2Language } from "./item-generator-types.js";
import { exists, prependHash, readJson, shouldRun, warning, write, writeJson } from "./utils.js";

const AGENTS_SOUNDEVENTS_PATH = resolve(CS2_CSGO_PATH, "soundevents/vo/agents");
const IMAGES_PATH = resolve(CS2_CSGO_PATH, "panorama/images");
const ITEMS_GAME_PATH = resolve(CS2_CSGO_PATH, "scripts/items/items_game.txt");
const RESOURCE_PATH = resolve(CS2_CSGO_PATH, "resource");
const DECOMPILED_PATH = resolve(process.cwd(), "scripts/workdir/decompiled");

const ITEM_IDS_JSON_PATH = "assets/data/items-ids.json";
const ITEMS_GAME_JSON_PATH = "assets/data/items-game.json";
const ITEMS_JSON_PATH = "assets/data/items.json";
const ITEMS_TS_PATH = "src/items.ts";
const LOCALIZATIONS_JSON_PATH = "assets/localizations/items-%s.json";
const STICKER_MARKUP_PATH = "assets/data/sticker-markup.json";

const FORMATTED_STRING_RE = /%s(\d+)/g;
const LANGUAGE_FILE_RE = /csgo_([^\._]+)\.txt$/;
const LIGHT_ICON_RE = /light$/;
const LOOT_ITEM_RE = /^\[([^\]]+)\](.*)$/;
const SKIN_PHASE_RE = /_phase(\d)/;
const WEAPON_CATEGORY_RE = /(c4|[^\d]+)/;

const BASE_WEAPON_EQUIPMENT = ["weapon_taser"];
const FREE_MUSIC_KITS = ["1", "70"];
const HEAVY_WEAPONS = ["weapon_m249", "weapon_mag7", "weapon_negev", "weapon_nova", "weapon_sawedoff", "weapon_xm1014"];
const MELEE_OR_GLOVES_TYPES: CS2ItemTypeValues[] = [CS2ItemType.Melee, CS2ItemType.Gloves];
const PAINT_IMAGE_SUFFIXES = ["light", "medium", "heavy"] as const;
// prettier-ignore
const UNCATEGORIZED_STICKERS = ["community_mix01", "community02", "danger_zone", "standard", "stickers2", "tournament_assets"];
const REMOVE_KEYCHAIN_TOOL_INDEX = "65";

export class ItemManager extends Map<number, any> {
    constructor() {
        super(readJson<any[]>(ITEMS_JSON_PATH, []).map((item) => [item.id, item]));
    }
}

export class ItemIdentifierManager {
    allIdentifiers = readJson<string[]>(ITEM_IDS_JSON_PATH, []);
    uniqueIdentifiers: string[] = [];

    get(identifier: string) {
        assert(!this.uniqueIdentifiers.includes(identifier));
        this.uniqueIdentifiers.push(identifier);
        const index = this.allIdentifiers.indexOf(identifier);
        if (index === -1) {
            this.allIdentifiers.push(identifier);
            return this.allIdentifiers.length - 1;
        }
        return index;
    }
}

export class DefaultGraffitiManager {
    private static names = readJson<string[]>("assets/data/tint-graffiti-names.json");
    private static images = readJson<Record<string, string | undefined>>("assets/data/tint-graffiti-images.json");

    includes(name: string) {
        return DefaultGraffitiManager.names.includes(name);
    }

    getImage(name: string) {
        return DefaultGraffitiManager.images[name];
    }
}

export class ItemGenerator {
    gameItems: CS2GameItems["items_game"] = null!;

    private csgoLocalizationByLanguage: Record<string, CS2Language["lang"]["Tokens"]> = null!;
    private itemLocalizationByLanguage: CS2ItemLocalizationByLanguage = null!;
    private itemNames = new Map<number, string>();
    private itemSetItemKey: Record<string, string | undefined> = null!;
    private itemsRaritiesColorHex: typeof this.raritiesColorHex = null!;
    private paintKitsRaritiesColorHex: typeof this.raritiesColorHex = null!;
    private raritiesColorHex: Record<string, string | undefined> = null!;

    private containerScraper = new ContainerScraper();
    private defaultGraffitiManager = new DefaultGraffitiManager();
    private itemIdentifierManager = new ItemIdentifierManager();
    private itemManager = new ItemManager();
    private cs2 = new ExternalCS2();

    private baseItems: CS2ExtendedItem[] = [];
    private containerItems = new Map<string, number>();
    private items = new Map<number, CS2ExtendedItem>();

    private stickerMarkup: CS2StickerMarkup = {};

    private paintKits: {
        className: string;
        compositeMaterialPath?: string;
        descToken?: string;
        index: number;
        isLegacy: boolean;
        nameToken: string;
        rarityColorHex: string;
        wearMax: number;
        wearMin: number;
    }[] = null!;

    private graffitiTints: {
        id: number;
        name: string;
        nameToken: string;
    }[];

    async run() {
        await this.readCsgoLanguageFiles();
        await this.readItemsGameFile();
        await this.parseBaseWeapons();
        this.parseBaseMelees();
        this.parseBaseGloves();
        await this.parseSkins();
        this.parseMusicKits();
        this.parseStickers();
        this.parseKeychains();
        this.parseGraffiti();
        this.parsePatches();
        this.parseAgents();
        this.parseCollectibles();
        this.parseTools();
        this.parseContainers();
        this.persist();
    }

    async readCsgoLanguageFiles(include?: string[]) {
        this.itemLocalizationByLanguage = {};
        this.csgoLocalizationByLanguage = Object.fromEntries(
            await Promise.all(
                (await readdir(RESOURCE_PATH))
                    .map((file) => {
                        const matches = file.match(LANGUAGE_FILE_RE);
                        return matches !== null ? ([file, matches[1]] as const) : undefined;
                    })
                    .filter(isNotUndefined)
                    .filter(([_, language]) => include === undefined || include.includes(language))
                    .map(async ([file, language]) => {
                        this.itemLocalizationByLanguage[language] = {};
                        return [
                            language,
                            Object.entries(
                                CS2KeyValues.parse<CS2Language>(await readFile(resolve(RESOURCE_PATH, file), "utf-8"))
                                    .lang.Tokens
                            ).reduce((tokens, [key, value]) => {
                                key = key.toLowerCase();
                                assert(tokens[key] === undefined);
                                tokens[key] = value;
                                return tokens;
                            }, {})
                        ];
                    })
            )
        );
        const { length } = Object.keys(this.csgoLocalizationByLanguage);
        assert(length > 0);
        assert(this.csgoLocalizationByLanguage.english !== undefined);
        warning(`Loaded ${length} languages.`);
    }

    async readItemsGameFile() {
        this.gameItems = CS2KeyValues.parse<CS2GameItems>(await readFile(ITEMS_GAME_PATH, "utf-8")).items_game;
        this.raritiesColorHex = Object.fromEntries(
            Object.entries(this.gameItems.rarities).map(([rarityKey, { color }]) => {
                return [rarityKey, ensure(this.gameItems.colors[ensure(color)]?.hex_color)] as const;
            })
        );
        assert(this.raritiesColorHex.default !== undefined);
        assert(this.raritiesColorHex.common !== undefined);
        assert(this.raritiesColorHex.rare !== undefined);
        this.paintKitsRaritiesColorHex = Object.fromEntries(
            Object.entries(this.gameItems.paint_kits_rarity).map(([paintKitKey, rarityKey]) => {
                return [paintKitKey, this.raritiesColorHex[rarityKey]] as const;
            })
        );
        const rarityKeys = Object.keys(this.raritiesColorHex);
        this.itemsRaritiesColorHex = Object.fromEntries(
            // Mapping rarities for items inside loot lists. Looks like this is
            // the actual rarity of the item, then we fallback to paint, or
            // rarity defined in the item itself.
            Object.entries(this.gameItems.client_loot_lists)
                .map(([clientLootListKey, clientLootList]) => {
                    const rarityKey = rarityKeys.find((rarityKey) => clientLootListKey.includes(`_${rarityKey}`));
                    return rarityKey !== undefined
                        ? Object.keys(clientLootList)
                              .map((itemOrClientLootListKey) =>
                                  itemOrClientLootListKey.includes("customplayer_") ||
                                  LOOT_ITEM_RE.test(itemOrClientLootListKey)
                                      ? ([itemOrClientLootListKey, this.raritiesColorHex[rarityKey]] as const)
                                      : undefined
                              )
                              .filter(isNotUndefined)
                        : undefined;
                })
                .filter(isNotUndefined)
                .flat()
        );
        this.paintKits = Object.entries(this.gameItems.paint_kits)
            .map(
                ([
                    paintKitIndex,
                    {
                        composite_material_path,
                        description_string,
                        description_tag,
                        name,
                        use_legacy_model,
                        wear_remap_max,
                        wear_remap_min
                    }
                ]) => {
                    assert(name);
                    if (name === "default" || description_tag === undefined) {
                        return undefined;
                    }
                    return {
                        className: name,
                        compositeMaterialPath: composite_material_path,
                        descToken: prependHash(description_string),
                        index: Number(paintKitIndex),
                        isLegacy: use_legacy_model === "1",
                        nameToken: prependHash(description_tag),
                        rarityColorHex: this.getRarityColorHex([name]),
                        wearMax: wear_remap_max !== undefined ? Number(wear_remap_max) : CS2_DEFAULT_MAX_WEAR,
                        wearMin: wear_remap_min !== undefined ? Number(wear_remap_min) : CS2_DEFAULT_MIN_WEAR
                    };
                }
            )
            .filter(isNotUndefined);
        this.graffitiTints = Object.values(this.gameItems.graffiti_tints).map(({ id }) => ({
            id: Number(id),
            name: this.requireTranslation(`#Attrib_SprayTintValue_${id}`),
            nameToken: `#Attrib_SprayTintValue_${id}`
        }));
        this.itemSetItemKey = Object.fromEntries(
            Object.entries(this.gameItems.item_sets)
                .map(([itemSetKey, { items }]) => {
                    this.getCollectionImage(itemSetKey);
                    return Object.keys(items).map((itemKey) => [itemKey, itemSetKey] as const);
                })
                .flat()
        );
    }

    private async parseBaseWeapons() {
        warning("Parsing base weapons...");
        for (const [itemDef, { baseitem, flexible_loadout_slot, name, prefab, image_inventory }] of Object.entries(
            this.gameItems.items
        )) {
            if (baseitem !== "1" || flexible_loadout_slot === undefined) {
                continue;
            }
            const category = flexible_loadout_slot.match(WEAPON_CATEGORY_RE)?.[1];
            if (category === undefined || (category === "equipment" && !BASE_WEAPON_EQUIPMENT.includes(name))) {
                continue;
            }
            const { used_by_classes, item_name, item_description, model_player } = this.getPrefab(prefab);
            const teams = this.getTeams(used_by_classes);
            const id = this.itemIdentifierManager.get(`weapon_${this.getTeamsString(used_by_classes)}_${itemDef}`);
            this.addTranslation(id, "name", item_name);
            this.addTranslation(id, "desc", item_description);
            this.addItem({
                base: true,
                category: this.getBaseWeaponCategory(name, category),
                className: name,
                def: Number(itemDef),
                descToken: item_description,
                free: true,
                id,
                image: image_inventory !== undefined ? this.getImage(id, image_inventory) : this.getBaseImage(id, name),
                index: undefined,
                model: name.replace("weapon_", ""),
                nameToken: item_name,
                rarity: this.getRarityColorHex(["default"]),
                teams,
                type: CS2ItemType.Weapon
            });
            await this.findStickerMarkup(itemDef, model_player);
        }
    }

    private parseBaseMelees() {
        warning("Parsing base melee...");
        for (const [
            itemDef,
            { item_name, image_inventory, item_description, name, used_by_classes, prefab, baseitem }
        ] of Object.entries(this.gameItems.items)) {
            if (
                item_name === undefined ||
                image_inventory === undefined ||
                used_by_classes === undefined ||
                (prefab === "melee" && baseitem !== "1") ||
                !prefab?.includes("melee") ||
                prefab?.includes("noncustomizable") ||
                !this.hasTranslation(item_name)
            ) {
                continue;
            }
            const thePrefab = this.getPrefab(prefab);
            const teams = this.getTeams(used_by_classes);
            const id = this.itemIdentifierManager.get(`melee_${this.getTeamsString(used_by_classes)}_${itemDef}`);
            this.addTranslation(id, "name", item_name);
            this.addTranslation(id, "desc", item_description);
            this.addItem({
                base: true,
                className: name,
                def: Number(itemDef),
                descToken: item_description,
                free: baseitem === "1" ? true : undefined,
                id,
                image: this.getImage(id, image_inventory),
                index: baseitem === "1" ? undefined : 0,
                model: name.replace("weapon_", ""),
                nameToken: item_name,
                rarity: this.getRarityColorHex([thePrefab.item_rarity], "default"),
                teams,
                type: CS2ItemType.Melee
            });
        }
    }

    private parseBaseGloves() {
        warning("Parsing base gloves...");
        for (const [
            itemDef,
            { item_name, baseitem, name, prefab, image_inventory, item_description, used_by_classes }
        ] of Object.entries(this.gameItems.items)) {
            if (item_name === undefined || !prefab?.includes("hands") || used_by_classes === undefined) {
                continue;
            }
            const teams = this.getTeams(used_by_classes);
            const id = this.itemIdentifierManager.get(`glove_${this.getTeamsString(used_by_classes)}_${itemDef}`);
            this.addTranslation(id, "name", item_name);
            this.addTranslation(id, "desc", item_description);
            this.addItem({
                base: true,
                className: name,
                def: Number(itemDef),
                descToken: item_description,
                free: baseitem === "1" ? true : undefined,
                id,
                image: image_inventory !== undefined ? this.getImage(id, image_inventory) : `/${name}.png`,
                index: baseitem === "1" ? undefined : 0,
                model: name,
                nameToken: item_name,
                rarity: this.getRarityColorHex([baseitem === "1" ? "default" : "ancient"]),
                teams,
                type: CS2ItemType.Gloves
            });
        }
    }

    private async parseSkins() {
        warning("Parsing skins...");
        for (const { icon_path } of Object.values(this.gameItems.alternate_icons2.weapon_icons)) {
            if (!LIGHT_ICON_RE.test(icon_path)) {
                continue;
            }
            const paintKit = this.paintKits.find(({ className }) => icon_path.includes(`_${className}_light`));
            if (paintKit === undefined) {
                continue;
            }
            const baseItem = this.baseItems.find(({ className }) =>
                icon_path.includes(`/${className}_${paintKit.className}`)
            );
            if (baseItem === undefined) {
                continue;
            }
            const itemKey = `[${paintKit.className}]${baseItem.className}`;
            const id = this.itemIdentifierManager.get(`paint_${baseItem.def}_${paintKit.index}`);
            this.addContainerItem(itemKey, id);
            this.addTranslation(id, "name", baseItem.nameToken, " | ", paintKit.nameToken);
            this.addTranslation(id, "desc", paintKit.descToken);
            this.addItem({
                ...baseItem,
                ...this.getSkinCollection(id, itemKey),
                altName: this.getSkinAltName(paintKit.className),
                base: undefined,
                baseId: baseItem.id,
                free: undefined,
                id,
                image: this.getSkinImage(id, baseItem.className, paintKit.className),
                index: Number(paintKit.index),
                legacy: paintKit.isLegacy,
                rarity: this.getRarityColorHex(
                    MELEE_OR_GLOVES_TYPES.includes(baseItem.type)
                        ? [baseItem.rarity, paintKit.rarityColorHex]
                        : [itemKey, paintKit.rarityColorHex]
                ),
                texture:
                    (await this.getSkinTexture(id, paintKit.className, paintKit.compositeMaterialPath)) ??
                    (await exists(resolve(process.cwd(), `assets/textures/${id}.webp`))),
                wearMax: paintKit.wearMax,
                wearMin: paintKit.wearMin
            });
        }
    }

    private parseMusicKits() {
        warning("Parsing music kits...");
        const baseId = this.createStub("musickit", "#CSGO_musickit_desc");
        for (const [index, { name, loc_name, loc_description, image_inventory }] of Object.entries(
            this.gameItems.music_definitions
        )) {
            if (index === "2") {
                // Duplicated CS:GO Music Kit.
                continue;
            }
            const itemKey = `[${name}]musickit`;
            const id = this.itemIdentifierManager.get(`musickit_${index}`);
            const base = FREE_MUSIC_KITS.includes(index) ? true : undefined;
            this.addContainerItem(itemKey, id);
            this.addTranslation(id, "name", "#CSGO_Type_MusicKit", " | ", loc_name);
            this.addTranslation(id, "desc", loc_description);
            this.addItem({
                base,
                baseId,
                def: 1314,
                free: base,
                id,
                image: this.itemManager.get(id)?.image ?? this.getImage(id, image_inventory),
                index: Number(index),
                rarity: this.getRarityColorHex(["rare"]),
                type: CS2ItemType.MusicKit
            });
        }
    }

    private parseStickers() {
        warning("Parsing stickers...");
        const baseId = this.createStub("sticker", "#CSGO_Tool_Sticker_Desc");
        for (const [
            index,
            { name, description_string, item_name, sticker_material, tournament_event_id, item_rarity }
        ] of Object.entries(this.gameItems.sticker_kits)) {
            if (
                name === "default" ||
                item_name.includes("SprayKit") ||
                name.includes("spray_") ||
                name.includes("patch_") ||
                sticker_material.includes("_graffiti") ||
                !this.hasTranslation(item_name)
            ) {
                continue;
            }
            const [category, categoryToken] = this.getStickerCategory({ sticker_material, tournament_event_id });
            const id = this.itemIdentifierManager.get(`sticker_${index}`);
            const itemKey = `[${name}]sticker`;
            this.addContainerItem(itemKey, id);
            this.addTranslation(id, "name", "#CSGO_Tool_Sticker", " | ", item_name);
            this.addTranslation(id, "category", categoryToken !== undefined ? categoryToken : category);
            this.tryAddTranslation(id, "desc", description_string);
            if (tournament_event_id !== undefined) {
                this.addFormattedTranslation(
                    id,
                    "tournamentDesc",
                    "#CSGO_Event_Desc",
                    `#CSGO_Tournament_Event_Name_${tournament_event_id}`
                );
            }
            this.addItem({
                baseId,
                def: 1209,
                id,
                image: this.itemManager.get(id)?.image ?? this.getImage(id, `econ/stickers/${sticker_material}`),
                index: Number(index),
                rarity: this.getRarityColorHex([itemKey, item_rarity]),
                type: CS2ItemType.Sticker
            });
        }
    }

    private parseKeychains() {
        warning("Parsing keychains...");
        const baseId = this.createStub("keychain", "#CSGO_Tool_Keychain_Desc");
        for (const [index, { name, loc_name, loc_description, item_rarity, image_inventory }] of Object.entries(
            this.gameItems.keychain_definitions
        )) {
            if (!this.hasTranslation(loc_name)) {
                continue;
            }
            const id = this.itemIdentifierManager.get(`keychain_${index}`);
            const itemKey = `[${name}]keychain`;
            this.addContainerItem(itemKey, id);
            this.addTranslation(id, "name", "#CSGO_Tool_Keychain", " | ", loc_name);
            this.tryAddTranslation(id, "desc", loc_description);
            this.addItem({
                baseId,
                def: 1355,
                id,
                image: this.itemManager.get(id)?.image ?? this.getImage(id, image_inventory),
                index: Number(index),
                rarity: this.getRarityColorHex([itemKey, item_rarity]),
                type: CS2ItemType.Keychain
            });
        }
    }

    private parseGraffiti() {
        warning("Parsing graffiti...");
        const baseId = this.createStub("graffiti", "#CSGO_Tool_SprayPaint_Desc");
        for (const [
            index,
            { name, item_name, description_string, sticker_material, item_rarity, tournament_event_id }
        ] of Object.entries(this.gameItems.sticker_kits)) {
            if (
                !this.hasTranslation(item_name) ||
                (!item_name?.includes("#SprayKit") &&
                    item_name?.indexOf("spray_") !== 0 &&
                    !description_string?.includes("#SprayKit") &&
                    !sticker_material?.includes("_graffiti"))
            ) {
                continue;
            }
            const graffitiName = this.requireTranslation(item_name);
            const itemKey = `[${name}]spray`;
            if (this.defaultGraffitiManager.includes(graffitiName)) {
                for (const { name: tintName, nameToken: tintNameToken, id: tintId } of this.graffitiTints) {
                    const id = this.itemIdentifierManager.get(`spray_${index}_${tintId}`);
                    const graffitiNameWithTint = `${graffitiName} (${tintName})`;
                    const image =
                        this.itemManager.get(id)?.image ?? this.defaultGraffitiManager.getImage(graffitiNameWithTint);
                    if (image === undefined) {
                        continue;
                    }
                    this.addContainerItem(itemKey, id);
                    this.addTranslation(id, "name", "#CSGO_Type_Spray", " | ", item_name, " (", tintNameToken, ")");
                    this.addTranslation(id, "desc", description_string);
                    this.addItem({
                        baseId,
                        id,
                        image,
                        index: Number(index),
                        rarity: this.getRarityColorHex([item_rarity]),
                        tint: tintId,
                        type: CS2ItemType.Graffiti
                    });
                }
                continue;
            }
            const id = this.itemIdentifierManager.get(`spray_${index}`);
            this.addContainerItem(itemKey, id);
            this.addTranslation(id, "name", "#CSGO_Type_Spray", " | ", item_name);
            this.addTranslation(id, "desc", description_string);
            if (tournament_event_id !== undefined) {
                this.addFormattedTranslation(
                    id,
                    "tournamentDesc",
                    "#CSGO_Event_Desc",
                    `#CSGO_Tournament_Event_Name_${tournament_event_id}`
                );
            }
            this.addItem({
                baseId,
                def: 1348,
                id,
                image: this.itemManager.get(id)?.image ?? this.getImage(id, `econ/stickers/${sticker_material}`),
                index: Number(index),
                rarity: this.getRarityColorHex([itemKey, item_rarity]),
                type: CS2ItemType.Graffiti
            });
        }
    }

    private parsePatches() {
        warning("Parsing patches...");
        const baseId = this.createStub("patch", "#CSGO_Tool_Patch_Desc");
        for (const [
            index,
            { name, item_name, patch_material, description_string, tournament_event_id, item_rarity }
        ] of Object.entries(this.gameItems.sticker_kits)) {
            if (item_name.indexOf("#PatchKit") !== 0 && patch_material === undefined) {
                continue;
            }
            const id = this.itemIdentifierManager.get(`patch_${index}`);
            const itemKey = `[${name}]patch`;
            this.addContainerItem(itemKey, id);
            this.addTranslation(id, "name", "#CSGO_Tool_Patch", " | ", item_name);
            this.addTranslation(id, "desc", description_string);
            if (tournament_event_id !== undefined) {
                this.addFormattedTranslation(
                    id,
                    "tournamentDesc",
                    "#CSGO_Event_Desc",
                    `#CSGO_Tournament_Event_Name_${tournament_event_id}`
                );
            }
            this.addItem({
                baseId,
                def: 4609,
                id,
                image: this.itemManager.get(id)?.image ?? this.getImage(id, `econ/patches/${patch_material}`),
                index: Number(index),
                rarity: this.getRarityColorHex([itemKey, item_rarity]),
                type: CS2ItemType.Patch
            });
        }
    }

    private parseAgents() {
        warning("Parsing agents...");
        for (const [
            index,
            {
                name,
                item_name,
                vo_prefix,
                used_by_classes,
                image_inventory,
                model_player,
                item_rarity,
                prefab,
                item_description
            }
        ] of Object.entries(this.gameItems.items)) {
            if (
                item_name === undefined ||
                used_by_classes === undefined ||
                image_inventory === undefined ||
                model_player === undefined ||
                prefab !== "customplayertradable"
            ) {
                continue;
            }
            const teams = this.getTeams(used_by_classes);
            const id = this.itemIdentifierManager.get(`agent_${this.getTeamsString(used_by_classes)}_${index}`);
            const model = model_player.replace("characters/models/", "").replace(".vmdl", "");
            const voPrefix = this.getAgentVoPrefix(model_player, vo_prefix);
            this.addTranslation(id, "name", "#Type_CustomPlayer", " | ", item_name);
            this.addTranslation(id, "desc", item_description);
            this.addItem({
                def: Number(index),
                id,
                image: this.itemManager.get(id)?.image ?? this.getImage(id, image_inventory),
                index: undefined,
                model,
                rarity: this.getRarityColorHex([name, item_rarity]),
                teams,
                type: CS2ItemType.Agent,
                voFallback: this.getAgentVoFallback(voPrefix),
                voFemale: this.getAgentVoFemale(voPrefix),
                voPrefix
            });
        }
    }

    private parseCollectibles() {
        warning("Parsing collectibles...");
        for (const [
            index,
            { name, image_inventory, item_name, tool, attributes, item_rarity, item_description }
        ] of Object.entries(this.gameItems.items)) {
            if (
                image_inventory === undefined ||
                item_name === undefined ||
                !image_inventory.includes("/status_icons/") ||
                tool?.use_string === "#ConsumeItem" ||
                attributes?.["set supply crate series"]?.attribute_class === "supply_crate_series" ||
                item_name.indexOf("#CSGO_TournamentPass") === 0 ||
                !attributes?.["pedestal display model"]
            ) {
                continue;
            }
            const id = this.itemIdentifierManager.get(`pin_${index}`);
            this.addContainerItem(name, id);
            this.addTranslation(id, "name", "#CSGO_Type_Collectible", " | ", item_name);
            this.tryAddTranslation(id, "desc", item_description ?? `${item_name}_Desc`);
            if (attributes?.["tournament event id"] !== undefined) {
                this.addFormattedTranslation(
                    id,
                    "tournamentDesc",
                    "#CSGO_Event_Desc",
                    `#CSGO_Tournament_Event_Name_${attributes?.["tournament event id"].value}`
                );
            }
            this.addItem({
                altName: name,
                def: Number(index),
                id,
                image: this.itemManager.get(id)?.image ?? this.getImage(id, image_inventory),
                index: undefined,
                rarity: this.getRarityColorHex([item_rarity, "ancient"]),
                teams: undefined,
                type: CS2ItemType.Collectible
            });
        }
    }

    private parseTools() {
        warning("Parsing tools...");
        for (const [index, { name, baseitem, item_name, image_inventory, prefab, item_description }] of Object.entries(
            this.gameItems.items
        )) {
            if (
                prefab !== "recipe" &&
                (item_name === undefined ||
                    image_inventory === undefined ||
                    !image_inventory.includes("econ/tools/") ||
                    !prefab?.includes("csgo_tool"))
            ) {
                continue;
            }
            const id = this.itemIdentifierManager.get(`tool_${index}`);
            const thePrefab = this.gameItems.prefabs[prefab];
            const image = ensure(image_inventory || thePrefab?.image_inventory);
            this.addContainerItem(name, id);
            this.addTranslation(id, "name", "#CSGO_Type_Tool", " | ", item_name);
            this.addTranslation(id, "desc", item_description);
            this.addItem({
                def: Number(index),
                free: baseitem === "1" && index !== REMOVE_KEYCHAIN_TOOL_INDEX ? true : undefined,
                id,
                image: this.getImage(id, image),
                index: undefined,
                rarity: this.getRarityColorHex(["common"]),
                teams: undefined,
                type: CS2ItemType.Tool
            });
        }
    }

    private parseContainers() {
        warning("Parsing containers...");
        this.containerScraper.populate(
            Array.from(this.itemNames.entries()).map(([id, name]) => [name, ensure(this.items.get(id))])
        );
        const keyItems = new Map<string, number>();
        for (const [
            containerIndex,
            {
                associated_items,
                attributes,
                image_inventory,
                image_unusual_item,
                item_description,
                item_name,
                loot_list_name,
                name,
                prefab,
                tags,
                tool
            }
        ] of Object.entries(this.gameItems.items)) {
            const hasSupplyCrateSeries =
                attributes?.["set supply crate series"]?.attribute_class === "supply_crate_series";
            if (
                item_name === undefined ||
                image_inventory === undefined ||
                (!image_inventory.includes("econ/weapon_cases") && !hasSupplyCrateSeries) ||
                tool?.type === "gift" ||
                (prefab !== "weapon_case" && !hasSupplyCrateSeries && loot_list_name === undefined)
            ) {
                continue;
            }
            const revolvingLootListKey = attributes?.["set supply crate series"]?.value;
            assert(revolvingLootListKey !== undefined || loot_list_name !== undefined);
            const clientLootListKey =
                revolvingLootListKey !== undefined
                    ? this.gameItems.revolving_loot_lists[revolvingLootListKey]
                    : loot_list_name;
            if (clientLootListKey === undefined) {
                continue;
            }
            let contentsType: CS2ItemTypeValues | undefined;
            const contents: number[] = [];
            for (const itemKey of this.getClientLootListItems(clientLootListKey)) {
                const id = ensure(this.containerItems.get(itemKey));
                const item = ensure(this.items.get(id));
                contentsType = item.type;
                if (item.tint !== undefined) {
                    assert(item.index);
                    for (const other of this.items.values()) {
                        if (other.tint !== undefined && other.index === item.index) {
                            contents.push(other.id);
                        }
                    }
                } else {
                    contents.push(id);
                }
            }
            if (contents.length > 0) {
                const thePrefab = this.tryGetPrefab(prefab);
                // Asserts if the container requires a key.
                assert(
                    associated_items !== undefined ||
                        prefab === "sticker_capsule" ||
                        prefab === "weapon_case_souvenirpkg" ||
                        thePrefab?.prefab === "weapon_case_souvenirpkg" ||
                        tags?.StickerCapsule ||
                        name.includes("crate_signature") ||
                        name.includes("crate_pins") ||
                        name.includes("crate_musickit") ||
                        name.includes("crate_patch") ||
                        name.includes("crate_sprays") ||
                        name.includes("selfopeningitem") ||
                        prefab?.includes("selfopening")
                );
                const keys = Object.keys(associated_items ?? {}).map((keyItemDef) => {
                    if (keyItems.has(keyItemDef)) {
                        return ensure(keyItems.get(keyItemDef));
                    }
                    const { item_name, item_description, image_inventory } = this.gameItems.items[keyItemDef];
                    assert(image_inventory);
                    const id = this.itemIdentifierManager.get(`key_${keyItemDef}`);
                    const nameToken = item_name ?? "#CSGO_base_crate_key";
                    keyItems.set(keyItemDef, id);
                    this.addTranslation(id, "name", "#CSGO_Tool_WeaponCase_KeyTag", " | ", nameToken);
                    this.tryAddTranslation(id, "desc", item_description);
                    this.addItem({
                        def: Number(keyItemDef),
                        id,
                        image: this.itemManager.get(id)?.image ?? this.getImage(id, image_inventory),
                        rarity: this.getRarityColorHex(["common"]),
                        teams: undefined,
                        type: CS2ItemType.Key
                    });
                    return id;
                });
                const containerName = this.requireTranslation(item_name);
                const id = this.itemIdentifierManager.get(`case_${containerIndex}`);
                const specials = this.containerScraper.getSpecials(containerName) ?? HARDCODED_SPECIALS[id];
                const containsMusicKit = containerName.includes("Music Kit");
                const containsStatTrak = containerName.includes("StatTrak");
                this.addTranslation(id, "name", "#CSGO_Type_WeaponCase", " | ", item_name);
                this.tryAddTranslation(id, "desc", item_description);
                this.addItem({
                    ...this.getCollection(id, tags?.ItemSet?.tag_value),
                    containerType: this.getContainerType(containerName, contentsType),
                    contents,
                    def: Number(containerIndex),
                    id,
                    image: this.itemManager.get(id)?.image ?? this.getImage(id, image_inventory),
                    keys: keys.length > 0 ? keys : undefined,
                    rarity: this.getRarityColorHex(["common"]),
                    specials: this.itemManager.get(id)?.specials ?? specials,
                    specialsImage: this.getSpecialsImage(id, image_unusual_item),
                    statTrakless: containsMusicKit && !containsStatTrak ? true : undefined,
                    statTrakOnly: containsMusicKit && containsStatTrak ? true : undefined,
                    teams: undefined,
                    type: CS2ItemType.Container
                });
            }
        }
    }

    private persist() {
        const items: CS2ExportItem[] = Array.from(this.items.values()).map((item) => ({
            ...item,
            className: undefined,
            descToken: undefined,
            nameToken: undefined
        }));

        writeJson(ITEMS_JSON_PATH, items);
        warning(`Generated '${ITEMS_JSON_PATH}'.`);

        writeJson(ITEM_IDS_JSON_PATH, this.itemIdentifierManager.allIdentifiers);
        warning(`Generated '${ITEM_IDS_JSON_PATH}'.`);

        for (const [language, translations] of Object.entries(this.itemLocalizationByLanguage)) {
            const path = format(LOCALIZATIONS_JSON_PATH, language);
            writeJson(path, translations);
            warning(`Generated '${path}'.`);
        }

        writeJson(ITEMS_GAME_JSON_PATH, this.gameItems);
        warning(`Generated '${ITEMS_GAME_JSON_PATH}'.`);

        write(ITEMS_TS_PATH, useItemsTemplate(items));
        warning(`Generated '${ITEMS_TS_PATH}'.`);

        if (Object.keys(this.stickerMarkup).length > 0) {
            writeJson(STICKER_MARKUP_PATH, this.stickerMarkup);
            warning(`Generated '${STICKER_MARKUP_PATH}'.`);
        }

        warning("Script completed.");
    }

    private getRarityColorHex(keywords: (string | undefined)[], defaultsTo?: string) {
        let colorHex =
            defaultsTo !== undefined
                ? defaultsTo.charAt(0) === "#"
                    ? defaultsTo
                    : this.raritiesColorHex[defaultsTo]
                : undefined;
        for (const keyword of keywords) {
            if (keyword === undefined) {
                continue;
            }
            if (keyword.charAt(0) === "#") {
                colorHex = keyword;
                break;
            }
            colorHex =
                this.itemsRaritiesColorHex[keyword] ??
                this.paintKitsRaritiesColorHex[keyword] ??
                this.raritiesColorHex[keyword];
            if (colorHex !== undefined) {
                break;
            }
        }
        if (colorHex === undefined) {
            colorHex = this.raritiesColorHex.default;
        }
        return ensure(colorHex) as CS2RarityColorValues;
    }

    private findTranslation(token?: string, language = "english") {
        if (token === undefined) {
            return undefined;
        }
        const value = this.csgoLocalizationByLanguage[language][token.substring(1).toLowerCase()];
        return value !== undefined ? stripHtml(value).result : undefined;
    }

    requireTranslation(token?: string, language = "english") {
        return ensure(this.findTranslation(token, language));
    }

    private hasTranslation(token?: string) {
        return (
            token !== undefined &&
            this.csgoLocalizationByLanguage.english[token.substring(1).toLowerCase()] !== undefined
        );
    }

    private addTranslation(id: number, property: keyof CS2ItemLocalization, ...tokens: (string | undefined)[]) {
        for (const [language, items] of Object.entries(this.itemLocalizationByLanguage)) {
            const itemLanguage = (items[id] ??= {} as CS2ItemLocalization);
            const string = tokens
                .map((key) => {
                    assert(key !== undefined);
                    if (key.at(0) !== "#") {
                        return key;
                    }
                    return this.findTranslation(key, language) ?? this.requireTranslation(key);
                })
                .join("")
                .trim();
            if (property === "name") {
                assert(string.length > 0);
                if (language === "english") {
                    this.itemNames.set(id, string);
                }
            }
            if (string.length > 0) {
                itemLanguage[property] = string;
            }
        }
    }

    private tryAddTranslation(id: number, property: keyof CS2ItemLocalization, ...tokens: (string | undefined)[]) {
        if (tokens.some((token) => token === undefined || (token.charAt(0) === "#" && !this.hasTranslation(token)))) {
            return undefined;
        }
        return this.addTranslation(id, property, ...tokens);
    }

    private addFormattedTranslation(
        id: number,
        property: keyof CS2ItemLocalization,
        key?: string,
        ...values: string[]
    ) {
        for (const [language, items] of Object.entries(this.itemLocalizationByLanguage)) {
            (items[id] ??= {} as CS2ItemLocalization)[property] = (
                this.findTranslation(key, language) ?? this.requireTranslation(key, "english")
            ).replace(FORMATTED_STRING_RE, (_, index) => {
                const key = values[parseInt(index, 10) - 1];
                return this.findTranslation(key, language) ?? this.requireTranslation(key, "english");
            });
        }
    }

    private getPrefab(prefab?: string) {
        return ensure(this.gameItems.prefabs[ensure(prefab)]);
    }

    private tryGetPrefab(prefab?: string) {
        return prefab !== undefined ? this.gameItems.prefabs[prefab] : undefined;
    }

    private getTeams(teams?: Record<string, string>) {
        const keys = Object.keys(ensure(teams));
        const ct = keys.includes("counter-terrorists");
        const t = keys.includes("terrorists");
        switch (true) {
            case ct && t:
                return CS2ItemTeam.Both;
            case ct:
                return CS2ItemTeam.CT;
            case t:
                return CS2ItemTeam.T;
            default:
                return fail();
        }
    }

    private getTeamsString(teams?: Record<string, string>) {
        // We changed the way we determine the team of an item, we use this
        // logic only for getting the item id.
        return Object.keys(ensure(teams))
            .map((team) => {
                switch (team) {
                    case "counter-terrorists":
                        return 3;
                    case "terrorists":
                        return 2;
                    default:
                        return fail();
                }
            })
            .join("_");
    }

    private addItem(item: CS2ExtendedItem) {
        if (item.base) {
            this.baseItems.push(item);
        }
        this.items.set(item.id, item);
    }

    private getBaseWeaponCategory(name: string, category: string) {
        if (HEAVY_WEAPONS.includes(name)) {
            return "heavy";
        }
        return category;
    }

    private getImage(id: number, path: string) {
        // Currently we don't know how to get the CDN urls from the files
        // themselves, previoulsy we could get the SHA1 hash of a file and then
        // use it to resolve a CDN url, but this method no longer works. For new
        // items this is going to return undefined and is meant to be
        // self-hosted.
        const cs2ImagePath = resolve(IMAGES_PATH, `${path}_png.png`.toLowerCase());
        const destPath = resolve(process.cwd(), `assets/images/${id}.png`);
        copyFileSync(cs2ImagePath, destPath);
        return undefined;
    }

    private getBaseImage(id: number, className: string) {
        return this.getImage(id, `econ/weapons/base_weapons/${className}`);
    }

    private getSkinImage(id: number, className: string | undefined, paintClassName: string | undefined) {
        const paths = PAINT_IMAGE_SUFFIXES.map((suffix) => [
            resolve(
                IMAGES_PATH,
                `econ/default_generated/${className}_${paintClassName}_${suffix}_png.png`.toLowerCase()
            ),
            resolve(process.cwd(), `assets/images/${id}_${suffix}.png`)
        ]);
        for (const [src, dest] of paths) {
            copyFileSync(src, dest);
        }
        return this.getImage(id, paths[0][0].replace("_png.png", ""));
    }

    private getSkinAltName(className: string) {
        switch (true) {
            case className.includes("_phase"):
                return `Phase ${className.match(SKIN_PHASE_RE)?.[1]}`;
            case className.includes("sapphire_marbleized"):
                return "Sapphire";
            case className.includes("ruby_marbleized"):
                return "Ruby";
            case className.includes("blackpearl_marbleized"):
                return "Black Pearl";
            case className.includes("emerald_marbleized"):
                return "Emerald";
            default:
                return undefined;
        }
    }

    private getStickerCategory({
        sticker_material,
        tournament_event_id
    }: {
        sticker_material: string;
        tournament_event_id?: string;
    }) {
        let category: string | undefined;
        let categoryToken: string | undefined;
        const [folder, subfolder] = sticker_material.split("/");
        if (folder === "alyx") {
            categoryToken = "#CSGO_crate_sticker_pack_hlalyx_capsule";
            category = this.findTranslation(categoryToken);
        }
        if (subfolder == "elemental_craft") {
            categoryToken = "#CSGO_crate_sticker_pack_stkr_craft_01_capsule";
            category = this.findTranslation(categoryToken);
        }
        if (UNCATEGORIZED_STICKERS.includes(folder)) {
            categoryToken = undefined;
            category = "Valve";
        }
        if (category === undefined) {
            categoryToken = `#CSGO_crate_sticker_pack_${folder}`;
            category = this.findTranslation(categoryToken);
        }
        if (category === undefined) {
            categoryToken = `#CSGO_crate_sticker_pack_${folder}_capsule`;
            category = this.findTranslation(categoryToken);
        }
        if (tournament_event_id !== undefined) {
            categoryToken = `#CSGO_Tournament_Event_NameShort_${tournament_event_id}`;
            category = this.findTranslation(categoryToken);
            assert(category, `unable to find the short name for tournament '${tournament_event_id}'.`);
        }
        if (category === undefined) {
            categoryToken = `#CSGO_crate_sticker_pack_${subfolder}_capsule`;
            category = this.findTranslation(categoryToken);
        }
        if (category === undefined) {
            categoryToken = `#CSGO_sticker_crate_key_${folder}`;
            category = this.findTranslation(categoryToken);
        }
        if (category === undefined) {
            categoryToken = undefined;
            category = "Valve";
        }
        return [ensure(category), categoryToken] as const;
    }

    private getAgentVoPrefix(model: string, prefix?: string) {
        switch (true) {
            case prefix === "ctm_gsg9":
                return "gsg9";
            case prefix !== undefined:
                return prefix;
            case model.includes("tm_leet"):
                return "leet";
            case model.includes("ctm_st6"):
                return "seal";
            case model.includes("ctm_swat"):
                return "swat";
            case model.includes("tm_balkan"):
                return "balkan";
            case model.includes("tm_professional"):
                return "professional";
            case model.includes("tm_phoenix"):
                return "phoenix";
            case model.includes("ctm_fbi"):
                return "fbihrt";
            case model.includes("ctm_sas"):
                return "sas";
            default:
                return fail();
        }
    }

    private getAgentVoFemale(prefix: string) {
        if (prefix.includes("_fem")) {
            return true;
        }
        if (prefix === "fbihrt_epic") {
            return true;
        }
        return undefined;
    }

    private getAgentVoFallback(prefix: string) {
        return readFileSync(resolve(AGENTS_SOUNDEVENTS_PATH, `game_sounds_${prefix}.vsndevts`), "utf-8").includes(
            "radiobot"
        )
            ? true
            : undefined;
    }

    private getCollectionImage(name: string) {
        const src = resolve(IMAGES_PATH, `econ/set_icons/${name}_png.png`);
        const dest = resolve(process.cwd(), `assets/images/${name}.png`);
        copyFileSync(src, dest);
    }

    private getCollection(itemId: number, collection?: string) {
        if (collection !== undefined) {
            const itemSet = this.gameItems.item_sets[collection];
            assert(itemSet, `Collection '${collection}' not found.`);
            assert(itemSet.name, `Collection name not found for '${collection}'.`);
            this.tryAddTranslation(itemId, "collectionName", itemSet.name);
            this.tryAddTranslation(itemId, "collectionDesc", itemSet.set_description);
        }
        return { collection };
    }

    private getSkinCollection(itemId: number, itemKey: string) {
        return this.getCollection(itemId, this.itemSetItemKey[itemKey]);
    }

    private addContainerItem(itemKey: string, id: number) {
        if (!this.containerItems.has(itemKey)) {
            this.containerItems.set(itemKey, id);
        }
    }

    private getClientLootListItems(clientLootListKey: string, items: string[] = []) {
        if (!this.gameItems.client_loot_lists[clientLootListKey]) {
            return [];
        }
        const itemOrClientLootListKeys = Object.keys(this.gameItems.client_loot_lists[clientLootListKey]);
        for (const itemOrClientLootListKey of itemOrClientLootListKeys) {
            // At this point, `containerItems` should be populated with all
            // economy items that can be retrieved from containers.
            if (this.containerItems.has(itemOrClientLootListKey)) {
                items.push(itemOrClientLootListKey);
            } else {
                // If we did not find, that means that it's probably a reference
                // to another loot list...
                this.getClientLootListItems(itemOrClientLootListKey, items);
            }
        }
        return items;
    }

    private getSpecialsImage(id: number, path?: string) {
        const src = resolve(IMAGES_PATH, `${path}_png.png`);
        const dest = resolve(process.cwd(), `assets/images/${id}_rare.png`);
        if (existsSync(src)) {
            copyFileSync(src, dest);
            return true;
        }
        return undefined;
    }

    private async findStickerMarkup(itemDef?: string, modelPath?: string) {
        try {
            if (itemDef === undefined || modelPath === undefined || !this.cs2.active) {
                return;
            }
            modelPath = modelPath.replace(".vmdl", ".vmdl_c");
            const output = (
                await this.cs2.decompile({
                    vpkFilepath: modelPath,
                    block: "DATA"
                })
            ).split(`--- Data for block "DATA" ---`)[1];
            const data = CS2KeyValues3.parse<{
                StickerMarkup: {
                    Index: number;
                    LegacyModel: boolean;
                    Offset: number[];
                    Rotation: number;
                    Scale: number;
                }[];
            }>(
                CS2KeyValues3.parse<{
                    m_modelInfo: {
                        m_keyValueText: string;
                    };
                }>(output).m_modelInfo.m_keyValueText
            );
            this.stickerMarkup[itemDef] = data.StickerMarkup.map(
                ({ Index: slot, LegacyModel: legacy, Offset: offsets, Rotation: rotation, Scale: scale }) => ({
                    slot,
                    legacy,
                    offsets,
                    rotation,
                    scale
                })
            );
        } catch (error) {
            console.log(`Unable to get sticker markup for ${modelPath}`);
        }
    }

    private async getTexturePathFromCompositeMaterial(compositeMaterialPath?: string) {
        try {
            if (compositeMaterialPath === undefined) {
                return undefined;
            }
            return ensure(
                CS2KeyValues3.parse<{
                    m_Points: {
                        m_vecCompositeMaterialAssemblyProcedures: {
                            m_vecCompositeInputContainers: {
                                m_strAlias: string;
                                m_vecLooseVariables: {
                                    m_strName: string;
                                    m_strTextureRuntimeResourcePath: string;
                                }[];
                            }[];
                        }[];
                    }[];
                }>(
                    (
                        await this.cs2.decompile({
                            vpkFilepath: compositeMaterialPath,
                            block: "DATA"
                        })
                    ).split(`--- Data for block "DATA" ---`)[1]
                )
                    .m_Points[0].m_vecCompositeMaterialAssemblyProcedures[0].m_vecCompositeInputContainers.find(
                        ({ m_strAlias }) => m_strAlias === "exposed_params"
                    )
                    ?.m_vecLooseVariables.find(({ m_strName }) => m_strName === "g_tPattern")
                    ?.m_strTextureRuntimeResourcePath.split(":")[1]
            );
        } catch {
            console.log(`Unable to get texture path from ${compositeMaterialPath}.`);
            return undefined;
        }
    }

    private async getTexturePathFromMaterial(materialPath: string) {
        return ensure(
            CS2KeyValues3.parse<{
                m_textureParams: { m_name: string; m_pValue: string }[];
            }>(
                (
                    await this.cs2.decompile({
                        vpkFilepath: materialPath,
                        block: "DATA"
                    })
                ).split(`--- Data for block "DATA" ---`)[1]
            ).m_textureParams.find(({ m_name }) => m_name === "g_tPattern")
        ).m_pValue.split(":")[1];
    }

    private async getSkinTexture(id: number, materialName: string, compositeMaterialPath?: string) {
        try {
            if (!this.cs2.active) {
                return undefined;
            }
            const materialFilename = `${materialName}.vmat_c`;
            const materialPath = `materials/models/weapons/customization/paints/vmats/${materialFilename}`;
            const texturePath =
                (await this.getTexturePathFromCompositeMaterial(compositeMaterialPath)) ??
                (await this.getTexturePathFromMaterial(materialPath));
            if (!texturePath.startsWith("materials/models/weapons/customization/paints/custom")) {
                return undefined;
            }
            await this.cs2.decompile({
                vpkFilepath: texturePath,
                decompile: true,
                output: DECOMPILED_PATH
            });
            const decompiledPath = resolve(DECOMPILED_PATH, texturePath.replace(".vtex", ".png"));
            await sharp(await readFile(decompiledPath))
                .resize(1024, 1024)
                .toFile(resolve(process.cwd(), `assets/textures/${id}.webp`));
            await unlink(decompiledPath);
            return true;
        } catch (error) {
            console.log(`Unable to get skin texture for ${materialName} (id: ${id})`);
            return undefined;
        }
    }

    getContainerType(name?: string, type?: CS2ItemTypeValues) {
        switch (true) {
            case name?.includes("Souvenir"):
                return CS2ContainerType.SouvenirCase;
            case type === CS2ItemType.Weapon:
                return CS2ContainerType.WeaponCase;
            case type === CS2ItemType.Sticker:
                return CS2ContainerType.StickerCapsule;
            case type === CS2ItemType.Graffiti:
                return CS2ContainerType.GraffitiBox;
            default:
                return undefined;
        }
    }

    createStub(name: string, descToken: string) {
        const id = this.itemIdentifierManager.get(`stub_${name}`);
        this.addTranslation(id, "name", "#Rarity_Default");
        this.addTranslation(id, "desc", descToken);
        this.addItem({
            id,
            type: CS2ItemType.Stub
        });
        return id;
    }
}

if (shouldRun(import.meta.url)) {
    new ItemGenerator().run();
}
