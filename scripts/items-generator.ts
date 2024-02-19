/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from "crypto";
import { copyFileSync, existsSync, readFileSync, readdirSync } from "fs";
import { basename, resolve } from "path";
import { format } from "util";
import { CS_DEFAULT_MAX_WEAR, CS_DEFAULT_MIN_WEAR, CS_Item } from "../src/economy.js";
import { CS_parseValveKeyValue } from "../src/keyvalues.js";
import { CS_TEAM_CT, CS_TEAM_T } from "../src/teams.js";
import { CasesScraper } from "./cases-scraper.js";
import { CS2_CSGO_PATH } from "./env.js";
import {
    CS_CsgoLanguageTXT,
    CS_ItemsGameTXT,
    ClientLootListRecord,
    ItemsRecord,
    LanguagesRecord,
    PaintKitsProps,
    PrefabsRecord,
    RevolvingLootListRecord,
    SafeRaritiesRecord,
    StickerKitsRecord,
    UnsafeRaritiesRecord
} from "./items-generator-types.js";
import { push, readJson, replaceInFile, writeJson } from "./util.js";

const CS2_RESOURCE_PATH = resolve(CS2_CSGO_PATH, "resource");
const CS2_ITEMS_TXT_PATH = resolve(CS2_CSGO_PATH, "scripts/items/items_game.txt");
const CS2_IMAGES_PATH = resolve(CS2_CSGO_PATH, "panorama/images");
const LOOKUP_AGENT_MODEL_JSON_PATH = "assets/data/lookup-agent-model.json";
const LOOKUP_WEAPON_MODEL_JSON_PATH = "assets/data/lookup-weapon-model.json";
const LOOKUP_WEAPON_LEGACY_JSON_PATH = "assets/data/lookup-weapon-legacy.json";
const ITEM_IDS_JSON_PATH = "assets/data/items-ids.json";
const ITEMS_JSON_PATH = "assets/data/items.json";
const PARSED_ITEMS_GAME_JSON_PATH = "assets/data/parsed-items-game.json";
const ITEMS_TS_PATH = "src/items.ts";
const LANGUAGE_JSON_PATH = "assets/translations/items-%s.json";

const LOOT_ITEM_RE = /^\[([^\]]+)\](.*)$/;
const LANGUAGE_FILE_RE = /csgo_([^\._]+)\.txt$/;
const WEAPON_CATEGORY_RE = /(c4|[^\d]+)/;
const PAINT_IMAGE_SUFFIXES = ["light", "medium", "heavy"] as const;
const UNCATEGORIZED_STICKERS = [
    "standard",
    "stickers2",
    "community02",
    "tournament_assets",
    "community_mix01",
    "danger_zone"
];
const HEAVY_WEAPONS = ["weapon_m249", "weapon_mag7", "weapon_negev", "weapon_nova", "weapon_sawedoff", "weapon_xm1014"];
const SECONDARY_WEAPONS = ["weapon_taser"];
const FREE_MUSIC_KITS = ["1", "70"];

export class Items extends Map<number, CS_Item> {
    constructor() {
        super(readJson<CS_Item[]>(ITEMS_JSON_PATH, []).map((item) => [item.id, item]));
    }
}

export class ItemsIds {
    identifiers: string[];
    uniqueIds: string[] = [];

    constructor() {
        this.identifiers = readJson<string[]>(ITEM_IDS_JSON_PATH, []);
    }

    get(identifier: string) {
        if (this.uniqueIds.indexOf(identifier) > -1) {
            throw new Error(`${identifier} is not unique.`);
        }
        this.uniqueIds.push(identifier);
        const index = this.identifiers.indexOf(identifier);
        if (index === -1) {
            this.identifiers.push(identifier);
            return this.identifiers.length - 1;
        }
        return index;
    }
}

export class ItemsGenerator {
    clientLootList: ClientLootListRecord = null!;
    graffitiTints: { name: string; token: string; id: number }[] = null!;
    items: ItemsRecord = null!;
    itemsGameParsed: CS_ItemsGameTXT = null!;
    itemsRaritiesColorHex: SafeRaritiesRecord = null!;
    languages: LanguagesRecord = null!;
    paintKits: PaintKitsProps[] = null!;
    paintKitsRaritiesColorHex: SafeRaritiesRecord = null!;
    prefabs: PrefabsRecord = null!;
    raritiesColorHex: UnsafeRaritiesRecord = null!;
    revolvingLootList: RevolvingLootListRecord = null!;
    stickerKits: StickerKitsRecord = null!;
    translations: LanguagesRecord = null!;

    lookupAgentModel: Record<string, string> = {};
    lookupWeaponModel: Record<string, string> = {};
    lookupWeaponLegacy: Record<string, number[]> = {};

    baseItems: (CS_Item & {
        className?: string;
        nameToken: string;
    })[] = [];
    generatedItems: CS_Item[] = [];

    caseContents = new Map<string, number>();
    casesScraper = new CasesScraper();
    ids = new ItemsIds();
    previousItems = new Items();

    async run() {
        this.readCsgoLanguageTXT();
        this.readItemsGameTXT();

        this.parseWeapons();
        this.parseMelees();
        this.parseGloves();
        this.parseSkins();
        this.parseMusicKits();
        this.parseStickers();
        this.parseGraffiti();
        this.parseAgents();
        this.parsePatches();
        this.parsePins();
        this.parseTools();
        this.parseCases();

        this.persist();
    }

    readCsgoLanguageTXT(include?: string[]) {
        const languages = {} as LanguagesRecord;
        const translations = {} as LanguagesRecord;
        const files = readdirSync(CS2_RESOURCE_PATH);

        for (const file of files) {
            const matches = file.match(LANGUAGE_FILE_RE);
            if (!matches) {
                continue;
            }
            const [, language] = matches;
            if (include !== undefined && !include.includes(language)) {
                continue;
            }
            const contents = readFileSync(resolve(CS2_RESOURCE_PATH, file), "utf-8");
            languages[language] = {};
            translations[language] = {};
            const kv = languages[language];
            console.warn(`parsing csgo_${language}.txt...`);
            const parsed = CS_parseValveKeyValue<CS_CsgoLanguageTXT>(contents);
            for (const key of Object.keys(parsed.lang.Tokens)) {
                const k = key.toLowerCase();
                if (kv[k] !== undefined) {
                    throw new Error(`duplicate key for ${k} on ${language} language file.`);
                }
                kv[k] = parsed.lang.Tokens[key];
            }
        }
        if (Object.keys(languages).length === 0) {
            throw new Error("check your language directory.");
        }
        if (languages.english === undefined) {
            throw new Error("csgo_english.txt file not found.");
        }
        this.languages = languages;
        this.translations = translations;
    }

    readItemsGameTXT() {
        const contents = readFileSync(CS2_ITEMS_TXT_PATH, "utf-8");
        const parsed = CS_parseValveKeyValue<CS_ItemsGameTXT>(contents);

        this.clientLootList = {};
        this.graffitiTints = [];
        this.items = {};
        this.itemsGameParsed = parsed;
        this.itemsRaritiesColorHex = {};
        this.paintKits = [];
        this.paintKitsRaritiesColorHex = {};
        this.prefabs = {};
        this.raritiesColorHex = {};
        this.revolvingLootList = {};
        this.stickerKits = {};

        for (const kv of parsed.items_game.prefabs) {
            for (const [prefabKey, prefabProps] of Object.entries(kv)) {
                this.prefabs[prefabKey] = prefabProps;
            }
        }
        for (const kv of parsed.items_game.items) {
            for (const [itemIndex, itemProps] of Object.entries(kv)) {
                this.items[itemIndex] = itemProps;
            }
        }
        for (const [rarityKey, rarityProps] of Object.entries(parsed.items_game.rarities)) {
            if (rarityProps.color) {
                const colorHex = parsed.items_game.colors[rarityProps.color]?.hex_color;
                if (colorHex) {
                    this.raritiesColorHex[rarityKey] = colorHex;
                }
            }
        }
        const raritiesKeys = Object.keys(this.raritiesColorHex);
        if (!raritiesKeys.includes("default")) {
            throw new Error(`color default not found.`);
        }
        if (!raritiesKeys.includes("common")) {
            throw new Error(`color common not found.`);
        }
        if (!raritiesKeys.includes("rare")) {
            throw new Error(`color rare not found.`);
        }
        for (const kv of parsed.items_game.paint_kits_rarity) {
            for (const [paintKitKey, rarityKey] of Object.entries(kv)) {
                if (this.raritiesColorHex[rarityKey]) {
                    this.paintKitsRaritiesColorHex[paintKitKey] = this.raritiesColorHex[rarityKey];
                } else {
                    console.log(`unable to find color for rarity ${rarityKey}.`);
                }
            }
        }
        for (const kv of parsed.items_game.client_loot_lists) {
            for (const [clientLootListKey, clientLootList] of Object.entries(kv)) {
                // Mapping rarities for items inside loot lists.  Looks like
                // this is the actual rarity of the item, then we fallback to
                // paint, or rarity defined in the item itself.
                const rarityKey = raritiesKeys.find((rarityKey) => clientLootListKey.includes(`_${rarityKey}`));
                if (rarityKey) {
                    for (const itemOrClientLootListKey of Object.keys(clientLootList)) {
                        if (
                            itemOrClientLootListKey.includes("customplayer_") ||
                            itemOrClientLootListKey.match(LOOT_ITEM_RE)
                        ) {
                            this.itemsRaritiesColorHex[itemOrClientLootListKey] = this.raritiesColorHex[rarityKey];
                        }
                    }
                }
            }
        }
        for (const kv of parsed.items_game.paint_kits) {
            for (const [paintKitIndex, paintKitProps] of Object.entries(kv)) {
                if (!paintKitProps.description_tag || paintKitProps.name === "default") {
                    continue;
                }
                const name = this.requireTranslation(paintKitProps.description_tag);
                this.paintKits.push({
                    className: paintKitProps.name,
                    name,
                    nameToken: paintKitProps.description_tag,
                    rarityColorHex: this.getRarityColorHex([paintKitProps.name]),
                    index: Number(paintKitIndex),
                    wearmax:
                        paintKitProps.wear_remap_max !== undefined
                            ? Number(paintKitProps.wear_remap_max)
                            : CS_DEFAULT_MAX_WEAR,
                    wearmin:
                        paintKitProps.wear_remap_min !== undefined
                            ? Number(paintKitProps.wear_remap_min)
                            : CS_DEFAULT_MIN_WEAR
                });
            }
        }
        for (const kv of parsed.items_game.sticker_kits) {
            for (const [stickerIndex, stickerProps] of Object.entries(kv)) {
                this.stickerKits[stickerIndex] = stickerProps;
            }
        }
        for (const kv of parsed.items_game.client_loot_lists) {
            for (const [clientLootListKey, clientLootListItems] of Object.entries(kv)) {
                this.clientLootList[clientLootListKey] = clientLootListItems;
            }
        }
        for (const kv of parsed.items_game.revolving_loot_lists) {
            for (const [revolvingLootListKey, clientLootListKey] of Object.entries(kv)) {
                this.revolvingLootList[revolvingLootListKey] = clientLootListKey;
            }
        }
        for (const graffitiTintProps of Object.values(parsed.items_game.graffiti_tints)) {
            const tintToken = `#Attrib_SprayTintValue_${graffitiTintProps.id}`;
            this.graffitiTints.push({
                id: Number(graffitiTintProps.id),
                name: this.requireTranslation(tintToken),
                token: tintToken
            });
        }
    }

    parseWeapons() {
        console.warn("parsing weapons...");
        for (const [itemIndex, itemProps] of Object.entries(this.items)) {
            if (itemProps.baseitem !== "1" || !itemProps.flexible_loadout_slot) {
                continue;
            }
            const matches = itemProps.flexible_loadout_slot.match(WEAPON_CATEGORY_RE);
            if (!matches) {
                continue;
            }
            const [, category] = matches;
            const isTaser = itemProps.name === "weapon_taser";
            if (category === "equipment" && !isTaser) {
                continue;
            }
            const prefab = this.getPrefab(itemProps.prefab);
            const name = this.requireTranslation(prefab.item_name);
            const teams = this.getTeams(prefab.used_by_classes);
            const id = this.ids.get(`weapon_${teams.join("_")}_${itemIndex}`);

            this.addTranslation(id, name, prefab.item_name);
            this.lookupWeaponModel[itemIndex] = itemProps.name;

            this.baseItems.push({
                base: true,
                category: this.getWeaponCategory(itemProps.name, category),
                className: itemProps.name,
                def: Number(itemIndex),
                free: true,
                id,
                image:
                    prefab.image_inventory !== undefined
                        ? this.getImage(id, prefab.image_inventory)
                        : this.getBaseImage(id, itemProps.name),
                index: undefined,
                model: itemProps.name.replace("weapon_", ""),
                name,
                nameToken: prefab.item_name,
                rarity: this.raritiesColorHex.default,
                teams,
                type: "weapon"
            });
        }
    }

    parseMelees() {
        console.warn("parsing melees...");
        for (const [itemIndex, itemProps] of Object.entries(this.items)) {
            if (
                itemProps.item_name === undefined ||
                itemProps.image_inventory === undefined ||
                itemProps.used_by_classes === undefined ||
                (itemProps.prefab === "melee" && itemProps.baseitem !== "1") ||
                itemProps.prefab?.indexOf("melee") === -1 ||
                itemProps.prefab?.indexOf("noncustomizable") > -1
            ) {
                continue;
            }
            const name = this.findTranslation(itemProps.item_name);
            if (!name) {
                console.log(`unable to find translation for item ${itemProps.item_name}.`);
                continue;
            }
            const prefab = this.getPrefab(itemProps.prefab);
            const teams = this.getTeams(itemProps.used_by_classes);
            const id = this.ids.get(`melee_${teams.join("_")}_${itemIndex}`);

            this.addTranslation(id, name, itemProps.item_name);
            this.lookupWeaponModel[itemIndex] = itemProps.name;

            this.baseItems.push({
                base: true,
                className: itemProps.name,
                def: Number(itemIndex),
                free: itemProps.baseitem === "1" ? true : undefined,
                id,
                image: this.getImage(id, itemProps.image_inventory),
                index: itemProps.baseitem === "1" ? undefined : 0,
                model: itemProps.name.replace("weapon_", ""),
                name,
                nameToken: itemProps.item_name,
                rarity: this.getRarityColorHex([prefab.item_rarity], this.raritiesColorHex.default),
                teams,
                type: "melee"
            });
        }
    }

    parseGloves() {
        console.warn("parse gloves...");
        for (const [itemIndex, itemProps] of Object.entries(this.items)) {
            if (
                itemProps.item_name === undefined ||
                itemProps.prefab?.indexOf("hands") === -1 ||
                !itemProps.used_by_classes
            ) {
                continue;
            }
            const name = this.requireTranslation(itemProps.item_name);
            const teams = this.getTeams(itemProps.used_by_classes);
            const id = this.ids.get(`glove_${teams.join("_")}_${itemIndex}`);
            this.addTranslation(id, name, itemProps.item_name);

            this.baseItems.push({
                base: true,
                className: itemProps.name,
                def: Number(itemIndex),
                free: itemProps.baseitem === "1" ? true : undefined,
                id,
                image:
                    this.previousItems.get(id)?.image ??
                    (itemProps.image_inventory !== undefined
                        ? this.getImage(id, itemProps.image_inventory)
                        : `/${itemProps.name}.png`),
                index: itemProps.baseitem === "1" ? undefined : 0,
                model: itemProps.name,
                name,
                nameToken: itemProps.item_name,
                rarity:
                    itemProps.baseitem === "1" ? this.raritiesColorHex.default : this.getRarityColorHex(["ancient"]),
                teams,
                type: "glove"
            });
        }
    }

    parseSkins() {
        console.warn("parse skins...");
        for (const { icon_path: iconPath } of Object.values(
            this.itemsGameParsed.items_game.alternate_icons2.weapon_icons
        )) {
            if (!iconPath.match(/light$/)) {
                continue;
            }
            const paintKit = this.paintKits.find((paintKit) => iconPath.includes(`_${paintKit.className}_light`));
            if (!paintKit) {
                console.log(`unable to find paint kit for ${iconPath}.`);
                continue;
            }
            const parentItem = this.baseItems.find(({ className }) =>
                iconPath.includes(`/${className}_${paintKit.className}`)
            );
            if (!parentItem) {
                console.log(`unable to find parent item for ${iconPath}.`);
                continue;
            }
            const itemKey = `[${paintKit.className}]${parentItem.className}`;
            const name = `${parentItem.name} | ${paintKit.name}`;
            const id = this.ids.get(`paint_${parentItem.def}_${paintKit.index}`);
            const legacy = this.previousItems.get(id)?.legacy;

            this.addTranslation(id, name, parentItem.nameToken, " | ", paintKit.nameToken);
            this.addCaseContent(itemKey, id);

            if (legacy) {
                push(this.lookupWeaponLegacy, parentItem.def!, paintKit.index);
            }

            this.generatedItems.push({
                ...parentItem,
                base: undefined,
                free: undefined,
                id,
                index: paintKit.index,
                image: this.getSkinImage(id, parentItem.className, paintKit.className),
                legacy,
                name,
                rarity: ["melee", "glove"].includes(parentItem.type)
                    ? this.getRarityColorHex([parentItem.rarity, paintKit.rarityColorHex])
                    : this.getRarityColorHex([itemKey, paintKit.rarityColorHex]),
                wearmax: paintKit.wearmax,
                wearmin: paintKit.wearmin
            });
        }
    }

    parseMusicKits() {
        console.warn("parse music kits...");
        for (const kv of this.itemsGameParsed.items_game.music_definitions) {
            for (const [musicIndex, musicProps] of Object.entries(kv)) {
                if (musicIndex === "2") {
                    // Skip duplicated CS:GO default music kit.
                    continue;
                }
                const itemKey = `[${musicProps.name}]musickit`;
                const name = this.requireTranslation(musicProps.loc_name);
                const id = this.ids.get(`musickit_${musicIndex}`);

                this.addTranslation(id, name, musicProps.loc_name);
                this.addCaseContent(itemKey, id);

                this.generatedItems.push({
                    base: true,
                    free: FREE_MUSIC_KITS.includes(musicIndex) ? true : undefined,
                    id,
                    image: this.previousItems.get(id)?.image ?? this.getImage(id, musicProps.image_inventory),
                    index: Number(musicIndex),
                    name,
                    rarity: this.raritiesColorHex.rare,
                    type: "musickit"
                });
            }
        }
    }

    parseStickers() {
        console.warn("parse stickers...");
        for (const [stickerIndex, stickerProps] of Object.entries(this.stickerKits)) {
            if (
                stickerProps.name === "default" ||
                stickerProps.item_name.indexOf("SprayKit") > -1 ||
                stickerProps.name.indexOf("spray_") > -1 ||
                stickerProps.name.indexOf("patch_") > -1 ||
                stickerProps.sticker_material.indexOf("_graffiti") > -1
            ) {
                continue;
            }
            let category = "";
            let categoryToken = "";
            const [folder, subfolder] = stickerProps.sticker_material.split("/");
            if (folder === "alyx") {
                categoryToken = "#CSGO_crate_sticker_pack_hlalyx_capsule";
                category = this.findTranslation(categoryToken);
            }
            if (UNCATEGORIZED_STICKERS.indexOf(folder) > -1) {
                categoryToken = "";
                category = "Valve";
            }
            if (!category) {
                categoryToken = `#CSGO_sticker_crate_key_${folder}`;
                category = this.findTranslation(categoryToken);
            }
            if (!category) {
                categoryToken = `#CSGO_crate_sticker_pack_${folder}`;
                category = this.findTranslation(categoryToken);
            }
            if (!category) {
                categoryToken = `#CSGO_crate_sticker_pack_${folder}_capsule`;
                category = this.findTranslation(categoryToken);
            }
            if (stickerProps.tournament_event_id) {
                categoryToken = `#CSGO_Tournament_Event_NameShort_${stickerProps.tournament_event_id}`;
                category = this.findTranslation(categoryToken);
                if (!category) {
                    throw new Error(
                        `unable to find the short name for tournament ${stickerProps.tournament_event_id}.`
                    );
                }
            }
            if (!category) {
                categoryToken = `#CSGO_crate_sticker_pack_${subfolder}_capsule`;
                category = this.findTranslation(categoryToken);
            }
            if (!category) {
                throw new Error(`unable to define a category for ${stickerProps.item_name}.`);
            }
            const name = this.findTranslation(stickerProps.item_name);
            if (name === undefined) {
                console.log(`unable to find translation for ${stickerProps.item_name}.`);
                continue;
            }
            const id = this.ids.get(`sticker_${stickerIndex}`);
            const itemKey = `[${stickerProps.name}]sticker`;

            this.addTranslation(id, name, stickerProps.item_name);
            if (categoryToken !== "") {
                this.addTranslation(category, category, categoryToken);
            }
            this.addCaseContent(itemKey, id);

            this.generatedItems.push({
                category,
                id,
                image:
                    this.previousItems.get(id)?.image ??
                    this.getImage(id, `econ/stickers/${stickerProps.sticker_material}`),
                index: Number(stickerIndex),
                name,
                rarity: this.getRarityColorHex([itemKey, `[${stickerProps.name}]sticker`, stickerProps.item_rarity]),
                type: "sticker"
            });
        }
    }

    parseGraffiti() {
        console.warn("parse graffiti...");
        const tintGraffitiNames = readJson<string[]>("assets/data/tint-graffiti-names.json");
        const tintGraffitiImages = readJson<Record<string, string>>("assets/data/tint-graffiti-images.json");
        for (const [graffitiIndex, graffitiProps] of Object.entries(this.stickerKits)) {
            if (
                !graffitiProps.item_name?.includes("#SprayKit") &&
                graffitiProps.item_name?.indexOf("spray_") !== 0 &&
                !graffitiProps.description_string?.includes("#SprayKit")
            ) {
                continue;
            }
            const name = this.findTranslation(graffitiProps.item_name);
            if (name === undefined) {
                console.log(`unable to find translation for ${graffitiProps.item_name}.`);
                continue;
            }
            if (tintGraffitiNames.includes(name)) {
                const graffitiName = this.findTranslation(graffitiProps.item_name);
                let addedToCaseItem = false;
                for (const { name: tintName, token: tintToken, id: tintId } of this.graffitiTints) {
                    const id = this.ids.get(`spray_${graffitiIndex}_${tintId}`);
                    const name = `${graffitiName} (${tintName})`;
                    const image = this.previousItems.get(id)?.image ?? tintGraffitiImages[name];
                    if (!image) {
                        console.log(`unable to find image for ${name}.`);
                        continue;
                    }
                    const itemKey = `[${graffitiProps.name}]spray`;
                    this.addTranslation(id, name, graffitiProps.item_name, " (", tintToken, ")");

                    this.generatedItems.push({
                        id,
                        image,
                        index: Number(graffitiIndex),
                        name,
                        rarity: this.getRarityColorHex([graffitiProps.item_rarity]),
                        tint: tintId,
                        type: "graffiti"
                    });

                    if (!addedToCaseItem) {
                        // @TODO Update `economy-case` to make sure we are
                        // giving random colors for tinted graffiti.
                        this.addCaseContent(itemKey, id);
                        addedToCaseItem = true;
                    }
                }
            } else {
                const id = this.ids.get(`spray_${graffitiIndex}`);
                const itemKey = `[${graffitiProps.name}]spray`;

                this.addTranslation(id, name, graffitiProps.item_name);
                this.addCaseContent(itemKey, id);

                this.generatedItems.push({
                    id,
                    image:
                        this.previousItems.get(id)?.image ??
                        this.getImage(id, `econ/stickers/${graffitiProps.sticker_material}`),
                    index: Number(graffitiIndex),
                    name,
                    rarity: this.getRarityColorHex([
                        itemKey,
                        `[${graffitiProps.name}]spray`,
                        graffitiProps.item_rarity
                    ]),
                    type: "graffiti"
                });
            }
        }
    }

    parsePatches() {
        console.warn("parse patches...");
        for (const [patchIndex, patchProps] of Object.entries(this.stickerKits)) {
            if (patchProps.item_name.indexOf("#PatchKit") !== 0 && patchProps.patch_material === undefined) {
                continue;
            }
            const name = this.requireTranslation(patchProps.item_name);
            if (!name) {
                console.log(`unable to find name for ${patchProps.item_name}.`);
                continue;
            }
            const id = this.ids.get(`patch_${patchIndex}`);
            const itemKey = `[${patchProps.name}]patch`;

            this.addTranslation(id, name, patchProps.item_name);
            this.addCaseContent(itemKey, id);

            this.generatedItems.push({
                id,
                image:
                    this.previousItems.get(id)?.image ?? this.getImage(id, `econ/patches/${patchProps.patch_material}`),
                index: Number(patchIndex),
                teams: [CS_TEAM_CT, CS_TEAM_T],
                name,
                rarity: this.getRarityColorHex([itemKey, `[${patchProps.name}]patch`, patchProps.item_rarity]),
                type: "patch"
            });
        }
    }

    parseAgents() {
        console.warn("parsing agents...");
        for (const [itemIndex, itemProps] of Object.entries(this.items)) {
            if (
                itemProps.item_name === undefined ||
                itemProps.used_by_classes === undefined ||
                itemProps.image_inventory === undefined ||
                itemProps.model_player === undefined ||
                itemProps.prefab !== "customplayertradable"
            ) {
                continue;
            }
            const name = this.requireTranslation(itemProps.item_name);
            const teams = this.getTeams(itemProps.used_by_classes);
            const id = this.ids.get(`agent_${teams.join("_")}_${itemIndex}`);
            const model = itemProps.model_player.replace("characters/models/", "").replace(".vmdl", "");

            this.addTranslation(id, name, itemProps.item_name);
            this.lookupAgentModel[itemIndex] = model;

            this.generatedItems.push({
                def: Number(itemIndex),
                id,
                image: this.previousItems.get(id)?.image ?? this.getImage(id, itemProps.image_inventory),
                index: undefined,
                model,
                name,
                rarity: this.getRarityColorHex([itemProps.name, itemProps.item_rarity]),
                teams,
                type: "agent"
            });
        }
    }

    parsePins() {
        console.warn("parsing pins...");
        for (const [itemIndex, itemProps] of Object.entries(this.items)) {
            if (
                itemProps.image_inventory === undefined ||
                itemProps.item_name === undefined ||
                !itemProps.image_inventory.includes("/status_icons/") ||
                itemProps.tool?.use_string === "#ConsumeItem" ||
                itemProps.attributes?.["set supply crate series"]?.attribute_class === "supply_crate_series" ||
                itemProps.item_name.indexOf("#CSGO_TournamentPass") === 0 ||
                !itemProps.attributes?.["pedestal display model"]
            ) {
                continue;
            }
            const name = this.requireTranslation(itemProps.item_name);
            const id = this.ids.get(`pin_${itemIndex}`);

            this.addTranslation(id, name, itemProps.item_name);
            this.addCaseContent(itemProps.name, id);

            this.generatedItems.push({
                altname: itemProps.name,
                def: Number(itemIndex),
                id,
                image: this.previousItems.get(id)?.image ?? this.getImage(id, itemProps.image_inventory),
                index: undefined,
                name,
                rarity: this.getRarityColorHex([itemProps.item_rarity, "ancient"]),
                teams: undefined,
                type: "pin"
            });
        }
    }

    parseTools() {
        console.warn("parsing tools...");
        for (const [itemIndex, itemProps] of Object.entries(this.items)) {
            if (
                itemProps.image_inventory === undefined ||
                itemProps.item_name === undefined ||
                !itemProps.image_inventory.includes("econ/tools/") ||
                !itemProps.prefab.includes("csgo_tool")
            ) {
                continue;
            }
            const name = this.requireTranslation(itemProps.item_name);
            const id = this.ids.get(`tool_${itemIndex}`);

            this.addTranslation(id, name, itemProps.item_name);
            this.addCaseContent(itemProps.name, id);

            this.generatedItems.push({
                def: Number(itemIndex),
                id,
                image: this.previousItems.get(id)?.image ?? this.getImage(id, itemProps.image_inventory),
                index: undefined,
                name,
                rarity: this.getRarityColorHex(["common"]),
                teams: undefined,
                type: "tool"
            });
        }
    }

    parseCases() {
        console.warn("parsing cases...");
        this.casesScraper.populate(this.baseItems, this.generatedItems);
        const keyItems = new Map<string, number>();
        for (const [itemIndex, itemProps] of Object.entries(this.items)) {
            if (
                itemProps.item_name === undefined ||
                itemProps.image_inventory === undefined ||
                (itemProps.prefab !== "weapon_case" &&
                    itemProps.attributes?.["set supply crate series"]?.attribute_class !== "supply_crate_series" &&
                    itemProps.loot_list_name === undefined) ||
                !itemProps.image_inventory.includes("econ/weapon_cases") ||
                itemProps.tool?.type === "gift"
            ) {
                continue;
            }
            const contents = [] as number[];
            const revolvingLootListKey = itemProps.attributes?.["set supply crate series"]?.value;
            if (!revolvingLootListKey && !itemProps.loot_list_name) {
                throw new Error(`revolving loot list key not found for ${itemProps.name}.`);
            }
            const clientLootListKey =
                revolvingLootListKey !== undefined
                    ? this.revolvingLootList[revolvingLootListKey]
                    : itemProps.loot_list_name;
            if (!clientLootListKey) {
                console.log(`client loot list key not found for ${itemProps.name}`);
                continue;
            }
            for (const itemKey of this.getClientLootListItems(clientLootListKey)) {
                if (!this.caseContents.has(itemKey)) {
                    throw new Error(`item ${itemKey} not found.`);
                }
                contents.push(this.caseContents.get(itemKey)!);
            }
            if (contents.length === 0) {
                console.log(`no items found for ${itemProps.name}.`);
            }
            if (contents.length > 0) {
                const name = this.requireTranslation(itemProps.item_name);
                const id = this.ids.get(`case_${itemIndex}`);
                const specials = this.casesScraper.getSpecials(name);
                this.addTranslation(id, name, itemProps.item_name);

                if (!itemProps.associated_items) {
                    if (
                        itemProps.prefab !== "sticker_capsule" &&
                        itemProps.prefab !== "weapon_case_souvenirpkg" &&
                        !itemProps.tags?.StickerCapsule &&
                        !itemProps.name.includes("crate_signature") &&
                        !itemProps.name.includes("crate_pins") &&
                        !itemProps.name.includes("crate_musickit") &&
                        !itemProps.name.includes("crate_patch") &&
                        !itemProps.name.includes("crate_sprays") &&
                        !itemProps.name.includes("selfopeningitem") &&
                        !itemProps.prefab.includes("selfopening")
                    ) {
                        throw new Error(`no key found for case ${itemProps.name}`);
                    }
                    itemProps.associated_items = {};
                }

                const keys = Object.keys(itemProps.associated_items).map((itemIndex) => {
                    if (keyItems.has(itemIndex)) {
                        return keyItems.get(itemIndex)!;
                    }
                    const itemProps = this.items[itemIndex];
                    const id = this.ids.get(`key_${itemIndex}`);
                    if (!itemProps.item_name) {
                        console.log(`name not found for key of ${itemIndex}, fallback to #CSGO_base_crate_key.`);
                        itemProps.item_name = "#CSGO_base_crate_key";
                    }
                    if (itemProps.image_inventory === undefined) {
                        throw new Error(`image_inventory not found for key of ${itemIndex}.`);
                    }
                    const name = this.requireTranslation(itemProps.item_name);
                    this.addTranslation(id, name, itemProps.item_name);
                    this.generatedItems.push({
                        def: Number(itemIndex),
                        id,
                        image: this.previousItems.get(id)?.image ?? this.getImage(id, itemProps.image_inventory),
                        name,
                        rarity: this.raritiesColorHex.common,
                        teams: undefined,
                        type: "key"
                    });
                    keyItems.set(itemIndex, id);
                    return id;
                });

                this.generatedItems.push({
                    contents,
                    def: Number(itemIndex),
                    id,
                    image: this.previousItems.get(id)?.image ?? this.getImage(id, itemProps.image_inventory),
                    keys: keys.length > 0 ? keys : undefined,
                    name,
                    rarity: this.raritiesColorHex.common,
                    specials: this.previousItems.get(id)?.specials ?? specials,
                    specialsimage:
                        itemProps.image_unusual_item !== undefined
                            ? this.getSpecialsImage(id, itemProps.image_unusual_item)
                            : undefined,
                    teams: undefined,
                    type: "case"
                });
            }
        }
    }

    persist() {
        const items = [...this.baseItems, ...this.generatedItems].map((item) => ({
            ...item,
            className: undefined,
            nameToken: undefined
        }));

        writeJson(LOOKUP_AGENT_MODEL_JSON_PATH, this.lookupAgentModel);
        console.warn(`generated ${LOOKUP_AGENT_MODEL_JSON_PATH}.`);

        writeJson(LOOKUP_WEAPON_MODEL_JSON_PATH, this.lookupWeaponModel);
        console.warn(`generated ${LOOKUP_WEAPON_MODEL_JSON_PATH}.`);

        writeJson(LOOKUP_WEAPON_LEGACY_JSON_PATH, this.lookupWeaponLegacy);
        console.warn(`generated ${LOOKUP_WEAPON_LEGACY_JSON_PATH}.`);

        writeJson(PARSED_ITEMS_GAME_JSON_PATH, this.itemsGameParsed);
        console.warn(`generated ${PARSED_ITEMS_GAME_JSON_PATH}.`);

        writeJson(ITEMS_JSON_PATH, items);
        console.warn(`generated ${ITEMS_JSON_PATH}.`);

        writeJson(ITEM_IDS_JSON_PATH, this.ids.identifiers);
        console.warn(`generated ${ITEM_IDS_JSON_PATH}.`);

        for (const [language, translations] of Object.entries(this.translations)) {
            const path = format(LANGUAGE_JSON_PATH, language);
            writeJson(path, translations);
            console.warn(`generated ${path}.`);
        }

        replaceInFile(ITEMS_TS_PATH, /CS_Item\[\] = [^;]+;/, `CS_Item[] = ${JSON.stringify(items)};`);
        console.warn(`updated ${ITEMS_TS_PATH}.`);
        console.warn("script completed.");
    }

    addTranslation(id: number | string, englishName: string, ...keys: string[]) {
        for (const language of Object.keys(this.languages)) {
            if (language === "english") {
                continue;
            }
            const translatedName = keys
                .map((key) => {
                    if (key.at(0) !== "#") {
                        return key;
                    }
                    const translation = this.findTranslation(key, language);
                    if (!translation) {
                        console.log(`translation of ${key} not found for ${language}.`);
                    }
                    return translation || this.requireTranslation(key);
                })
                .join("");

            if (translatedName !== englishName) {
                console.log(`skipped translation of ${keys} for ${language} (same as english).`);
                this.translations[language][id] = translatedName;
            }
        }
    }

    requireTranslation(key: string, language = "english") {
        const translation = this.languages[language][key.substring(1).toLowerCase()];
        if (!translation) {
            throw new Error(`unable to find translation for ${key}.`);
        }
        return translation;
    }

    findTranslation(key: string, language = "english") {
        return this.languages[language][key.substring(1).toLowerCase()];
    }

    getTeams(teams: Record<string, string>) {
        return Object.keys(teams).map((team) => {
            switch (team) {
                case "counter-terrorists":
                    return CS_TEAM_CT;
                case "terrorists":
                    return CS_TEAM_T;
            }
            throw new Error(`unknown team ${team}.`);
        });
    }

    getFileSha1(path: string) {
        if (!existsSync(path)) {
            return undefined;
        }
        const buffer = readFileSync(path);
        const hashSum = createHash("sha1");
        hashSum.update(buffer);
        return hashSum.digest("hex");
    }

    // Currently we don't know how to get the CDN urls from the files
    // themselves, previoulsy we could get the SHA1 hash of a file and then use
    // it to resolve a CDN url, but this method no longer works. For new items
    // this is going to return undefined and is meant to be self-hosted

    getImage(id: number, path: string) {
        const cs2ImagePath = resolve(CS2_IMAGES_PATH, path + "_png.png");
        const destPath = resolve(process.cwd(), `assets/images/${id}.png`);
        copyFileSync(cs2ImagePath, destPath);
        return undefined;
    }

    getBaseImage(id: number, className: string) {
        return this.getImage(id, `econ/weapons/base_weapons/${className}`);
    }

    getSkinImage(id: number, className: string | undefined, paintClassName: string | undefined) {
        const paths = PAINT_IMAGE_SUFFIXES.map((suffix) => [
            resolve(CS2_IMAGES_PATH, `econ/default_generated/${className}_${paintClassName}_${suffix}_png.png`),
            resolve(process.cwd(), `assets/images/${id}_${suffix}.png`)
        ]);
        for (const [src, dest] of paths) {
            copyFileSync(src, dest);
        }
        // returns the image with light suffix.
        return this.getImage(id, paths[0][0].replace("_png.png", ""));
    }

    getWeaponCategory(name: string, category: string) {
        if (SECONDARY_WEAPONS.includes(name)) {
            return "secondary";
        }
        if (HEAVY_WEAPONS.includes(name)) {
            return "heavy";
        }
        return category;
    }

    getPrefab(prefabKey: string) {
        const prefab = this.prefabs[prefabKey];
        if (!prefab) {
            throw new Error(`unable to find prefab for ${prefabKey}`);
        }
        return prefab;
    }

    getRarityColorHex(keywords: (string | undefined)[], defaultTo?: string) {
        let colorHex =
            defaultTo !== undefined
                ? defaultTo.charAt(0) === "#"
                    ? defaultTo
                    : this.raritiesColorHex[defaultTo] ?? ""
                : "";
        for (const keyword of keywords) {
            if (!keyword) {
                continue;
            }
            if (keyword.charAt(0) === "#") {
                colorHex = keyword;
                break;
            }
            if (this.itemsRaritiesColorHex[keyword]) {
                colorHex = this.itemsRaritiesColorHex[keyword]!;
                break;
            }
            if (this.paintKitsRaritiesColorHex[keyword]) {
                colorHex = this.paintKitsRaritiesColorHex[keyword]!;
                break;
            }
            if (this.raritiesColorHex[keyword]) {
                colorHex = this.raritiesColorHex[keyword];
                break;
            }
        }
        if (!colorHex && !defaultTo) {
            console.log(`unable to find rarity for ${keywords.join(",")}.`);
        }
        if (!colorHex) {
            colorHex = this.raritiesColorHex.default;
        }
        return colorHex;
    }

    addCaseContent(itemKey: string, id: number) {
        if (this.caseContents.has(itemKey)) {
            throw new Error(`duplicate found for ${itemKey}.`);
        }
        this.caseContents.set(itemKey, id);
    }

    getClientLootListItems(clientLootListKey: string, items: string[] = []) {
        if (!this.clientLootList[clientLootListKey]) {
            console.log(`unable to find loot list for key ${clientLootListKey}.`);
            return [];
        }
        const itemOrClientLootListKeys = Object.keys(this.clientLootList[clientLootListKey]);
        for (const itemOrClientLootListKey of itemOrClientLootListKeys) {
            // At this point, `caseItemMap` should be populated with all economy
            // items that can be retrieved from cases.
            if (!this.caseContents.has(itemOrClientLootListKey)) {
                // If we did not find, that means that it's probably a reference
                // to another loot list...
                this.getClientLootListItems(itemOrClientLootListKey, items);
            } else {
                items.push(itemOrClientLootListKey);
            }
        }
        return items;
    }

    getSpecialsImage(id: number, path: string) {
        const src = resolve(CS2_IMAGES_PATH, `${path}_png.png`);
        const dest = resolve(process.cwd(), `assets/images/${id}_rare.png`);
        if (existsSync(src)) {
            copyFileSync(src, dest);
            return true;
        }
        return undefined;
    }
}

if (basename(process.argv[1]) === "items-generator.ts") {
    new ItemsGenerator().run();
}
