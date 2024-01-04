/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from "crypto";
import { copyFileSync, existsSync, readFileSync, readdirSync } from "fs";
import { basename, resolve } from "path";
import {
    CS_DEFAULT_MAX_WEAR,
    CS_DEFAULT_MIN_WEAR,
    CS_Item,
    CS_SPECIAL_ITEM_IMAGE_CUSTOM,
    CS_SPECIAL_ITEM_IMAGE_DEFAULT
} from "../src/economy.js";
import { CS_parseValveKeyValue } from "../src/keyvalues.js";
import { CS_TEAM_CT, CS_TEAM_T } from "../src/teams.js";
import { CS2_IMAGES_PATH, IMAGES_PATH, ITEMS_PATH, LANGUAGE_PATH } from "./env.js";
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
} from "./generate-types.js";
import { CaseSpecialItems } from "./generate-case-special-items.js";
import { banner, readJson, readTxt, replaceInFile, writeJson, writeTxt } from "./util.js";

const lootItemRE = /^\[([^\]]+)\](.*)$/;
const econLocalImageSuffixes = ["heavy", "medium", "light"];
const uncategorizedStickers = [
    "standard",
    "stickers2",
    "community02",
    "tournament_assets",
    "community_mix01",
    "danger_zone"
];

const isHeavyWeapon = ["weapon_m249", "weapon_mag7", "weapon_negev", "weapon_nova", "weapon_sawedoff", "weapon_xm1014"];

export class GenerateScript {
    clientLootList: ClientLootListRecord = null!;
    graffitiTints: { name: string; token: string; id: number }[] = null!;
    ids: ReturnType<InstanceType<typeof GenerateScript>["readIdsJSON"]> = null!;
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

    baseItems: (CS_Item & {
        className?: string;
        nameToken: string;
    })[] = [];
    generatedItems: CS_Item[] = [];

    caseItems = new Map<string, number>();
    caseSpecialItems = new CaseSpecialItems();

    constructor() {}

    async run() {
        await this.caseSpecialItems.fetch();

        this.ids = this.readIdsJSON();
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

    readIdsJSON() {
        const path = resolve(process.cwd(), "dist/ids.json");
        const ids = (existsSync(path) ? JSON.parse(readFileSync(path, "utf-8")) : []) as string[];
        const uniqueIds = [] as string[];
        return {
            get(identifier: string) {
                if (uniqueIds.indexOf(identifier) > -1) {
                    throw new Error(`${identifier} is not unique.`);
                }
                uniqueIds.push(identifier);
                const index = ids.indexOf(identifier);
                if (index === -1) {
                    ids.push(identifier);
                    return ids.length - 1;
                }
                return index;
            },

            getAll() {
                return ids;
            }
        };
    }

    readCsgoLanguageTXT() {
        const languages = {} as LanguagesRecord;
        const translations = {} as LanguagesRecord;
        const files = readdirSync(LANGUAGE_PATH);
        const fileRE = /csgo_([^\._]+)\.txt$/;
        for (const file of files) {
            const matches = file.match(fileRE);
            if (!matches) {
                continue;
            }
            const [, language] = matches;
            const contents = readFileSync(resolve(LANGUAGE_PATH, file), "utf-8");
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
        console.warn(`loaded the following languages: ${Object.keys(languages)}.`);
    }

    readItemsGameTXT() {
        const contents = readFileSync(ITEMS_PATH, "utf-8");
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
                            itemOrClientLootListKey.match(lootItemRE)
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
                const name = this.findTranslation(paintKitProps.description_tag);
                if (!name) {
                    console.log(`unable to find translation for paint ${paintKitProps.description_tag}.`);
                    continue;
                }
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
        const categoryRE = /(c4|[^\d]+)/;
        for (const [itemIndex, itemProps] of Object.entries(this.items)) {
            if (itemProps.baseitem !== "1" || !itemProps.flexible_loadout_slot) {
                continue;
            }
            const matches = itemProps.flexible_loadout_slot.match(categoryRE);
            if (!matches) {
                continue;
            }
            const [, category] = matches;
            if (category === "equipment") {
                continue;
            }
            const prefab = this.getPrefab(itemProps.prefab);
            const name = this.requireTranslation(prefab.item_name);
            const teams = this.getTeams(prefab.used_by_classes);
            const id = this.ids.get(`weapon_${teams.join("_")}_${itemIndex}`);
            this.addTranslation(id, name, prefab.item_name);

            this.baseItems.push({
                base: true,
                category: isHeavyWeapon.includes(itemProps.name) ? "heavy" : category,
                className: itemProps.name,
                def: Number(itemIndex),
                free: true,
                id,
                image: prefab.image_inventory
                    ? this.getCDNUrl(prefab.image_inventory, `${id}`)
                    : this.getCDNUrl(`econ/weapons/base_weapons/${itemProps.name}`, `${id}`),
                index: undefined,
                localimage: this.getBaseLocalImage(id, itemProps.name),
                model: itemProps.name.replace("weapon_", ""),
                name,
                nameToken: prefab.item_name,
                rarity: this.raritiesColorHex.default,
                teams,
                type: "weapon"
            });
        }
        console.warn("parsed weapons.");
    }

    parseMelees() {
        console.warn("parsing melees...");
        for (const [itemIndex, itemProps] of Object.entries(this.items)) {
            if (
                itemProps.item_name === undefined ||
                (itemProps.prefab === "melee" && itemProps.baseitem !== "1") ||
                itemProps.prefab?.indexOf("melee") === -1 ||
                itemProps.prefab?.indexOf("noncustomizable") > -1 ||
                !itemProps.used_by_classes
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

            this.baseItems.push({
                base: true,
                className: itemProps.name,
                def: Number(itemIndex),
                free: itemProps.baseitem === "1" ? true : undefined,
                id,
                image: this.getCDNUrl(itemProps.image_inventory, `${id}`),
                index: itemProps.baseitem === "1" ? undefined : 0,
                localimage: this.getBaseLocalImage(id, itemProps.name),
                model: itemProps.name.replace("weapon_", ""),
                name,
                nameToken: itemProps.item_name,
                rarity: this.getRarityColorHex([prefab.item_rarity], this.raritiesColorHex.default),
                teams,
                type: "melee"
            });
        }
        console.warn("parsed melees.");
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
                image: itemProps.image_inventory
                    ? this.getCDNUrl(itemProps.image_inventory, `${id}`)
                    : `/${itemProps.name}.png`,
                index: itemProps.baseitem === "1" ? undefined : 0,
                localimage: this.getBaseLocalImage(id, itemProps.name),
                model: itemProps.name,
                name,
                nameToken: itemProps.item_name,
                rarity:
                    itemProps.baseitem === "1" ? this.raritiesColorHex.default : this.getRarityColorHex(["ancient"]),
                teams,
                type: "glove"
            });
        }
        console.warn("parsed gloves.");
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
            this.addTranslation(id, name, parentItem.nameToken, " | ", paintKit.nameToken);

            this.generatedItems.push({
                ...parentItem,
                base: undefined,
                free: undefined,
                id,
                index: paintKit.index,
                image: this.getCDNUrl(`${iconPath}_large`, `${id}`),
                localimage: this.getEconLocalImage(id, parentItem.className, paintKit.className),
                name,
                rarity: ["melee", "glove"].includes(parentItem.type)
                    ? this.getRarityColorHex([parentItem.rarity, paintKit.rarityColorHex])
                    : this.getRarityColorHex([itemKey, paintKit.rarityColorHex]),
                wearmax: paintKit.wearmax,
                wearmin: paintKit.wearmin
            });

            this.addCaseItem(itemKey, id);
        }
        console.warn("parsed skins.");
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

                this.generatedItems.push({
                    base: true,
                    free: ["1", "70"].includes(musicIndex) ? true : undefined,
                    id,
                    image: this.getCDNUrl(musicProps.image_inventory, `${id}`),
                    index: Number(musicIndex),
                    name,
                    rarity: this.raritiesColorHex.rare,
                    type: "musickit"
                });

                this.addCaseItem(itemKey, id);
            }
        }
        console.warn("parsed music kits.");
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
            const [folder] = stickerProps.sticker_material.split("/");
            if (folder === "alyx") {
                category = this.findTranslation("#CSGO_crate_sticker_pack_hlalyx_capsule");
            }
            if (uncategorizedStickers.indexOf(folder) > -1) {
                category = "Valve";
            }
            if (!category) {
                category = this.findTranslation(`#CSGO_sticker_crate_key_${folder}`);
            }
            if (!category) {
                category = this.findTranslation(`#CSGO_crate_sticker_pack_${folder}`);
            }
            if (!category) {
                category = this.findTranslation(`#CSGO_crate_sticker_pack_${folder}_capsule`);
            }
            if (stickerProps.tournament_event_id) {
                category = this.findTranslation(`#CSGO_Tournament_Event_NameShort_${stickerProps.tournament_event_id}`);
                if (!category) {
                    throw new Error(
                        `unable to find the short name for tournament ${stickerProps.tournament_event_id}.`
                    );
                }
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

            this.generatedItems.push({
                category,
                id,
                image: this.getCDNUrl(`econ/stickers/${stickerProps.sticker_material}_large`, `${id}`),
                index: Number(stickerIndex),
                name,
                rarity: this.getRarityColorHex([itemKey, `[${stickerProps.name}]sticker`, stickerProps.item_rarity]),
                type: "sticker"
            });

            this.addCaseItem(itemKey, id);
        }
        console.warn("parsed stickers.");
    }

    parseGraffiti() {
        console.warn("parse graffiti...");
        const defaultGraffiti = readTxt("dist/dump-default-graffiti.txt").split("\n");
        const defaultGraffitiCdn = readJson<Record<string, string>>("dist/dump-default-graffiti-cdn.json");
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
            if (defaultGraffiti.includes(name)) {
                const graffitiName = this.findTranslation(graffitiProps.item_name);
                let addedToCaseItem = false;
                for (const { name: tintName, token: tintToken, id: tintId } of this.graffitiTints) {
                    const name = `${graffitiName} (${tintName})`;
                    const image = defaultGraffitiCdn[name];
                    if (!image) {
                        console.log(`unable to find image for ${name}.`);
                        continue;
                    }
                    const id = this.ids.get(`spray_${graffitiIndex}_${tintId}`);
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
                        this.addCaseItem(itemKey, id);
                        addedToCaseItem = true;
                    }
                }
            } else {
                const id = this.ids.get(`spray_${graffitiIndex}`);
                const itemKey = `[${graffitiProps.name}]spray`;
                this.addTranslation(id, name, graffitiProps.item_name);

                this.generatedItems.push({
                    id,
                    image: this.getCDNUrl(`econ/stickers/${graffitiProps.sticker_material}_large`, `${id}`),
                    index: Number(graffitiIndex),
                    name,
                    rarity: this.getRarityColorHex([
                        itemKey,
                        `[${graffitiProps.name}]spray`,
                        graffitiProps.item_rarity
                    ]),
                    type: "graffiti"
                });

                this.addCaseItem(itemKey, id);
            }
        }
        console.warn("parsed graffiti.");
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

            this.generatedItems.push({
                id,
                image: this.getCDNUrl(`econ/patches/${patchProps.patch_material}_large`, `${id}`),
                index: Number(patchIndex),
                teams: [CS_TEAM_CT, CS_TEAM_T],
                name,
                rarity: this.getRarityColorHex([itemKey, `[${patchProps.name}]patch`, patchProps.item_rarity]),
                type: "patch"
            });

            this.addCaseItem(itemKey, id);
        }
        console.warn("parsed patches.");
    }

    parseAgents() {
        console.warn("parsing agents...");
        for (const [itemIndex, itemProps] of Object.entries(this.items)) {
            if (itemProps.item_name === undefined || itemProps.prefab !== "customplayertradable") {
                continue;
            }
            const name = this.requireTranslation(itemProps.item_name);
            const teams = this.getTeams(itemProps.used_by_classes);
            const id = this.ids.get(`agent_${teams.join("_")}_${itemIndex}`);
            this.addTranslation(id, name, itemProps.item_name);

            this.generatedItems.push({
                def: Number(itemIndex),
                id,
                image: this.getCDNUrl(itemProps.image_inventory, `${id}`),
                index: undefined,
                name,
                rarity: this.getRarityColorHex([itemProps.name, itemProps.item_rarity]),
                teams,
                type: "agent"
            });
        }
        console.warn("parsed agents.");
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

            this.generatedItems.push({
                altname: itemProps.name,
                def: Number(itemIndex),
                id,
                image: this.getCDNUrl(itemProps.image_inventory, `${id}`),
                index: undefined,
                name,
                rarity: this.getRarityColorHex([itemProps.item_rarity, "ancient"]),
                teams: undefined,
                type: "pin"
            });

            this.addCaseItem(itemProps.name, id);
        }
        console.warn("parsed pins.");
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

            this.generatedItems.push({
                def: Number(itemIndex),
                id,
                image: this.getCDNUrl(itemProps.image_inventory, `${id}`),
                index: undefined,
                name,
                rarity: this.getRarityColorHex(["common"]),
                teams: undefined,
                type: "tool"
            });

            this.addCaseItem(itemProps.name, id);
        }
        console.warn("parsed tools.");
    }

    parseCases() {
        console.warn("parsing cases...");
        this.caseSpecialItems.populate(this.baseItems, this.generatedItems);
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
                if (!this.caseItems.has(itemKey)) {
                    throw new Error(`item ${itemKey} not found.`);
                }
                contents.push(this.caseItems.get(itemKey)!);
            }
            if (contents.length === 0) {
                console.log(`no items found for ${itemProps.name}.`);
            }
            if (contents.length > 0) {
                const name = this.requireTranslation(itemProps.item_name);
                const id = this.ids.get(`case_${itemIndex}`);
                const specialcontents = this.caseSpecialItems.get(name);
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
                    const name = this.requireTranslation(itemProps.item_name);
                    this.addTranslation(id, name, itemProps.item_name);
                    this.generatedItems.push({
                        def: Number(itemIndex),
                        id,
                        image: this.getCDNUrl(itemProps.image_inventory, `${id}`),
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
                    image: this.getCDNUrl(itemProps.image_inventory, `${id}`),
                    keys: keys.length > 0 ? keys : undefined,
                    name,
                    rarity: this.raritiesColorHex.common,
                    specialcontents,
                    specialimage:
                        itemProps.image_unusual_item !== undefined
                            ? this.getCaseSpecialItemImage(id, itemProps.image_unusual_item)
                            : specialcontents !== undefined && specialcontents?.length > 0
                              ? CS_SPECIAL_ITEM_IMAGE_DEFAULT
                              : undefined,
                    teams: undefined,
                    type: "case"
                });
            }
        }
        console.warn("parsed cases.");
    }

    persist() {
        const items = [...this.baseItems, ...this.generatedItems]
            .sort((a, b) => {
                const aTop = a.base || a.free;
                const bTop = b.base || b.free;
                if (aTop && !bTop) {
                    return -1;
                }
                if (!aTop && bTop) {
                    return 1;
                }
                if (aTop && bTop) {
                    if (a.free && !b.free) {
                        return -1;
                    }
                    if (!a.free && b.free) {
                        return 1;
                    }
                }
                if (a.name < b.name) {
                    return -1;
                }
                if (a.name > b.name) {
                    return 1;
                }
                return 0;
            })
            .map((item) => ({
                ...item,
                className: undefined,
                nameToken: undefined
            }));

        writeJson("dist/parsed-items-game.json", this.itemsGameParsed);
        console.warn("generated dist/parsed-items-game.json.");
        writeJson("dist/items.json", items);
        console.warn("generated dist/items.json.");
        writeJson("dist/ids.json", this.ids.getAll());
        console.warn("generated dist/ids.json.");

        for (const [language, translations] of Object.entries(this.translations)) {
            writeJson(`dist/items-${language}.json`, translations);
            console.warn(`generated dist/items-${language}.json.`);
            writeTxt(
                `src/translations/${language}.ts`,
                `${banner}\n\nexport const CS_${language}: Record<string, string> = ${JSON.stringify(translations)};`
            );
            console.warn(`updated src/translations/${language}.ts.`);
        }
        const languages = Object.keys(this.translations);

        writeTxt(
            `src/translations/index.ts`,
            `${banner}\n\n${languages
                .map(
                    (language) =>
                        `import { CS_${language} as ${language} } from "./${language}.js";\nexport * from "./${language}.js";\n`
                )
                .join("")}\nexport const CS_ITEM_TRANSLATION = { ${languages.join(", ")} };`
        );
        console.warn("updated src/translations/index.ts.");

        replaceInFile("src/items.ts", /CS_Item\[\] = [^;]+;/, `CS_Item[] = ${JSON.stringify(items)};`);
        console.warn("updated src/items.ts.");
        console.warn("script completed.");
    }

    addTranslation(id: number, englishName: string, ...keys: string[]) {
        for (const [language, tokens] of Object.entries(this.languages)) {
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

    getCDNUrl(file: string, fileid: string) {
        const cs2ImagePath = resolve(CS2_IMAGES_PATH, file + "_png.png");
        const csgoSha1 = this.getFileSha1(resolve(IMAGES_PATH, file + ".png"));
        const cs2Sha1 = this.getFileSha1(cs2ImagePath);
        if (csgoSha1 === undefined && cs2Sha1 === undefined) {
            throw new Error(`unable to get cdn for file ${file}.`);
        }
        const sha1 = csgoSha1 !== undefined && csgoSha1 !== cs2Sha1 ? csgoSha1 : cs2Sha1;
        if (!sha1) {
            throw new Error(`unable to get sha1 for file ${file}.`);
        }
        // CS2's CDN is not working for some items, we're going to depend on Statically.
        if (csgoSha1 === undefined) {
            const destPath = resolve(process.cwd(), `dist/images/${fileid}.png`);
            copyFileSync(cs2ImagePath, destPath);
            return `https://cdn.statically.io/gh/ianlucas/cslib/main/dist/images/${fileid}.png`;
        }
        return `https://steamcdn-a.akamaihd.net/apps/730/icons/${file.toLowerCase()}.${sha1}.png`;
    }

    getBaseLocalImage(id: number, className: string) {
        const imagePath = resolve(CS2_IMAGES_PATH, `econ/weapons/base_weapons/${className}_png.png`);
        const destPath = resolve(process.cwd(), `dist/images/${id}.png`);
        if (existsSync(destPath)) {
            return true;
        }
        if (existsSync(imagePath)) {
            copyFileSync(imagePath, destPath);
            return true;
        }
        return undefined;
    }

    getEconLocalImage(id: number, className: string | undefined, paintClassName: string | undefined) {
        if (!className || !paintClassName) {
            return undefined;
        }
        return (
            econLocalImageSuffixes
                .filter((suffix) => {
                    const src = resolve(
                        CS2_IMAGES_PATH,
                        `econ/default_generated/${className}_${paintClassName}_${suffix}_png.png`
                    );
                    const dest = resolve(process.cwd(), `dist/images/${id}_${suffix}.png`);
                    if (existsSync(src)) {
                        copyFileSync(src, dest);
                        return true;
                    }
                    return false;
                })
                .map((suffix, index, found) => {
                    // I'm confident this logic will never be executed, but
                    // let's keep it here.
                    if (found.length < econLocalImageSuffixes.length && index === found.length - 1) {
                        console.log(`missing local image for id ${id}.`);
                        const src = resolve(process.cwd(), `dist/images/${id}_${suffix}.png`);
                        for (const otherSuffix of econLocalImageSuffixes) {
                            if (!found.includes(otherSuffix)) {
                                const dest = resolve(process.cwd(), `dist/images/${id}_${otherSuffix}.png`);
                                if (existsSync(src)) {
                                    copyFileSync(src, dest);
                                    console.log(`had to copy ${suffix} to ${otherSuffix} for id ${id}.`);
                                }
                            }
                        }
                    }
                    return suffix;
                }).length > 0 || undefined
        );
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

    addCaseItem(itemKey: string, id: number) {
        if (this.caseItems.has(itemKey)) {
            throw new Error(`duplicate found for ${itemKey}.`);
        }
        this.caseItems.set(itemKey, id);
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
            if (!this.caseItems.has(itemOrClientLootListKey)) {
                // If we did not find, that means that it's probably a reference
                // to another loot list...
                this.getClientLootListItems(itemOrClientLootListKey, items);
            } else {
                items.push(itemOrClientLootListKey);
            }
        }
        return items;
    }

    getCaseSpecialItemImage(id: number, path: string) {
        const src = resolve(CS2_IMAGES_PATH, `${path}_png.png`);
        const dest = resolve(process.cwd(), `dist/images/${id}_rare.png`);
        if (existsSync(src)) {
            copyFileSync(src, dest);
            return CS_SPECIAL_ITEM_IMAGE_CUSTOM;
        }
        return undefined;
    }
}

if (basename(process.argv[1]) === "generate.ts") {
    new GenerateScript().run();
}
