/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from "crypto";
import { copyFileSync, existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { format } from "util";
import {
    CS_DEFAULT_GENERATED_HEAVY,
    CS_DEFAULT_GENERATED_LIGHT,
    CS_DEFAULT_GENERATED_MEDIUM,
    CS_Item
} from "../src/economy.js";
import * as KeyValues from "../src/keyvalues.js";
import { CS_TEAM_CT, CS_TEAM_T, CS_Team } from "../src/teams.js";
import {
    CS2_IMAGES_PATH,
    IMAGES_PATH,
    ITEMS_PATH,
    LANGUAGE_PATH
} from "./env.js";
import { replaceInFile, writeJson } from "./util.js";
import fetch from "node-fetch";

interface CS_ItemDefinition {
    def?: number;
    id: number;
    itemid?: number;
}

interface CSGO_Prefab {
    prefab: string;
    item_class: string;
    item_name: string;
    item_rarity: string;
    image_inventory: string;
    used_by_classes: Record<CS_Team, number>;
    visuals: {
        weapon_type: string;
    };
}

interface CSGO_ItemsFile {
    items_game: {
        alternate_icons2: {
            weapon_icons: {
                [key: string]: {
                    icon_path: string;
                };
            };
        };
        item_sets: {
            [setName: string]: {
                items: {
                    [itemId: string]: string;
                };
            };
        }[];
        client_loot_lists: {
            [setName: string]: {
                [itemName: string]: string;
            };
        }[];
        colors: {
            [key: string]: {
                hex_color: string;
            };
        };
        items: {
            [itemDef: string]: {
                attributes?: {
                    ["set supply crate series"]?: {
                        attribute_class?: string;
                        value?: string;
                    };
                };
                baseitem: string;
                image_inventory: string;
                image_unusual_item?: string;
                item_name: string;
                item_rarity: string;
                item_sub_position?: string;
                name: string;
                prefab: string;
                used_by_classes: Record<CS_Team, number>;
                tool?: {
                    type?: string;
                    use_string?: string;
                };

                tags?: {
                    ItemSet?: {
                        tag_value?: string;
                    };
                };
            };
        }[];
        music_definitions: {
            [musicId: string]: {
                name: string;
                loc_name: string;
                image_inventory: string;
            };
        }[];
        paint_kits: {
            [identifier: string]: {
                description_tag: string;
                name: string;
            };
        }[];
        paint_kits_rarity: {
            [paintName: string]: string;
        }[];
        prefabs: {
            [prefabName: string]: CSGO_Prefab;
        }[];
        rarities: {
            [key: string]: {
                color: string;
            };
        };
        revolving_loot_lists: {
            [resolveId: string]: string;
        }[];
        sticker_kits: {
            [stickerId: string]: {
                name: string;
                item_name: string;
                tournament_event_id: string;
                sticker_material: string;
                item_rarity: string;
                patch_material?: string;
            };
        }[];
    };
}

interface CSGO_LanguageFile {
    lang: {
        Tokens: { [key: string]: string };
    };
}

const UNCATEGORIZED_STICKERS = [
    "standard",
    "stickers2",
    "community02",
    "tournament_assets",
    "community_mix01",
    "danger_zone"
];

const itemRE = /^\[([^\]]+)\](.*)$/;

class GenerateScript {
    language: string;
    itemsFile: CSGO_ItemsFile;
    languageFile: Record<string, string>;
    prefabs: { [prefabName: string]: CSGO_Prefab } = {};
    items: CS_Item[] = [];
    paints: CS_Item[] = [];
    musicKits: CS_Item[] = [];
    stickers: CS_Item[] = [];
    itemDefs: (CS_ItemDefinition & {
        className?: string;
    })[] = [];
    itemRarities: { [itemName: string]: string } = {};
    paintKitRarity: { [paintName: string]: string } = {};
    paintKits: {
        className: string;
        value: number;
        name: string;
        rarity: string;
    }[] = [];
    ids: string[] = [];
    uniqueIds: string[] = [];
    itemImages: Record<string, string[]>;
    caseContents: Record<string, number> = {};
    caseRareItem: Record<string, number> = {};

    constructor({ language }: { language?: string }) {
        this.language = language ?? "english";
        this.itemsFile = this.readItems();
        this.languageFile = this.readLanguage();
        this.ids = this.readIds();
        this.itemImages = this.readItemImages();
        this.run();
    }

    async run() {
        this.parsePrefabs();
        this.parseWeapons();
        this.parseMelees();
        this.parseGloves();
        this.parseRarity();
        this.parsePaintKits();
        this.parsePaints();
        this.parseMusicKits();
        this.parseStickers();
        this.parsePatches();
        this.parseAgents();
        this.parsePins();
        await this.parseCases();
        this.writeFiles();
    }

    match(haystack: string, needles: string[], separator: string = "") {
        for (const needle of needles) {
            if (haystack.indexOf(`${separator}${needle}`) > -1) {
                return needle;
            }
        }
        return undefined;
    }

    readIds() {
        const contents = readFileSync(
            resolve(process.cwd(), "dist/ids.json"),
            "utf-8"
        );
        return JSON.parse(contents) as string[];
    }

    readItemImages() {
        const contents = readFileSync(
            resolve(process.cwd(), "dist/item-images.json"),
            "utf-8"
        );
        return JSON.parse(contents) as Record<string, string[]>;
    }

    readItems() {
        const contents = readFileSync(ITEMS_PATH, "utf-8");
        return KeyValues.parse(contents) as CSGO_ItemsFile;
    }

    readLanguage() {
        const contents = readFileSync(
            format(LANGUAGE_PATH, this.language),
            "utf16le" // "utf16le" on CSGO
        );
        const parsed = KeyValues.parse(contents) as CSGO_LanguageFile;
        const strings: Record<string, string> = {};
        for (const key of Object.keys(parsed.lang.Tokens)) {
            const lowerCaseKey = key.toLowerCase();
            if (strings[lowerCaseKey] !== undefined) {
                throw new Error(
                    format(
                        "Duplicate key for %s on language file.",
                        lowerCaseKey
                    )
                );
            }
            strings[lowerCaseKey] = parsed.lang.Tokens[key];
        }
        return strings;
    }

    getTranslation(token: string) {
        return this.languageFile[token.substring(1).toLowerCase()];
    }

    getCdnUrl(file: string) {
        const buffer = readFileSync(resolve(IMAGES_PATH, file + ".png"));
        const hashSum = createHash("sha1");
        hashSum.update(buffer);
        const sha1 = hashSum.digest("hex");
        return format(
            "https://steamcdn-a.akamaihd.net/apps/730/icons/%s.%s.png",
            file.toLowerCase(),
            sha1
        );
    }

    getCS_Team(team: string) {
        switch (team) {
            case "counter-terrorists":
                return CS_TEAM_CT;
            case "terrorists":
                return CS_TEAM_T;
        }
        throw new Error(format('Unknown team "%s"', team));
    }

    getTeamDesc(teams: CS_Team[]) {
        return teams.join("_");
    }

    getId(name: string) {
        if (this.uniqueIds.indexOf(name) !== -1) {
            throw new Error(`${name} is NOT unique.`);
        }
        this.uniqueIds.push(name);
        const idx = this.ids.indexOf(name);
        if (idx === -1) {
            this.ids.push(name);
            return this.ids.length - 1;
        }
        return idx;
    }

    parsePrefabs() {
        for (const item of this.itemsFile.items_game.prefabs) {
            for (const [key, value] of Object.entries(item)) {
                this.prefabs[key] = value;
            }
        }
    }

    getRarityColor(rarity?: string, fallback = "#ffffff") {
        if (!rarity) {
            return fallback;
        }
        if (rarity.charAt(0) === "#") {
            return rarity;
        }
        const rarirtyColor = this.itemsFile.items_game.rarities[rarity]?.color;
        if (rarirtyColor) {
            const colorHex =
                this.itemsFile.items_game.colors[rarirtyColor]?.hex_color;
            if (colorHex) {
                return colorHex;
            }
        }
        return fallback;
    }

    getItemRarityColor(
        itemNames: string[],
        className: string,
        defaultTo?: string
    ) {
        let rarity = "";
        for (const itemName of itemNames) {
            rarity = this.itemRarities[`${itemName}:${className}`];
            if (rarity !== undefined) {
                break;
            }
        }
        if (!rarity && !defaultTo) {
            console.warn(
                "Unable to find rarity for %s and %s",
                itemNames.join(","),
                className
            );
        }
        return this.getRarityColor(rarity || defaultTo);
    }

    parseWeapons() {
        for (const item of this.itemsFile.items_game.items) {
            for (const [itemDef, value] of Object.entries(item)) {
                if (value.baseitem !== "1" || !value.item_sub_position) {
                    continue;
                }
                const matches = value.item_sub_position.match(/(c4|[^\d]+)/);
                if (!matches) {
                    continue;
                }
                const category = matches[1];
                if (category === "equipment") {
                    continue;
                }
                const prefab = this.prefabs[value.prefab];
                if (!prefab) {
                    throw new Error(
                        format('Unable to find prefab for "%s".', value.prefab)
                    );
                }
                const name = this.getTranslation(prefab.item_name);
                const teams = Object.keys(prefab.used_by_classes).map(
                    this.getCS_Team
                );
                const id = this.getId(
                    `weapon_${this.getTeamDesc(teams)}_${itemDef}`
                );
                this.items.push({
                    base: true,
                    category,
                    def: Number(itemDef),
                    free: true,
                    id,
                    image: prefab.image_inventory
                        ? this.getCdnUrl(prefab.image_inventory)
                        : this.getCdnUrl(
                              format("econ/weapons/base_weapons/%s", value.name)
                          ),
                    itemid: undefined,
                    localimage: this.getBaseLocalImage(value.name, id),
                    model: value.name.replace("weapon_", ""),
                    name,
                    rarity: "#ffffff",
                    teams,
                    type: "weapon"
                });
                this.itemDefs.push({
                    className: value.name,
                    def: Number(itemDef),
                    id,
                    itemid: undefined
                });
            }
        }
    }

    parseMelees() {
        for (const item of this.itemsFile.items_game.items) {
            for (const [itemDef, value] of Object.entries(item)) {
                if (
                    (value.prefab === "melee" && value.baseitem !== "1") ||
                    value.prefab?.indexOf("melee") === -1 ||
                    value.prefab?.indexOf("noncustomizable") > -1 ||
                    !value.used_by_classes
                ) {
                    continue;
                }
                const prefab = this.prefabs[value.prefab];
                if (!prefab) {
                    throw new Error(
                        format("Unable to find prefab for %s", value.prefab)
                    );
                }
                const name = this.getTranslation(value.item_name);
                const teams = Object.keys(value.used_by_classes).map(
                    this.getCS_Team
                );
                const id = this.getId(
                    `melee_${this.getTeamDesc(teams)}_${itemDef}`
                );
                this.items.push({
                    base: true,
                    category: "melee",
                    def: Number(itemDef),
                    free: value.baseitem === "1" ? true : undefined,
                    id,
                    image: this.getCdnUrl(value.image_inventory),
                    itemid: value.baseitem === "1" ? undefined : 0,
                    localimage: this.getBaseLocalImage(value.name, id),
                    model: value.name.replace("weapon_", ""),
                    name,
                    rarity: this.getRarityColor(prefab.item_rarity),
                    teams,
                    type: "melee"
                });
                this.itemDefs.push({
                    className: value.name,
                    def: Number(itemDef),
                    id,
                    itemid: value.baseitem === "1" ? undefined : 0
                });
                this.caseRareItem[`${name} vanilla`.toLowerCase()] = id;
            }
        }
    }

    parseGloves() {
        for (const item of this.itemsFile.items_game.items) {
            for (const [itemDef, value] of Object.entries(item)) {
                if (
                    value.prefab?.indexOf("hands") === -1 ||
                    !value.used_by_classes
                ) {
                    continue;
                }
                const prefab = this.prefabs[value.prefab];
                if (!prefab) {
                    throw new Error(
                        format("Unable to find prefab for %s", value.prefab)
                    );
                }
                const name = this.getTranslation(value.item_name);
                const teams = Object.keys(value.used_by_classes).map(
                    this.getCS_Team
                );
                const id = this.getId(
                    `glove_${this.getTeamDesc(teams)}_${itemDef}`
                );
                this.items.push({
                    base: true,
                    category: "glove",
                    def: Number(itemDef),
                    free: value.baseitem === "1" ? true : undefined,
                    id,
                    image: value.image_inventory
                        ? this.getCdnUrl(value.image_inventory)
                        : format("/%s.png", value.name),
                    itemid: value.baseitem === "1" ? undefined : 0,
                    model: value.name,
                    name,
                    rarity:
                        value.baseitem === "1"
                            ? "#ffffff"
                            : this.getRarityColor("ancient"),
                    teams,
                    type: "glove"
                });
                this.itemDefs.push({
                    className: value.name,
                    def: Number(itemDef),
                    id,
                    itemid: value.baseitem === "1" ? undefined : 0
                });
            }
        }
    }

    parseRarity() {
        const rarities = Object.keys(this.itemsFile.items_game.rarities);
        for (const item of this.itemsFile.items_game.paint_kits_rarity) {
            for (const [paintName, rarity] of Object.entries(item)) {
                this.paintKitRarity[paintName] = rarity;
            }
        }
        for (const sets of this.itemsFile.items_game.client_loot_lists) {
            for (const [setName, items] of Object.entries(sets)) {
                const rarity = this.match(setName, rarities, "_");
                if (rarity) {
                    for (const [itemName, value] of Object.entries(items)) {
                        if (itemName.indexOf("customplayer_") === 0) {
                            this.itemRarities[`${itemName}:agent`] = rarity;
                        }
                        const matches = itemName.match(itemRE);
                        if (!matches) {
                            continue;
                        }
                        this.itemRarities[`${matches[1]}:${matches[2]}`] =
                            rarity;
                    }
                }
            }
        }
    }

    parsePaintKits() {
        for (const item of this.itemsFile.items_game.paint_kits) {
            for (const [paintKit, value] of Object.entries(item)) {
                if (!value.description_tag || value.name === "default") {
                    continue;
                }
                const name = this.getTranslation(value.description_tag);
                if (name === undefined) {
                    console.log(value);
                    throw new Error("Unable to name an item.");
                }
                this.paintKits.push({
                    className: value.name,
                    name,
                    rarity: this.getRarityColor(
                        this.paintKitRarity[value.name]
                    ),
                    value: Number(paintKit)
                });
            }
        }
    }

    parsePaints() {
        for (const [key, value] of Object.entries(
            this.itemsFile.items_game.alternate_icons2.weapon_icons
        )) {
            if (!value.icon_path.match(/light$/)) {
                continue;
            }
            const paintKit = this.paintKits.find(
                (paintKit) =>
                    value.icon_path.indexOf(
                        format("_%s_light", paintKit.className)
                    ) > -1
            );
            if (!paintKit) {
                console.warn(
                    format("Unable to find paint kit for %s", value.icon_path)
                );
                continue;
            }
            const def = this.itemDefs.find(
                (item) =>
                    value.icon_path.indexOf(
                        format("/%s_%s", item.className, paintKit.className)
                    ) > -1
            );
            if (!def) {
                console.warn(
                    format("Unable to find item for %s", value.icon_path)
                );
                continue;
            }
            const item = this.items.find((item) => item.id === def.id);
            if (!item) {
                console.warn(
                    format("Unable to find item for %s", value.icon_path)
                );
                continue;
            }
            const name = format("%s | %s", item.name, paintKit.name);
            const id = this.getId(`paint_${def.def}_${paintKit.value}`);
            this.paints.push({
                ...item,
                base: undefined,
                free: undefined,
                id,
                image: this.getCdnUrl(value.icon_path + "_large"),
                localimage: this.getPaintLocalImage(
                    def.className,
                    paintKit.className,
                    id
                ),
                name,
                rarity: ["melee", "glove"].includes(item.type)
                    ? this.getRarityColor(item.rarity ?? paintKit.rarity)
                    : this.getItemRarityColor(
                          [paintKit.className],
                          def.className!,
                          paintKit.rarity
                      )
            });
            this.itemDefs.push({
                ...def,
                id,
                itemid: paintKit.value
            });
            this.addCaseContent(`[${paintKit.className}]${def.className}`, id);
            this.caseRareItem[
                `${item.name} ${paintKit.name}`
                    .replace(/[^\d\w\s]/g, "")
                    .toLowerCase()
            ] = id;
        }
    }

    parseMusicKits() {
        for (const item of this.itemsFile.items_game.music_definitions) {
            for (const [musicId, value] of Object.entries(item)) {
                if (musicId === "2") {
                    // Skip duplicated CS:GO default music kit.
                    continue;
                }
                const name = this.getTranslation(value.loc_name);
                const id = this.getId(`musickit_${musicId}`);
                const itemid = Number(musicId);
                this.musicKits.push({
                    base: true,
                    category: "musickit",
                    free: itemid === 1 ? true : undefined,
                    id,
                    image: this.getCdnUrl(value.image_inventory),
                    name,
                    rarity: "#4b69ff",
                    type: "musickit"
                });
                this.itemDefs.push({
                    id,
                    itemid
                });
                this.addCaseContent(`[${value.name}]musickit`, id);
            }
        }
    }

    parseStickers() {
        for (const item of this.itemsFile.items_game.sticker_kits) {
            for (const [stickerId, value] of Object.entries(item)) {
                if (
                    value.name === "default" ||
                    value.item_name.indexOf("SprayKit") > -1 ||
                    value.name.indexOf("spray_") > -1 ||
                    value.name.indexOf("patch_") > -1 ||
                    value.sticker_material.indexOf("_graffiti") > -1
                ) {
                    continue;
                }
                let category: string = "";
                if (!value.sticker_material) {
                    console.log(value);
                }
                const [folder] = value.sticker_material.split("/");
                if (folder === "alyx") {
                    category = this.getTranslation(
                        "#CSGO_crate_sticker_pack_hlalyx_capsule"
                    );
                }
                if (UNCATEGORIZED_STICKERS.indexOf(folder) > -1) {
                    category = "Valve";
                }
                if (!category) {
                    category = this.getTranslation(
                        format("#CSGO_sticker_crate_key_%s", folder)
                    );
                }
                if (!category) {
                    category = this.getTranslation(
                        format("#CSGO_crate_sticker_pack_%s", folder)
                    );
                }
                if (!category) {
                    category = this.getTranslation(
                        format("#CSGO_crate_sticker_pack_%s_capsule", folder)
                    );
                }
                if (value.tournament_event_id) {
                    category = this.getTranslation(
                        format(
                            "#CSGO_Tournament_Event_NameShort_%s",
                            value.tournament_event_id
                        )
                    );
                    if (!category) {
                        throw new Error(
                            format(
                                "Unable to find the short name for tournament %s.",
                                value.tournament_event_id
                            )
                        );
                    }
                }
                if (!category) {
                    console.log(value);
                    throw new Error("Unable to define a category.");
                }
                const name = this.getTranslation(value.item_name);
                if (name === undefined) {
                    continue;
                }
                const id = this.getId(`sticker_${stickerId}`);
                const itemName = value.item_name.substring(
                    value.item_name.indexOf("#StickerKit_") + 12
                );
                this.stickers.push({
                    category,
                    id,
                    image: this.getCdnUrl(
                        format(
                            "econ/stickers/%s",
                            value.sticker_material + "_large"
                        )
                    ),
                    name,
                    rarity: this.getItemRarityColor(
                        [itemName, value.name],
                        "sticker",
                        value.item_rarity
                    ),
                    type: "sticker"
                });
                this.itemDefs.push({
                    id,
                    itemid: Number(stickerId)
                });
                this.addCaseContent(`[${value.name}]sticker`, id);
            }
        }
    }

    parsePatches() {
        for (const item of this.itemsFile.items_game.sticker_kits) {
            for (const [patchId, value] of Object.entries(item)) {
                if (
                    value.item_name.indexOf("#PatchKit") !== 0 &&
                    value.patch_material === undefined
                ) {
                    continue;
                }
                const name = this.getTranslation(value.item_name);
                if (name === undefined) {
                    continue;
                }
                const id = this.getId(`patch_${patchId}`);
                const itemName = value.item_name.substring(
                    value.item_name.indexOf("#PatchKit_") + 10
                );
                this.items.push({
                    category: "patch",
                    id,
                    image: this.getCdnUrl(
                        format(
                            "econ/patches/%s",
                            value.patch_material + "_large"
                        )
                    ),
                    teams: [CS_TEAM_CT, CS_TEAM_T],
                    name,
                    rarity: this.getItemRarityColor(
                        [itemName, value.name],
                        "patch",
                        value.item_rarity
                    ),
                    type: "patch"
                });
                this.itemDefs.push({
                    id,
                    itemid: Number(patchId)
                });
                this.addCaseContent(`[${value.name}]patch`, id);
            }
        }
    }

    parseAgents() {
        for (const item of this.itemsFile.items_game.items) {
            for (const [itemDef, value] of Object.entries(item)) {
                if (value.prefab !== "customplayertradable") {
                    continue;
                }
                const name = this.getTranslation(value.item_name);
                const teams = Object.keys(value.used_by_classes).map(
                    this.getCS_Team
                );
                const id = this.getId(
                    `agent_${this.getTeamDesc(teams)}_${itemDef}`
                );
                this.items.push({
                    category: "agent",
                    id,
                    image: this.getCdnUrl(value.image_inventory),
                    name,
                    rarity: this.getItemRarityColor(
                        [value.name],
                        "patch",
                        value.item_rarity
                    ),
                    teams,
                    type: "agent"
                });
                this.itemDefs.push({
                    className: value.name,
                    def: Number(itemDef),
                    id,
                    itemid: undefined
                });
            }
        }
    }

    parsePins() {
        for (const item of this.itemsFile.items_game.items) {
            for (const [itemDef, value] of Object.entries(item)) {
                if (
                    value.image_inventory === undefined ||
                    value.item_name === undefined ||
                    !value.image_inventory.includes("/status_icons/") ||
                    value.tool?.use_string === "#ConsumeItem" ||
                    value.attributes?.["set supply crate series"]
                        ?.attribute_class === "supply_crate_series" ||
                    value.item_name.indexOf("#CSGO_TournamentPass") === 0
                ) {
                    continue;
                }
                const name = this.getTranslation(value.item_name);
                const id = this.getId(`pin_${itemDef}`);
                this.items.push({
                    altname: value.name,
                    category: "pin",
                    id,
                    image: this.getCdnUrl(value.image_inventory),
                    name,
                    rarity: this.getRarityColor(value.item_rarity, "#eb4b4b"),
                    teams: undefined,
                    type: "pin"
                });
                this.itemDefs.push({
                    className: value.name,
                    def: Number(itemDef),
                    id,
                    itemid: undefined
                });
                this.addCaseContent(value.name, id);
            }
        }
    }

    async parseCases() {
        /**
         * We're going to deviate from the objective of this parsing as I'm
         * unable to find how to know which items are rare in each case from
         * items_game.txt, so we're going to use this API for getting them.
         */
        const cases = (await (
            await fetch(
                "https://spacerulerwill.github.io/CS2-API/api/cases.json"
            )
        ).json()) as {
            [key: string]: {
                formattedName: string;
                skins: {
                    "rare-item"?: string[];
                };
            };
        };
        const rareContents: Record<string, number[] | undefined> = {};
        for (const aCase of Object.values(cases)) {
            if (
                !aCase.skins["rare-item"] ||
                aCase.skins["rare-item"].length === 0
            ) {
                continue;
            }
            rareContents[aCase.formattedName] = aCase.skins["rare-item"].map(
                (item) => {
                    if (this.caseRareItem[item] === undefined) {
                        throw new Error(`unable to find ${item}`);
                    }
                    return this.caseRareItem[item];
                }
            );
        }
        const lootlist = {} as Record<
            string,
            (typeof this.itemsFile.items_game.client_loot_lists)[number][string]
        >;
        for (const itemSet of this.itemsFile.items_game.client_loot_lists) {
            for (const setName of Object.keys(itemSet)) {
                lootlist[setName] = itemSet[setName];
            }
        }
        const getItems = (lootlistKey: string, items: string[] = []) => {
            if (!lootlist[lootlistKey]) {
                console.warn(`not found loot list key ${lootlistKey}`);
                return [];
            }
            const keys = Object.keys(lootlist[lootlistKey]);
            for (const key of keys) {
                if (!this.caseContents[key]) {
                    getItems(key, items);
                } else {
                    items.push(key);
                }
            }
            return items;
        };
        for (const item of this.itemsFile.items_game.items) {
            for (const [itemDef, value] of Object.entries(item)) {
                if (
                    value.image_inventory === undefined ||
                    (value.prefab !== "weapon_case" &&
                        value.attributes?.["set supply crate series"]
                            ?.attribute_class !== "supply_crate_series") ||
                    !value.image_inventory.includes("econ/weapon_cases") ||
                    value.tool?.type === "gift"
                ) {
                    continue;
                }
                const contents = [] as number[];
                const resolveId =
                    value.attributes?.["set supply crate series"]?.value;
                if (resolveId === undefined) {
                    throw new Error(`resolveId not found ${value.name}`);
                }
                let resolvedName = undefined as string | undefined;
                for (const resolver of this.itemsFile.items_game
                    .revolving_loot_lists) {
                    if (resolver[resolveId]) {
                        resolvedName = resolver[resolveId];
                        break;
                    }
                }
                if (resolvedName === undefined) {
                    throw new Error(`not found resolver for ${value.name}`);
                }
                for (const itemName of getItems(resolvedName)) {
                    if (itemName.includes("]spray")) {
                        continue;
                    }
                    if (!this.caseContents[itemName]) {
                        throw new Error(`item not found ${itemName}`);
                    }
                    contents.push(this.caseContents[itemName]);
                }
                if (contents.length === 0) {
                    console.warn(`no items found for ${resolvedName}`);
                }
                if (contents.length > 0) {
                    const name = this.getTranslation(value.item_name);
                    const id = this.getId(`case_${itemDef}`);
                    const rarecontents = rareContents[name];
                    this.items.push({
                        category: "case",
                        contents,
                        id,
                        image: this.getCdnUrl(value.image_inventory),
                        rareimage:
                            value.image_unusual_item !== undefined
                                ? this.getCaseRareImage(
                                      value.image_unusual_item,
                                      id
                                  )
                                : rarecontents !== undefined &&
                                  rarecontents?.length > 0
                                ? 2
                                : undefined,
                        name,
                        rarecontents,
                        rarity: "#b0c3d9",
                        teams: undefined,
                        type: "case"
                    });
                    this.itemDefs.push({
                        def: Number(itemDef),
                        id
                    });
                }
            }
        }
    }

    addCaseContent(key: string, value: number) {
        if (this.caseContents[key] !== undefined) {
            throw new Error(`duplicate item found ${key}`);
        }
        this.caseContents[key] = value;
    }

    getBaseLocalImage(className: string, id: number) {
        const imagePath = resolve(
            CS2_IMAGES_PATH,
            `econ/weapons/base_weapons/${className}_png.png`
        );
        const destPath = resolve(process.cwd(), `dist/images/${id}.png`);
        if (existsSync(destPath)) {
            return 0b111;
        }
        if (existsSync(imagePath)) {
            copyFileSync(imagePath, destPath);
            return 0b111;
        }
        return 0;
    }

    getCaseRareImage(file: string, id: number) {
        const imagePath = resolve(CS2_IMAGES_PATH, `${file}_png.png`);
        const destFile = `${id}_rare.png`;
        const destPath = resolve(process.cwd(), `dist/images/${destFile}`);
        if (existsSync(destPath)) {
            return 1;
        }
        if (existsSync(imagePath)) {
            copyFileSync(imagePath, destPath);
            return 1;
        }
        return undefined;
    }

    getPaintLocalImage(
        className: string | undefined,
        paintClassName: string | undefined,
        id: number
    ) {
        const wears = ["heavy", "medium", "light"];
        if (!className || !paintClassName) {
            return undefined;
        }
        let localimage = 0;
        wears.filter((wear) => {
            const imagePath = resolve(
                CS2_IMAGES_PATH,
                `econ/default_generated/${className}_${paintClassName}_${wear}_png.png`
            );
            const destPath = resolve(
                process.cwd(),
                `dist/images/${id}_${wear}.png`
            );
            if (existsSync(destPath)) {
                return true;
            }
            if (existsSync(imagePath)) {
                copyFileSync(imagePath, destPath);
                return true;
            }
            return false;
        });

        wears.forEach((wear) => {
            switch (wear) {
                case "heavy":
                    return (localimage |= CS_DEFAULT_GENERATED_HEAVY);
                case "medium":
                    return (localimage |= CS_DEFAULT_GENERATED_MEDIUM);
                case "light":
                    return (localimage |= CS_DEFAULT_GENERATED_LIGHT);
            }
        });

        if (wears.length === 0) {
            console.log(
                `no local image for id ${id}, ${className}+${paintClassName}`
            );
            return undefined;
        }

        return localimage;
    }

    writeItemImages(items: CS_Item[]) {
        for (const item of items) {
            const id = String(item.id);
            const urls = this.itemImages[id] ?? ([] as string[]);
            if (!urls.includes(item.image)) {
                urls.push(item.image);
            }
            this.itemImages[id] = urls;
        }
        writeJson("dist/item-images.json", this.itemImages);
    }

    writeFiles() {
        const items = [
            ...this.items,
            ...this.paints,
            ...this.musicKits,
            ...this.stickers
        ].sort((a, b) => {
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
        });
        const itemsDefs = this.itemDefs.map((itemDef) => ({
            ...itemDef,
            className: undefined
        }));
        writeJson("dist/language.json", this.languageFile);
        writeJson("dist/parsed-items-game.json", this.itemsFile);
        writeJson("dist/item-rarities.json", this.itemRarities);
        writeJson("dist/items.json", items);
        this.writeItemImages(items);
        writeJson("dist/item-defs.json", itemsDefs);
        writeJson("dist/ids.json", this.ids);
        replaceInFile(
            "src/items.ts",
            /CS_Item\[\] = [^;]+;/,
            format("CS_Item[] = %s;", JSON.stringify(items))
        );
    }
}

new GenerateScript({
    language: "english"
});
