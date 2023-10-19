/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from "crypto";
import { copyFileSync, existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { format } from "util";
import {
    CS_DEFAULT_GENERATED_HEAVY,
    CS_DEFAULT_GENERATED_LIGHT,
    CS_DEFAULT_GENERATED_MEDIUM,
    CS_Item,
    CS_ItemDefinition
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

const EXPECT_UNIQUE_IDS = false;

interface CSGO_WeaponAttributes {
    "magazine model": string;
    "heat per shot": string;
    "addon scale": string;
    "tracer frequency": string;
    "primary clip size": string;
    "primary default clip size": string;
    "secondary default clip size": string;
    "is full auto": string;
    "max player speed": string;
    "in game price": string;
    "armor ratio": string;
    "crosshair min distance": string;
    "crosshair delta distance": string;
    cycletime: string | string[];
    "model right handed": string;
    penetration: string;
    damage: string;
    "headshot multiplier": string;
    range: string;
    "range modifier": string;
    bullets: string;
    "flinch velocity modifier large": string;
    "flinch velocity modifier small": string;
    spread: string;
    "inaccuracy crouch": string;
    "inaccuracy stand": string;
    "inaccuracy jump initial": string;
    "inaccuracy jump apex": string;
    "inaccuracy jump": string;
    "inaccuracy land": string;
    "inaccuracy ladder": string;
    "inaccuracy fire": string;
    "inaccuracy move": string;
    "recovery time crouch": string;
    "recovery time stand": string;
    "recoil angle": string;
    "recoil angle variance": string;
    "recoil magnitude": string;
    "recoil magnitude variance": string;
    "recoil seed": string;
    "primary reserve ammo max": string;
    "weapon weight": string;
    "rumble effect": string;
    "inaccuracy crouch alt": string;
    "inaccuracy fire alt": string;
    "inaccuracy jump alt": string;
    "inaccuracy ladder alt": string;
    "inaccuracy land alt": string;
    "inaccuracy move alt": string;
    "inaccuracy stand alt": string;
    "max player speed alt": string;
    "recoil angle variance alt": string;
    "recoil magnitude alt": string;
    "recoil magnitude variance alt": string;
    "recovery time crouch final": string;
    "recovery time stand final": string;
    "spread alt": string;
}

interface CSGO_Prefab {
    prefab: string;
    item_class: string;
    item_name: string;
    item_rarity: string;
    image_inventory: string;
    attributes: CSGO_WeaponAttributes;
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
                name: string;
                prefab: string;
                baseitem: string;
                item_sub_position?: string;
                image_inventory: string;
                used_by_classes: Record<CS_Team, number>;
                item_name: string;
                item_rarity: string;
                tool?: {
                    use_string?: string;
                };
                attributes?: {
                    ["set supply crate series"]?: {
                        attribute_class?: string;
                    };
                };
            };
        }[];
        music_definitions: {
            [musicId: string]: {
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
        sticker_kits: {
            [stickerId: string]: {
                name: string;
                item_name: string;
                tournament_event_id: string;
                sticker_material: string;
                item_rarity: string;
                patch_material: string;
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
    weaponsAttributes: { [key: string]: CSGO_WeaponAttributes } = {};
    ids: string[] = [];
    itemImages: Record<string, string[]>;

    constructor({ language }: { language?: string }) {
        this.language = language ?? "english";
        this.itemsFile = this.readItems();
        this.languageFile = this.readLanguage();
        this.ids = EXPECT_UNIQUE_IDS ? [] : this.readIds();
        this.itemImages = this.readItemImages();
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
        return `${teams
            .map((team) => (team === CS_TEAM_CT ? "CT" : "TR"))
            .join(" and ")}'s `;
    }

    getId(name: string) {
        const idx = this.ids.indexOf(name);
        if (idx === -1) {
            this.ids.push(name);
            return this.ids.length - 1;
        } else if (EXPECT_UNIQUE_IDS) {
            throw new Error(`not unique ${name}`);
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
                this.weaponsAttributes[itemDef] = prefab.attributes;
                const name = this.getTranslation(prefab.item_name);
                const teams = Object.keys(prefab.used_by_classes).map(
                    this.getCS_Team
                );
                const id = this.getId(
                    this.getTeamDesc(teams) + prefab.item_name + "_weapon"
                );
                this.items.push({
                    base: true,
                    category,
                    free: true,
                    id,
                    image: prefab.image_inventory
                        ? this.getCdnUrl(prefab.image_inventory)
                        : this.getCdnUrl(
                              format("econ/weapons/base_weapons/%s", value.name)
                          ),
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
                    paintid: undefined
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
                    this.getTeamDesc(teams) + value.item_name + "_melee"
                );
                this.items.push({
                    base: true,
                    category: "melee",
                    free: value.baseitem === "1" ? true : undefined,
                    id,
                    image: this.getCdnUrl(value.image_inventory),
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
                    paintid: value.baseitem === "1" ? undefined : 0
                });
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
                    this.getTeamDesc(teams) + value.item_name + "_glove"
                );
                this.items.push({
                    base: true,
                    category: "glove",
                    free: value.baseitem === "1" ? true : undefined,
                    id,
                    image: value.image_inventory
                        ? this.getCdnUrl(value.image_inventory)
                        : format("/%s.png", value.name),
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
                    paintid: value.baseitem === "1" ? undefined : 0
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
                        const matches = itemName.match(/^\[([^\]]+)\](.*)$/);
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
            const id = this.getId(
                `${def.className}_${paintKit.className}_${paintKit.value}_paint`
            );
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
                paintid: paintKit.value
            });
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
                const id = this.getId(`${value.loc_name}_${musicId}_musickit`);
                const musicid = Number(musicId);
                this.musicKits.push({
                    base: true,
                    category: "musickit",
                    free: musicid === 1 ? true : undefined,
                    id,
                    image: this.getCdnUrl(value.image_inventory),
                    name,
                    rarity: "#4b69ff",
                    type: "musickit"
                });
                this.itemDefs.push({
                    id,
                    musicid
                });
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
                const id = this.getId(
                    `${value.item_name}_${stickerId}_stickers`
                );
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
                    stickerid: Number(stickerId)
                });
            }
        }
    }

    parsePatches() {
        for (const item of this.itemsFile.items_game.sticker_kits) {
            for (const [patchId, value] of Object.entries(item)) {
                if (value.item_name.indexOf("#PatchKit") !== 0) {
                    continue;
                }
                const name = this.getTranslation(value.item_name);
                if (name === undefined) {
                    continue;
                }
                const id = this.getId(`${value.item_name}_${patchId}_patch`);
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
                    patchid: Number(patchId)
                });
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
                    this.getTeamDesc(teams) + value.item_name + "_agent"
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
                    paintid: undefined
                });
            }
        }
    }

    parsePins() {
        const pinFilter = [] as string[];
        for (const item of this.itemsFile.items_game.items) {
            for (const [itemDef, value] of Object.entries(item)) {
                if (
                    value.image_inventory === undefined ||
                    value.item_name === undefined ||
                    value.image_inventory.indexOf("/status_icons/") === -1 ||
                    value.tool?.use_string === "#ConsumeItem" ||
                    value.attributes?.["set supply crate series"]
                        ?.attribute_class === "supply_crate_series" ||
                    value.item_name.indexOf("#CSGO_TournamentPass") === 0 ||
                    pinFilter.includes(value.item_name)
                ) {
                    continue;
                }
                pinFilter.push(value.item_name);
                const name = this.getTranslation(value.item_name);
                const id = this.getId(`${itemDef}_${value.item_name}_pin`);
                this.items.push({
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
                    paintid: undefined
                });
            }
        }
    }

    getBaseLocalImage(className: string, id: number) {
        const imagePath = resolve(
            CS2_IMAGES_PATH,
            `econ/weapons/base_weapons/${className}_png.png`
        );
        if (existsSync(imagePath)) {
            copyFileSync(
                imagePath,
                resolve(process.cwd(), `dist/econ-images/${id}.png`)
            );
            return 0b111;
        }
        return 0;
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
            if (existsSync(imagePath)) {
                copyFileSync(
                    imagePath,
                    resolve(process.cwd(), `dist/econ-images/${id}_${wear}.png`)
                );
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
        writeJson("dist/language.json", this.languageFile);
        writeJson("dist/parsed-items-game.json", this.itemsFile);
        writeJson("dist/weapon-attributes.json", this.weaponsAttributes);
        writeJson("dist/item-rarities.json", this.itemRarities);
        writeJson("dist/items.json", items);
        this.writeItemImages(items);
        writeJson(
            "dist/item-defs.json",
            this.itemDefs.map((itemDef) => ({
                ...itemDef,
                className: undefined
            }))
        );
        writeJson("dist/ids.json", this.ids);
        replaceInFile(
            "src/items.ts",
            /CS_Item\[\] = [^;]+;/,
            format("CS_Item[] = %s;", JSON.stringify(items))
        );
        replaceInFile(
            "src/items.ts",
            /CS_ItemDefinition\[\] = [^;]+;/,
            format("CS_ItemDefinition[] = %s;", JSON.stringify(this.itemDefs))
        );
    }
}

new GenerateScript({
    language: "english"
});
