/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from "crypto";
import { copyFileSync, existsSync, readFileSync, readdirSync } from "fs";
import { basename, resolve } from "path";
import { format } from "util";
import { CS_DEFAULT_MAX_WEAR, CS_DEFAULT_MIN_WEAR, CS_Item, CS_ItemTranslations } from "../src/economy.js";
import { CS_parseValveKeyValue } from "../src/keyvalues.js";
import { CS_TEAM_CT, CS_TEAM_T } from "../src/teams.js";
import { assert, fail } from "../src/util.js";
import { CaseScraper } from "./case-scraper.js";
import { CS2_CSGO_PATH } from "./env.js";
import {
    CS_CsgoLanguageTXT,
    CS_ItemsGameTXT,
    ClientLootListRecord,
    ItemSetsRecord,
    ItemsRecord,
    LanguagesRecord,
    PaintKitsProps,
    PrefabsRecord,
    RevolvingLootListRecord,
    SafeRaritiesRecord,
    StickerKitsRecord,
    UnsafeRaritiesRecord
} from "./item-generator-types.js";
import { log, push, readJson, replaceInFile, warning, writeJson } from "./util.js";

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
const WEAPON_SKIP_EXCEPTION = ["weapon_taser"];
const FREE_MUSIC_KITS = ["1", "70"];

export class ItemManager extends Map<number, CS_Item> {
    constructor() {
        super(readJson<CS_Item[]>(ITEMS_JSON_PATH, []).map((item) => [item.id, item]));
    }
}

export class ItemIdentifierManager {
    allIdentifiers = readJson<string[]>(ITEM_IDS_JSON_PATH, []);
    uniqueIdentifiers: string[] = [];

    get(identifier: string) {
        assert(
            this.uniqueIdentifiers.indexOf(identifier) === -1,
            `'${identifier}' is not unique. Every item must have a unique identifier.`
        );
        this.uniqueIdentifiers.push(identifier);
        const index = this.allIdentifiers.indexOf(identifier);
        if (index === -1) {
            this.allIdentifiers.push(identifier);
            return this.allIdentifiers.length - 1;
        }
        return index;
    }
}

export class ItemGenerator {
    clientLootList: ClientLootListRecord = null!;
    graffitiTints: { name: string; token: string; id: number }[] = null!;
    items: ItemsRecord = null!;
    itemsGameParsed: CS_ItemsGameTXT = null!;
    itemsRaritiesColorHex: SafeRaritiesRecord = null!;
    itemSets: ItemSetsRecord = null!;
    itemSetItemKey: Record<string, string> = null!;
    languages: LanguagesRecord = null!;
    paintKits: PaintKitsProps[] = null!;
    paintKitsRaritiesColorHex: SafeRaritiesRecord = null!;
    prefabs: PrefabsRecord = null!;
    raritiesColorHex: UnsafeRaritiesRecord = null!;
    revolvingLootList: RevolvingLootListRecord = null!;
    stickerKits: StickerKitsRecord = null!;
    translations: CS_ItemTranslations = null!;

    lookupAgentModel: Record<string, string> = {};
    lookupWeaponModel: Record<string, string> = {};
    lookupWeaponLegacy: Record<string, number[]> = {};

    baseItems: (CS_Item & {
        className?: string;
        nameToken: string;
    })[] = [];
    generatedItems = new Map<number, CS_Item>();

    caseContents = new Map<string, number>();
    casesScraper = new CaseScraper();
    itemIdentifierManager = new ItemIdentifierManager();
    itemManager = new ItemManager();

    async run() {
        this.readCsgoLanguage();
        this.readItemsGame();

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

    readCsgoLanguage(include?: string[]) {
        const languages = {} as LanguagesRecord;
        const translations = {} as CS_ItemTranslations;
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
            warning(`Parsing 'csgo_${language}.txt'...`);
            const parsed = CS_parseValveKeyValue<CS_CsgoLanguageTXT>(contents);
            for (const key of Object.keys(parsed.lang.Tokens)) {
                const k = key.toLowerCase();
                assert(kv[k] === undefined, `Duplicate key for '${k}' on '${language}' language file.`);
                kv[k] = parsed.lang.Tokens[key];
            }
        }
        assert(Object.keys(languages).length > 0, "Check CS2's resource directory, no languages were found.");
        assert(languages.english !== undefined, "Check CS2's resource directory, 'csgo_english.txt' was not found.");
        this.languages = languages;
        this.translations = translations;
    }

    readItemsGame() {
        const contents = readFileSync(CS2_ITEMS_TXT_PATH, "utf-8");
        const parsed = CS_parseValveKeyValue<CS_ItemsGameTXT>(contents);

        this.clientLootList = {};
        this.graffitiTints = [];
        this.items = {};
        this.itemSetItemKey = {};
        this.itemSets = {};
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
        assert(raritiesKeys.includes("default"), `Color 'default' was not found.`);
        assert(raritiesKeys.includes("common"), `Color 'common' was not found.`);
        assert(raritiesKeys.includes("rare"), `Color 'rare' was not found.`);
        for (const kv of parsed.items_game.paint_kits_rarity) {
            for (const [paintKitKey, rarityKey] of Object.entries(kv)) {
                if (this.raritiesColorHex[rarityKey]) {
                    this.paintKitsRaritiesColorHex[paintKitKey] = this.raritiesColorHex[rarityKey];
                } else {
                    log(`Color for rarity '${rarityKey}' was not found.`);
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
        for (const kv of parsed.items_game.item_sets) {
            for (const [itemSetKey, itemSetProps] of Object.entries(kv)) {
                this.itemSets[itemSetKey] = itemSetProps;
                this.getCollectionImage(itemSetKey);
                for (const itemKey of Object.keys(itemSetProps.items)) {
                    this.itemSetItemKey[itemKey] = itemSetKey;
                }
            }
        }
    }

    parseWeapons() {
        warning("Parsing weapons...");
        for (const [itemIndex, itemProps] of Object.entries(this.items)) {
            if (itemProps.baseitem !== "1" || !itemProps.flexible_loadout_slot) {
                continue;
            }
            const matches = itemProps.flexible_loadout_slot.match(WEAPON_CATEGORY_RE);
            if (!matches) {
                continue;
            }
            const [, category] = matches;
            if (category === "equipment" && !WEAPON_SKIP_EXCEPTION.includes(itemProps.name)) {
                continue;
            }
            const prefab = this.getPrefab(itemProps.prefab);
            const name = this.requireTranslation(prefab.item_name);
            const teams = this.getTeams(prefab.used_by_classes);
            const id = this.itemIdentifierManager.get(`weapon_${teams.join("_")}_${itemIndex}`);

            this.addTranslation(id, "name", name, prefab.item_name);
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
        warning("Parsing melees...");
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
                log(`Translation not found for melee '${itemProps.item_name}'.`);
                continue;
            }
            const prefab = this.getPrefab(itemProps.prefab);
            const teams = this.getTeams(itemProps.used_by_classes);
            const id = this.itemIdentifierManager.get(`melee_${teams.join("_")}_${itemIndex}`);

            this.addTranslation(id, "name", name, itemProps.item_name);
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
        warning("Parsing gloves...");
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
            const id = this.itemIdentifierManager.get(`glove_${teams.join("_")}_${itemIndex}`);
            this.addTranslation(id, "name", name, itemProps.item_name);

            this.baseItems.push({
                base: true,
                className: itemProps.name,
                def: Number(itemIndex),
                free: itemProps.baseitem === "1" ? true : undefined,
                id,
                image:
                    itemProps.image_inventory !== undefined
                        ? this.getImage(id, itemProps.image_inventory)
                        : `/${itemProps.name}.png`,
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
        warning("Parsing skins...");
        for (const { icon_path: iconPath } of Object.values(
            this.itemsGameParsed.items_game.alternate_icons2.weapon_icons
        )) {
            if (!iconPath.match(/light$/)) {
                continue;
            }
            const paintKit = this.paintKits.find((paintKit) => iconPath.includes(`_${paintKit.className}_light`));
            if (!paintKit) {
                log(`Paint kit not found for icon path '${iconPath}'.`);
                continue;
            }
            const baseItem = this.baseItems.find(({ className }) =>
                iconPath.includes(`/${className}_${paintKit.className}`)
            );
            if (!baseItem) {
                log(`Base item not found for icon path '${iconPath}'.`);
                continue;
            }
            const itemKey = `[${paintKit.className}]${baseItem.className}`;
            const name = `${baseItem.name} | ${paintKit.name}`;
            const id = this.itemIdentifierManager.get(`paint_${baseItem.def}_${paintKit.index}`);
            const legacy = this.itemManager.get(id)?.legacy;

            this.addTranslation(id, "name", name, baseItem.nameToken, " | ", paintKit.nameToken);
            this.addCaseContent(itemKey, id);

            if (legacy) {
                push(this.lookupWeaponLegacy, baseItem.def!, paintKit.index);
            }

            const { collection, collectiondesc, collectionname } = this.getItemCollection(id, itemKey);

            this.generatedItems.set(id, {
                ...baseItem,
                base: undefined,
                collection,
                collectiondesc,
                collectionname,
                free: undefined,
                id,
                index: paintKit.index,
                image: this.getSkinImage(id, baseItem.className, paintKit.className),
                legacy,
                name,
                rarity: ["melee", "glove"].includes(baseItem.type)
                    ? this.getRarityColorHex([baseItem.rarity, paintKit.rarityColorHex])
                    : this.getRarityColorHex([itemKey, paintKit.rarityColorHex]),
                wearmax: paintKit.wearmax,
                wearmin: paintKit.wearmin
            });
        }
    }

    parseMusicKits() {
        warning("Parsing music kits...");
        for (const kv of this.itemsGameParsed.items_game.music_definitions) {
            for (const [musicIndex, musicProps] of Object.entries(kv)) {
                if (musicIndex === "2") {
                    // Skip duplicated CS:GO default music kit.
                    continue;
                }
                const itemKey = `[${musicProps.name}]musickit`;
                const name = this.requireTranslation(musicProps.loc_name);
                const id = this.itemIdentifierManager.get(`musickit_${musicIndex}`);

                this.addTranslation(id, "name", name, musicProps.loc_name);
                this.addCaseContent(itemKey, id);

                this.generatedItems.set(id, {
                    base: true,
                    free: FREE_MUSIC_KITS.includes(musicIndex) ? true : undefined,
                    id,
                    image: this.itemManager.get(id)?.image ?? this.getImage(id, musicProps.image_inventory),
                    index: Number(musicIndex),
                    name,
                    rarity: this.raritiesColorHex.rare,
                    type: "musickit"
                });
            }
        }
    }

    parseStickers() {
        warning("Parsing stickers...");
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
            let category: string | undefined = "";
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
                assert(category, `unable to find the short name for tournament '${stickerProps.tournament_event_id}'.`);
            }
            if (!category) {
                categoryToken = `#CSGO_crate_sticker_pack_${subfolder}_capsule`;
                category = this.findTranslation(categoryToken);
            }
            assert(category, `unable to define a category for '${stickerProps.item_name}'.`);
            const name = this.findTranslation(stickerProps.item_name);
            if (name === undefined) {
                log(`unable to find translation for '${stickerProps.item_name}'.`);
                continue;
            }
            const id = this.itemIdentifierManager.get(`sticker_${stickerIndex}`);
            const itemKey = `[${stickerProps.name}]sticker`;

            this.addTranslation(id, "name", name, stickerProps.item_name);
            if (categoryToken !== "") {
                this.addTranslation(id, "category", category, categoryToken);
            }
            this.addCaseContent(itemKey, id);

            this.generatedItems.set(id, {
                category,
                id,
                image:
                    this.itemManager.get(id)?.image ??
                    this.getImage(id, `econ/stickers/${stickerProps.sticker_material}`),
                index: Number(stickerIndex),
                name,
                rarity: this.getRarityColorHex([itemKey, `[${stickerProps.name}]sticker`, stickerProps.item_rarity]),
                type: "sticker"
            });
        }
    }

    parseGraffiti() {
        warning("Parsing graffiti...");
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
                log(`Translation not found for graffiti '${graffitiProps.item_name}'.`);
                continue;
            }
            if (tintGraffitiNames.includes(name)) {
                const graffitiName = this.findTranslation(graffitiProps.item_name);
                let addedToCaseContents = false;
                for (const { name: tintName, token: tintToken, id: tintId } of this.graffitiTints) {
                    const id = this.itemIdentifierManager.get(`spray_${graffitiIndex}_${tintId}`);
                    const name = `${graffitiName} (${tintName})`;
                    const image = this.itemManager.get(id)?.image ?? tintGraffitiImages[name];
                    if (!image) {
                        log(`Image not found for graffiti '${name}'.`);
                        continue;
                    }
                    const itemKey = `[${graffitiProps.name}]spray`;
                    this.addTranslation(id, "name", name, graffitiProps.item_name, " (", tintToken, ")");

                    this.generatedItems.set(id, {
                        id,
                        image,
                        index: Number(graffitiIndex),
                        name,
                        rarity: this.getRarityColorHex([graffitiProps.item_rarity]),
                        tint: tintId,
                        type: "graffiti"
                    });

                    if (!addedToCaseContents) {
                        this.addCaseContent(itemKey, id);
                        addedToCaseContents = true;
                    }
                }
            } else {
                const id = this.itemIdentifierManager.get(`spray_${graffitiIndex}`);
                const itemKey = `[${graffitiProps.name}]spray`;

                this.addTranslation(id, "name", name, graffitiProps.item_name);
                this.addCaseContent(itemKey, id);

                this.generatedItems.set(id, {
                    id,
                    image:
                        this.itemManager.get(id)?.image ??
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
        warning("Parsing patches...");
        for (const [patchIndex, patchProps] of Object.entries(this.stickerKits)) {
            if (patchProps.item_name.indexOf("#PatchKit") !== 0 && patchProps.patch_material === undefined) {
                continue;
            }
            const name = this.requireTranslation(patchProps.item_name);
            if (!name) {
                log(`Name not found for patch '${patchProps.item_name}'.`);
                continue;
            }
            const id = this.itemIdentifierManager.get(`patch_${patchIndex}`);
            const itemKey = `[${patchProps.name}]patch`;

            this.addTranslation(id, "name", name, patchProps.item_name);
            this.addCaseContent(itemKey, id);

            this.generatedItems.set(id, {
                id,
                image:
                    this.itemManager.get(id)?.image ?? this.getImage(id, `econ/patches/${patchProps.patch_material}`),
                index: Number(patchIndex),
                teams: [CS_TEAM_CT, CS_TEAM_T],
                name,
                rarity: this.getRarityColorHex([itemKey, `[${patchProps.name}]patch`, patchProps.item_rarity]),
                type: "patch"
            });
        }
    }

    parseAgents() {
        warning("Parsing agents...");
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
            const id = this.itemIdentifierManager.get(`agent_${teams.join("_")}_${itemIndex}`);
            const model = itemProps.model_player.replace("characters/models/", "").replace(".vmdl", "");

            this.addTranslation(id, "name", name, itemProps.item_name);
            this.lookupAgentModel[itemIndex] = model;

            this.generatedItems.set(id, {
                def: Number(itemIndex),
                id,
                image: this.itemManager.get(id)?.image ?? this.getImage(id, itemProps.image_inventory),
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
        warning("Parsing pins...");
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
            const id = this.itemIdentifierManager.get(`pin_${itemIndex}`);

            this.addTranslation(id, "name", name, itemProps.item_name);
            this.addCaseContent(itemProps.name, id);

            this.generatedItems.set(id, {
                altname: itemProps.name,
                def: Number(itemIndex),
                id,
                image: this.itemManager.get(id)?.image ?? this.getImage(id, itemProps.image_inventory),
                index: undefined,
                name,
                rarity: this.getRarityColorHex([itemProps.item_rarity, "ancient"]),
                teams: undefined,
                type: "pin"
            });
        }
    }

    parseTools() {
        warning("Parsing tools...");
        for (const [itemIndex, itemProps] of Object.entries(this.items)) {
            if (
                itemProps.item_name === undefined ||
                ((itemProps.image_inventory === undefined ||
                    !itemProps.image_inventory.includes("econ/tools/") ||
                    !itemProps.prefab.includes("csgo_tool")) &&
                    itemProps.prefab !== "recipe")
            ) {
                continue;
            }
            const name = this.requireTranslation(itemProps.item_name);
            const id = this.itemIdentifierManager.get(`tool_${itemIndex}`);
            const prefab = this.getPrefab(itemProps.prefab);
            const image = itemProps.image_inventory || prefab.image_inventory;
            assert(image, `Image not found for tool '${itemProps.name}'.`);
            this.addTranslation(id, "name", name, itemProps.item_name);
            this.addCaseContent(itemProps.name, id);

            this.generatedItems.set(id, {
                category: this.getContainerCategory(id, name, "tool"),
                def: Number(itemIndex),
                id,
                image: this.itemManager.get(id)?.image ?? this.getImage(id, image),
                index: undefined,
                name,
                rarity: this.getRarityColorHex(["common"]),
                teams: undefined,
                type: "tool"
            });
        }
    }

    parseCases() {
        warning("Parsing cases...");
        this.casesScraper.populate([...this.baseItems, ...this.generatedItems.values()]);
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
            let contentsType: CS_Item["type"] | undefined;
            const contents = [] as number[];
            const revolvingLootListKey = itemProps.attributes?.["set supply crate series"]?.value;
            assert(
                revolvingLootListKey || itemProps.loot_list_name,
                `Revolving loot list key not found for '${itemProps.name}'.`
            );
            const clientLootListKey =
                revolvingLootListKey !== undefined
                    ? this.revolvingLootList[revolvingLootListKey]
                    : itemProps.loot_list_name;
            if (!clientLootListKey) {
                log(`Client loot list key not found for '${itemProps.name}'.`);
                continue;
            }
            for (const itemKey of this.getClientLootListItems(clientLootListKey)) {
                const id = this.caseContents.get(itemKey);
                assert(id !== undefined, `Item '${itemKey}' not found.`);
                const item = this.generatedItems.get(id);
                assert(item !== undefined, `Item '${itemKey}' not found.`);
                if (item.tint !== undefined) {
                    assert(item.index, `Item '${id}' has no index.`);
                    for (const other of this.generatedItems.values()) {
                        if (other.tint !== undefined && other.index === item.index) {
                            contentsType = "graffiti";
                            contents.push(other.id);
                        }
                    }
                } else {
                    contentsType = this.generatedItems.get(id)?.type;
                    contents.push(id);
                }
            }
            if (contents.length === 0) {
                log(`No contents for case '${itemProps.name}'.`);
            }
            if (contents.length > 0) {
                const name = this.requireTranslation(itemProps.item_name);
                const id = this.itemIdentifierManager.get(`case_${itemIndex}`);
                const specials = this.casesScraper.getSpecials(name);
                this.addTranslation(id, "name", name, itemProps.item_name);

                if (!itemProps.associated_items) {
                    assert(
                        itemProps.prefab === "sticker_capsule" ||
                            itemProps.prefab === "weapon_case_souvenirpkg" ||
                            itemProps.tags?.StickerCapsule ||
                            itemProps.name.includes("crate_signature") ||
                            itemProps.name.includes("crate_pins") ||
                            itemProps.name.includes("crate_musickit") ||
                            itemProps.name.includes("crate_patch") ||
                            itemProps.name.includes("crate_sprays") ||
                            itemProps.name.includes("selfopeningitem") ||
                            itemProps.prefab.includes("selfopening"),
                        `Keys not found for case '${itemProps.name}'.`
                    );
                    itemProps.associated_items = {};
                }

                const keys = Object.keys(itemProps.associated_items).map((itemIndex) => {
                    if (keyItems.has(itemIndex)) {
                        return keyItems.get(itemIndex)!;
                    }
                    const itemProps = this.items[itemIndex];
                    const id = this.itemIdentifierManager.get(`key_${itemIndex}`);
                    if (!itemProps.item_name) {
                        log(`Name not found for key of index '${itemIndex}', fallback to #CSGO_base_crate_key.`);
                        itemProps.item_name = "#CSGO_base_crate_key";
                    }
                    assert(itemProps.image_inventory, `image_inventory not found for key of '${itemIndex}'.`);
                    const name = this.requireTranslation(itemProps.item_name);
                    this.addTranslation(id, "name", name, itemProps.item_name);
                    this.generatedItems.set(id, {
                        def: Number(itemIndex),
                        id,
                        image: this.itemManager.get(id)?.image ?? this.getImage(id, itemProps.image_inventory),
                        name,
                        rarity: this.raritiesColorHex.common,
                        teams: undefined,
                        type: "key"
                    });
                    keyItems.set(itemIndex, id);
                    return id;
                });

                const isMusicKitCase = name.includes("Music Kit");
                const containsStatTrak = name.includes("StatTrak");

                this.generatedItems.set(id, {
                    category: this.getContainerCategory(id, name, contentsType),
                    contents,
                    def: Number(itemIndex),
                    id,
                    image: this.itemManager.get(id)?.image ?? this.getImage(id, itemProps.image_inventory),
                    keys: keys.length > 0 ? keys : undefined,
                    name,
                    rarity: this.raritiesColorHex.common,
                    specials: this.itemManager.get(id)?.specials ?? specials,
                    specialsimage:
                        itemProps.image_unusual_item !== undefined
                            ? this.getSpecialsImage(id, itemProps.image_unusual_item)
                            : undefined,
                    stattrakonly: isMusicKitCase && containsStatTrak ? true : undefined,
                    stattrakless: isMusicKitCase && !containsStatTrak ? true : undefined,
                    teams: undefined,
                    type: "case"
                });
            }
        }
    }

    persist() {
        const items = [...this.baseItems, ...this.generatedItems.values()].map((item) => ({
            ...item,
            className: undefined,
            nameToken: undefined
        }));

        writeJson(LOOKUP_AGENT_MODEL_JSON_PATH, this.lookupAgentModel);
        warning(`Generated '${LOOKUP_AGENT_MODEL_JSON_PATH}'.`);

        writeJson(LOOKUP_WEAPON_MODEL_JSON_PATH, this.lookupWeaponModel);
        warning(`Generated '${LOOKUP_WEAPON_MODEL_JSON_PATH}'.`);

        writeJson(LOOKUP_WEAPON_LEGACY_JSON_PATH, this.lookupWeaponLegacy);
        warning(`Generated '${LOOKUP_WEAPON_LEGACY_JSON_PATH}'.`);

        writeJson(PARSED_ITEMS_GAME_JSON_PATH, this.itemsGameParsed);
        warning(`Generated '${PARSED_ITEMS_GAME_JSON_PATH}'.`);

        writeJson(ITEMS_JSON_PATH, items);
        warning(`Generated '${ITEMS_JSON_PATH}'.`);

        writeJson(ITEM_IDS_JSON_PATH, this.itemIdentifierManager.allIdentifiers);
        warning(`Generated '${ITEM_IDS_JSON_PATH}'.`);

        for (const [language, translations] of Object.entries(this.translations)) {
            const path = format(LANGUAGE_JSON_PATH, language);
            writeJson(path, translations);
            warning(`Generated '${path}'.`);
        }

        replaceInFile(ITEMS_TS_PATH, /CS_Item\[\] = [^;]+;/, `CS_Item[] = ${JSON.stringify(items)};`);
        warning(`Updated '${ITEMS_TS_PATH}'.`);
        warning("Script completed.");
    }

    addTranslation(id: number, field: string, englishName: string, ...keys: string[]) {
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
                        log(`Translation of '${key}' not found for language '${language}'.`);
                    }
                    return translation || this.requireTranslation(key);
                })
                .join("");

            if (translatedName !== englishName) {
                if (this.translations[language][id] === undefined) {
                    this.translations[language][id] = {};
                }
                this.translations[language][id][field] = translatedName;
            }
        }
    }

    requireTranslation(key: string, language = "english") {
        const translation = this.findTranslation(key, language);
        assert(translation, `Translation not found for '${key}', but it's required.`);
        return translation;
    }

    findTranslation(key: string, language = "english"): string | undefined {
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
            fail(`Unknown team '${team}'.`);
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
        if (HEAVY_WEAPONS.includes(name)) {
            return "heavy";
        }
        return category;
    }

    getPrefab(prefabKey: string) {
        const prefab = this.prefabs[prefabKey];
        assert(prefab, `Prefab not found for '${prefabKey}'`);
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
            log(
                `Rarity not found for the following keywords: ${keywords.map((keyword) => `'${keyword}'`).join(" ,")}.`
            );
        }
        if (!colorHex) {
            colorHex = this.raritiesColorHex.default;
        }
        return colorHex;
    }

    addCaseContent(itemKey: string, id: number) {
        assert(!this.caseContents.has(itemKey), `Duplicate found when adding '${itemKey}'.`);
        this.caseContents.set(itemKey, id);
    }

    getClientLootListItems(clientLootListKey: string, items: string[] = []) {
        if (!this.clientLootList[clientLootListKey]) {
            log(`Loot list not found for key '${clientLootListKey}'.`);
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

    getCollectionImage(name: string) {
        const src = resolve(CS2_IMAGES_PATH, `econ/set_icons/${name}_png.png`);
        const dest = resolve(process.cwd(), `assets/images/${name}.png`);
        copyFileSync(src, dest);
    }

    getItemCollection(id: number, itemKey: string) {
        const collection = this.itemSetItemKey[itemKey] as string | undefined;
        let collectionname: string | undefined;
        let collectiondesc: string | undefined;
        if (collection !== undefined) {
            const collectionProps = this.itemSets[collection];
            assert(collectionProps, `Collection '${collection}' not found.`);
            assert(collectionProps.name, `Collection name not found for '${collection}'.`);
            collectionname = this.requireTranslation(collectionProps.name);
            this.addTranslation(id, "collectionname", collectionname, collectionProps.name);
            if (collectionProps.set_description !== undefined) {
                collectiondesc = this.findTranslation(collectionProps.set_description) || undefined;
                if (collectiondesc) {
                    this.addTranslation(id, "collectiondesc", collectiondesc, collectionProps.set_description);
                }
            }
        }
        return {
            collection,
            collectiondesc,
            collectionname
        };
    }

    getContainerCategoryKey(name: string, type?: CS_Item["type"]) {
        if (name.includes("Souvenir")) {
            return "#Inv_Category_souvenircase";
        }
        if (type === undefined) {
            return undefined;
        }
        switch (type) {
            case "weapon":
                return "#Inv_Category_weaponcase";
            case "sticker":
                return "#Inv_Category_stickercapsule";
            case "graffiti":
                return "#Inv_Category_graffitibox";
            case "tool":
                return "#Inv_Category_tools";
            default:
                return undefined;
        }
    }

    getContainerCategory(id: number, name: string, type?: CS_Item["type"]) {
        const key = this.getContainerCategoryKey(name, type);
        if (key === undefined) {
            return undefined;
        }
        const category = this.requireTranslation(key);
        this.addTranslation(id, "category", category, key);
        return category;
    }
}

if (basename(process.argv[1]) === "item-generator.ts") {
    new ItemGenerator().run();
}
