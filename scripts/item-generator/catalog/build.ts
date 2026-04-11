/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mkdir, readdir, readFile } from "fs/promises";
import { join } from "path";
import { CS2_DEFAULT_MAX_WEAR, CS2_DEFAULT_MIN_WEAR } from "../../../src/economy-constants.ts";
import { type CS2RarityColor } from "../../../src/economy-container.ts";
import { CS2ItemTeam, CS2ItemType, type CS2Item } from "../../../src/economy-types.ts";
import { CS2KeyValues } from "../../../src/keyvalues.ts";
import { assert, ensure, fail, isNotUndefined } from "../../../src/utils.ts";
import { buildVpkIndex, decompileItemDefinitionResources } from "../../cs2-tools/decompile.ts";
import { ensureItemDefinitionPackages, syncAssetsManifest } from "../../cs2-tools/depot.ts";
import { createCs2Runtime } from "../../cs2-tools/runtime.ts";
import { INPUT_FORCE } from "../../env.ts";
import { prependHash, readJson } from "../../utils.ts";
import {
    getIndexedCompositeMaterialFilename,
    getIndexedVmatFilename,
    getPaintCompositeMaterialPath,
    getStickerMaterialPath,
    normalizeMaterialResourcePath,
    resolveMaterialResourcePath
} from "../assets/material-paths.ts";
import {
    BASE_WEAPON_EQUIPMENT,
    FREE_MUSIC_KITS,
    GAME_ITEMS_PATH,
    GAME_RESOURCE_DIR,
    getInstalledGamePath,
    HEAVY_WEAPONS,
    ITEM_IDS_JSON_PATH,
    ITEMS_JSON_PATH,
    LANGUAGE_FILE_RE,
    LOOT_ITEM_RE,
    REMOVE_KEYCHAIN_TOOL_INDEX,
    SCRIPTS_DIR,
    SKIN_PHASE_RE,
    STATIC_IMAGES_DIR,
    UNCATEGORIZED_STICKERS,
    WEAPON_CATEGORY_RE,
    WORKDIR_DIR
} from "../config.ts";
import { type CS2ExtendedItem, type CS2GameItems, type CS2Language } from "../source-types.ts";
import { populateContainerContents, populateContainerSpecials } from "../sources/external.ts";
import { type ItemGeneratorContext } from "../types.ts";
import {
    getBaseImage,
    getCollectionImage,
    getDefaultGraffitiImage,
    getImage,
    getModel,
    getPaintImage,
    getSpecialsImage,
    isImageValid,
    isPaintImageValid,
    requireStaticAsset,
    tryGetFallbackImage
} from "./assets.ts";
import {
    addContainerItem,
    getClientLootListItems,
    getCollection,
    getContainerType,
    getItemCollection
} from "./collections.ts";
import {
    addFormattedTranslation,
    addTranslation,
    findTranslation,
    hasTranslation,
    requireTranslation,
    tryAddTranslation
} from "./translations.ts";

const MELEE_OR_GLOVES_TYPES: CS2ItemType[] = [CS2ItemType.Melee, CS2ItemType.Gloves];

export function createItemGeneratorContext(mode: ItemGeneratorContext["mode"]): ItemGeneratorContext {
    const existingItemsSnapshot = readJson<CS2Item[]>(ITEMS_JSON_PATH, []);
    const source = mode === "full" ? "installed_game" : "workspace_depot";
    return {
        mode,
        cs2: createCs2Runtime({
            force: INPUT_FORCE === "true",
            installedGamePath: getInstalledGamePath(source),
            paths: {
                assetsManifestPath: join(SCRIPTS_DIR, "cs2.manifest"),
                decompiledDir: join(WORKDIR_DIR, "decompiled"),
                depotCsgoPath: join(WORKDIR_DIR, "game/csgo"),
                depotFileListPath: join(SCRIPTS_DIR, "cs2.depot"),
                pakDirPath: "",
                tempPakFileListPath: join(WORKDIR_DIR, "cs2_temp_pak.depot"),
                workdirPath: WORKDIR_DIR
            },
            source
        }),
        gameItemsAsText: "",
        gameItems: {} as CS2GameItems["items_game"],
        csgoTranslationByLanguage: {},
        itemTranslationByLanguage: {},
        itemNames: new Map(),
        itemSetImage: {},
        itemSetItemKey: {},
        itemsRaritiesColorHex: {},
        paintKitsRaritiesColorHex: {},
        raritiesColorHex: {},
        staticAssets: {},
        existingImages: new Set(),
        neededVpkPaths: new Set(),
        imagesToProcess: new Map(),
        modelsToProcess: new Map(),
        compositeMaterialsToProcess: new Set(),
        materialsToProcess: new Set(),
        texturesToProcess: new Set(),
        compositeMaterialDataByPath: new Map(),
        compositeMaterialFilenameByPath: new Map(),
        compositeMaterialRefsByPath: new Map(),
        materialDataByPath: new Map(),
        materialFilenameByPath: new Map(),
        materialRefsByPath: new Map(),
        textureFilenameByPath: new Map(),
        baseItems: [],
        containerItems: new Map(),
        items: new Map(),
        stickerMarkup: {},
        paintKits: [],
        graffitiTints: [],
        keychainBaseId: undefined,
        allIdentifiers: readJson<string[]>(ITEM_IDS_JSON_PATH, []),
        uniqueIdentifiers: [],
        existingItemsById: new Map(existingItemsSnapshot.map((item) => [item.id, item])),
        workState: {}
    };
}

export async function loadSourceData(ctx: ItemGeneratorContext): Promise<void> {
    await mkdir(STATIC_IMAGES_DIR, { recursive: true });
    await syncAssetsManifest(ctx.cs2);
    await ensureItemDefinitionPackages(ctx.cs2);
    await buildVpkIndex(ctx.cs2);
    await decompileItemDefinitionResources(ctx.cs2);
    await readCsgoLanguageFiles(ctx);
    await readItemsGameFile(ctx);
}

export async function buildCatalog(ctx: ItemGeneratorContext): Promise<void> {
    await parseBaseWeapons(ctx);
    await parseBaseMelees(ctx);
    await parseBaseGloves(ctx);
    await parseUtilities(ctx);
    await parsePaintKits(ctx);
    await parseMusicKits(ctx);
    await parseKeychains(ctx);
    await parseStickers(ctx);
    await parseGraffiti(ctx);
    await parsePatches(ctx);
    await parseAgents(ctx);
    await parseCollectibles(ctx);
    await parseTools(ctx);
    await parseContainers(ctx);
    ctx.workState.catalog = {
        items: ctx.items.size,
        translations: Object.keys(ctx.itemTranslationByLanguage).length
    };
}

async function readCsgoLanguageFiles(ctx: ItemGeneratorContext, include?: string[]) {
    ctx.itemTranslationByLanguage = {};
    ctx.csgoTranslationByLanguage = Object.fromEntries(
        await Promise.all(
            (await readdir(GAME_RESOURCE_DIR))
                .map((file) => {
                    const matches = file.match(LANGUAGE_FILE_RE);
                    return matches !== null ? ([file, matches[1]!] as const) : undefined;
                })
                .filter(isNotUndefined)
                .filter(([_, language]) => include === undefined || include.includes(language))
                .map(async ([file, language]) => {
                    ctx.itemTranslationByLanguage[language] = {};
                    return [
                        language,
                        Object.entries(
                            CS2KeyValues.parse<CS2Language>(await readFile(join(GAME_RESOURCE_DIR, file), "utf-8")).lang
                                .Tokens
                        ).reduce(
                            (tokens, [key, value]) => {
                                key = key.toLowerCase();
                                assert(tokens[key] === undefined);
                                tokens[key] = value;
                                return tokens;
                            },
                            {} as Record<string, string | undefined>
                        )
                    ];
                })
        )
    );
    assert(Object.keys(ctx.csgoTranslationByLanguage).length > 0);
    assert(ctx.csgoTranslationByLanguage.english !== undefined);
}

async function readItemsGameFile(ctx: ItemGeneratorContext) {
    ctx.gameItemsAsText = await readFile(GAME_ITEMS_PATH, "utf-8");
    ctx.gameItems = CS2KeyValues.parse<CS2GameItems>(ctx.gameItemsAsText).items_game;
    ctx.raritiesColorHex = Object.fromEntries(
        Object.entries(ctx.gameItems.rarities).map(([rarityKey, { color }]) => {
            return [rarityKey, ensure(ctx.gameItems.colors[ensure(color)]?.hex_color)] as const;
        })
    );
    ctx.paintKitsRaritiesColorHex = Object.fromEntries(
        Object.entries(ctx.gameItems.paint_kits_rarity).map(([paintKitKey, rarityKey]) => {
            return [paintKitKey, ctx.raritiesColorHex[rarityKey]] as const;
        })
    );
    const rarityKeys = Object.keys(ctx.raritiesColorHex);
    ctx.itemsRaritiesColorHex = Object.fromEntries(
        Object.entries(ctx.gameItems.client_loot_lists)
            .map(([clientLootListKey, clientLootList]) => {
                const rarityKey = rarityKeys.find((candidate) => clientLootListKey.includes(`_${candidate}`));
                return rarityKey !== undefined
                    ? Object.keys(clientLootList)
                          .map((itemOrClientLootListKey) =>
                              itemOrClientLootListKey.includes("customplayer_") ||
                              LOOT_ITEM_RE.test(itemOrClientLootListKey)
                                  ? ([itemOrClientLootListKey, ctx.raritiesColorHex[rarityKey]] as const)
                                  : undefined
                          )
                          .filter(isNotUndefined)
                    : undefined;
            })
            .filter(isNotUndefined)
            .flat()
    );
    ctx.paintKits = Object.entries(ctx.gameItems.paint_kits)
        .map(([paintKitIndex, data]) => {
            const {
                composite_material_path,
                description_string,
                description_tag,
                name,
                use_legacy_model,
                wear_remap_max,
                wear_remap_min
            } = data;
            if (name === undefined || name === "default" || description_tag === undefined) {
                return undefined;
            }
            return {
                className: name,
                compositeMaterialPath: composite_material_path,
                descToken: prependHash(description_string),
                index: Number(paintKitIndex),
                isLegacy: use_legacy_model === "1",
                nameToken: prependHash(description_tag),
                rarityColorHex: getRarityColorHex(ctx, [name]),
                wearMax: wear_remap_max !== undefined ? Number(wear_remap_max) : CS2_DEFAULT_MAX_WEAR,
                wearMin: wear_remap_min !== undefined ? Number(wear_remap_min) : CS2_DEFAULT_MIN_WEAR
            };
        })
        .filter(isNotUndefined);
    ctx.graffitiTints = Object.values(ctx.gameItems.graffiti_tints).map(({ id, hex_color }) => ({
        id: Number(id),
        name: requireTranslation(ctx, `#Attrib_SprayTintValue_${id}`),
        nameToken: `#Attrib_SprayTintValue_${id}`,
        hexColor: hex_color
    }));
    ctx.itemSetImage = {};
    ctx.itemSetItemKey = Object.fromEntries(
        (
            await Promise.all(
                Object.entries(ctx.gameItems.item_sets).map(async ([itemSetKey, { items }]) => {
                    return await Promise.all(
                        Object.keys(items).map(async (itemKey) => {
                            if (ctx.itemSetImage[itemSetKey] === undefined) {
                                ctx.itemSetImage[itemSetKey] = getCollectionImage(ctx, itemSetKey);
                            }
                            return [itemKey, itemSetKey] as const;
                        })
                    );
                })
            )
        ).flat()
    );
}

async function parseBaseWeapons(ctx: ItemGeneratorContext) {
    for (const [itemDef, { baseitem, flexible_loadout_slot, name, prefab, image_inventory }] of Object.entries(
        ctx.gameItems.items
    )) {
        if (baseitem !== "1" || flexible_loadout_slot === undefined) {
            continue;
        }
        const category = flexible_loadout_slot.match(WEAPON_CATEGORY_RE)?.[1];
        if (category === undefined || (category === "equipment" && !BASE_WEAPON_EQUIPMENT.includes(name))) {
            continue;
        }
        const { used_by_classes, item_name, item_description, model_player } = getPrefab(ctx, prefab);
        const teams = getTeams(used_by_classes);
        const id = getItemId(ctx, `weapon_${getTeamsString(used_by_classes)}_${itemDef}`);
        addTranslation(ctx, id, "name", item_name);
        addTranslation(ctx, id, "desc", item_description);
        const modelInfo = getModel(ctx, model_player, id);
        addItem(ctx, {
            base: true,
            category: getBaseWeaponCategory(name, category),
            className: name,
            def: Number(itemDef),
            descToken: item_description,
            free: true,
            id,
            image: image_inventory !== undefined ? getImage(ctx, image_inventory) : getBaseImage(ctx, name),
            index: undefined,
            model: name.replace("weapon_", ""),
            modelData: modelInfo?.modelData,
            modelPlayer: modelInfo?.modelPlayer,
            nameToken: item_name,
            rarity: getRarityColorHex(ctx, ["default"]),
            teams,
            type: CS2ItemType.Weapon
        });
    }
}

async function parseBaseMelees(ctx: ItemGeneratorContext) {
    for (const [itemDef, item] of Object.entries(ctx.gameItems.items)) {
        const { item_name, image_inventory, item_description, name, used_by_classes, prefab, baseitem } = item;
        if (
            item_name === undefined ||
            image_inventory === undefined ||
            used_by_classes === undefined ||
            (prefab === "melee" && baseitem !== "1") ||
            !prefab?.includes("melee") ||
            prefab.includes("noncustomizable") ||
            !hasTranslation(ctx, item_name)
        ) {
            continue;
        }
        const prefabData = getPrefab(ctx, prefab);
        const teams = getTeams(used_by_classes);
        const id = getItemId(ctx, `melee_${getTeamsString(used_by_classes)}_${itemDef}`);
        addTranslation(ctx, id, "name", item_name);
        addTranslation(ctx, id, "desc", item_description);
        addItem(ctx, {
            base: true,
            className: name,
            def: Number(itemDef),
            descToken: item_description,
            free: baseitem === "1" ? true : undefined,
            id,
            image: getImage(ctx, image_inventory),
            index: baseitem === "1" ? undefined : 0,
            model: name.replace("weapon_", ""),
            nameToken: item_name,
            rarity: getRarityColorHex(ctx, [prefabData.item_rarity], "default"),
            teams,
            type: CS2ItemType.Melee
        });
    }
}

async function parseBaseGloves(ctx: ItemGeneratorContext) {
    for (const [itemDef, item] of Object.entries(ctx.gameItems.items)) {
        const { item_name, baseitem, name, prefab, image_inventory, item_description, used_by_classes } = item;
        if (item_name === undefined || !prefab?.includes("hands")) {
            continue;
        }
        const teams = getTeams(used_by_classes, CS2ItemTeam.Both);
        const id = getItemId(ctx, `glove_${getTeamsString(used_by_classes, "3_2")}_${itemDef}`);
        addTranslation(ctx, id, "name", item_name);
        addTranslation(ctx, id, "desc", item_description);
        addItem(ctx, {
            base: true,
            className: name,
            def: Number(itemDef),
            descToken: item_description,
            free: baseitem === "1" ? true : undefined,
            id,
            image:
                image_inventory !== undefined
                    ? getImage(ctx, image_inventory)
                    : requireStaticAsset(ctx, `/images/${name}.png`),
            index: baseitem === "1" ? undefined : 0,
            model: name,
            nameToken: item_name,
            rarity: getRarityColorHex(ctx, [baseitem === "1" ? "default" : "ancient"]),
            teams,
            type: CS2ItemType.Gloves
        });
    }
}

async function parseUtilities(ctx: ItemGeneratorContext) {
    for (const [itemDef, { flexible_loadout_slot, name, prefab, image_inventory }] of Object.entries(
        ctx.gameItems.items
    )) {
        if (!flexible_loadout_slot?.startsWith("grenade")) {
            continue;
        }
        const { item_name, item_description } = getPrefab(ctx, prefab);
        const id = getItemId(ctx, `utility_${itemDef}`);
        addTranslation(ctx, id, "name", item_name);
        addTranslation(ctx, id, "desc", item_description);
        addItem(ctx, {
            base: true,
            className: name,
            def: Number(itemDef),
            descToken: item_description,
            free: true,
            id,
            image: image_inventory !== undefined ? getImage(ctx, image_inventory) : getBaseImage(ctx, name),
            index: undefined,
            model: name.replace("weapon_", ""),
            nameToken: item_name,
            rarity: getRarityColorHex(ctx, ["default"]),
            teams: CS2ItemTeam.Both,
            type: CS2ItemType.Utility
        });
    }
}

async function parsePaintKits(ctx: ItemGeneratorContext) {
    for (const paintKit of ctx.paintKits) {
        for (const baseItem of ctx.baseItems) {
            if (!isPaintImageValid(ctx, baseItem.className, paintKit.className)) {
                continue;
            }
            const itemKey = `[${paintKit.className}]${baseItem.className}`;
            if (baseItem.type === CS2ItemType.Weapon && !ctx.gameItemsAsText.includes(itemKey)) {
                continue;
            }
            const id = getItemId(ctx, `paint_${baseItem.def}_${paintKit.index}`);
            addContainerItem(ctx, itemKey, id);
            addTranslation(ctx, id, "name", baseItem.nameToken, " | ", paintKit.nameToken);
            addTranslation(ctx, id, "desc", paintKit.descToken);
            const compositeMaterialPath = getPaintCompositeMaterialPath(
                paintKit.className,
                paintKit.compositeMaterialPath
            );
            const resolvedCompositeMaterialPath =
                ctx.mode === "full" ? resolveMaterialResourcePath(ctx.cs2, compositeMaterialPath) : undefined;
            const compositeMaterial =
                resolvedCompositeMaterialPath !== undefined
                    ? `/materials/${getIndexedCompositeMaterialFilename(ctx.cs2, resolvedCompositeMaterialPath)}`
                    : undefined;
            if (resolvedCompositeMaterialPath !== undefined) {
                ctx.compositeMaterialsToProcess.add(normalizeMaterialResourcePath(resolvedCompositeMaterialPath));
            }
            addItem(ctx, {
                ...baseItem,
                ...getItemCollection(ctx, id, itemKey),
                altName: getPaintAltName(paintKit.className),
                base: undefined,
                baseId: baseItem.id,
                compositeMaterial,
                free: undefined,
                id,
                image: getPaintImage(ctx, baseItem.className, paintKit.className),
                index: Number(paintKit.index),
                legacy: (baseItem.type === "weapon" && paintKit.isLegacy) || undefined,
                modelData: undefined,
                modelPlayer: undefined,
                rarity: getRarityColorHex(
                    ctx,
                    MELEE_OR_GLOVES_TYPES.includes(baseItem.type)
                        ? [baseItem.rarity, paintKit.rarityColorHex]
                        : [itemKey, paintKit.rarityColorHex]
                ),
                stickerMax: undefined,
                stickerMaxForLegacy: undefined,
                wearMax: paintKit.wearMax,
                wearMin: paintKit.wearMin
            });
        }
    }
}

async function parseMusicKits(ctx: ItemGeneratorContext) {
    const baseId = createStub(ctx, "musickit", "#CSGO_musickit_desc");
    for (const [index, { name, loc_name, loc_description, image_inventory }] of Object.entries(
        ctx.gameItems.music_definitions
    )) {
        if (index === "2") {
            continue;
        }
        const itemKey = `[${name}]musickit`;
        const id = getItemId(ctx, `musickit_${index}`);
        const base = FREE_MUSIC_KITS.includes(index) ? true : undefined;
        addContainerItem(ctx, itemKey, id);
        addTranslation(ctx, id, "name", "#CSGO_Type_MusicKit", " | ", loc_name);
        addTranslation(ctx, id, "desc", loc_description);
        addItem(ctx, {
            base,
            baseId,
            def: 1314,
            free: base,
            id,
            image: getImage(ctx, image_inventory),
            index: Number(index),
            rarity: getRarityColorHex(ctx, ["rare"]),
            type: CS2ItemType.MusicKit
        });
        ctx.itemNames.set(id, `music_kit-${index}`);
    }
}

async function parseKeychains(ctx: ItemGeneratorContext) {
    ctx.keychainBaseId = createStub(ctx, "keychain", "#CSGO_Tool_Keychain_Desc");
    for (const [index, { name, loc_name, loc_description, item_rarity, image_inventory }] of Object.entries(
        ctx.gameItems.keychain_definitions
    )) {
        if (!hasTranslation(ctx, loc_name)) {
            continue;
        }
        if (!isImageValid(ctx, image_inventory)) {
            continue;
        }
        const id = getItemId(ctx, `keychain_${index}`);
        const itemKey = `[${name}]keychain`;
        addContainerItem(ctx, itemKey, id);
        addTranslation(ctx, id, "name", "#CSGO_Tool_Keychain", " | ", loc_name);
        tryAddTranslation(ctx, id, "desc", loc_description);
        addItem(ctx, {
            baseId: ctx.keychainBaseId,
            free: index === "37" ? true : undefined,
            def: 1355,
            id,
            image: getImage(ctx, image_inventory),
            index: Number(index),
            rarity: getRarityColorHex(ctx, [itemKey, item_rarity]),
            type: CS2ItemType.Keychain
        });
    }
}

export async function parseStickers(ctx: ItemGeneratorContext): Promise<void> {
    const baseId = createStub(ctx, "sticker", "#CSGO_Tool_Sticker_Desc");
    for (const [index, sticker] of Object.entries(ctx.gameItems.sticker_kits)) {
        const { name, description_string, item_name, sticker_material, tournament_event_id, item_rarity } = sticker;
        if (
            name === "default" ||
            item_name.includes("SprayKit") ||
            name.includes("spray_") ||
            name.includes("patch_") ||
            sticker_material.includes("_graffiti") ||
            !hasTranslation(ctx, item_name)
        ) {
            continue;
        }
        const [category, categoryToken] = getStickerCategory(ctx, { sticker_material, tournament_event_id });
        const id = getItemId(ctx, `sticker_${index}`);
        const itemKey = `[${name}]sticker`;
        const rarity = getRarityColorHex(ctx, [itemKey, item_rarity]);
        const compositeMaterial = getStickerCompositeMaterial(ctx, sticker_material);
        addContainerItem(ctx, itemKey, id);
        addTranslation(ctx, id, "name", "#CSGO_Tool_Sticker", " | ", item_name);
        addTranslation(ctx, id, "category", categoryToken !== undefined ? categoryToken : category);
        tryAddTranslation(ctx, id, "desc", description_string);
        if (tournament_event_id !== undefined) {
            addFormattedTranslation(
                ctx,
                id,
                "tournamentDesc",
                "#CSGO_Event_Desc",
                `#CSGO_Tournament_Event_Name_${tournament_event_id}`
            );
        }
        addItem(ctx, {
            baseId,
            compositeMaterial,
            def: 1209,
            id,
            image: getImage(ctx, `econ/stickers/${sticker_material}`),
            index: Number(index),
            rarity,
            type: CS2ItemType.Sticker
        });
        ctx.itemNames.set(id, `sticker-${index}`);
        const keychainInventoryImage = `econ/stickers/${sticker_material}_1355_37`;
        const keychainId = getItemId(ctx, `keychain_37_${index}`);
        const keychainImage = isImageValid(ctx, keychainInventoryImage)
            ? getImage(ctx, keychainInventoryImage)
            : await tryGetFallbackImage(ctx, "keychain", keychainInventoryImage, keychainId);
        if (keychainImage === undefined) {
            continue;
        }
        addTranslation(ctx, keychainId, "name", "#keychain_kc_sticker_display_case", " | ", item_name);
        tryAddTranslation(ctx, keychainId, "desc", "#keychain_kc_sticker_display_case_desc");
        addItem(ctx, {
            baseId: ctx.keychainBaseId,
            def: 1355,
            id: keychainId,
            image: keychainImage,
            index: 37,
            rarity,
            stickerId: id,
            type: CS2ItemType.Keychain
        });
    }
}

async function parseGraffiti(ctx: ItemGeneratorContext) {
    const baseId = createStub(ctx, "graffiti", "#CSGO_Tool_SprayPaint_Desc");
    for (const [index, sticker] of Object.entries(ctx.gameItems.sticker_kits)) {
        const { name, item_name, description_string, sticker_material, item_rarity, tournament_event_id } = sticker;
        if (
            !hasTranslation(ctx, item_name) ||
            (name?.indexOf("spray_") !== 0 &&
                !item_name?.includes("#SprayKit") &&
                item_name?.indexOf("spray_") !== 0 &&
                !description_string?.includes("#SprayKit") &&
                !sticker_material?.includes("_graffiti"))
        ) {
            continue;
        }
        const itemKey = `[${name}]spray`;
        if (sticker_material.startsWith("default")) {
            for (const { hexColor, nameToken: tintNameToken, id: tintId } of ctx.graffitiTints) {
                const id = getItemId(ctx, `spray_${index}_${tintId}`);
                addContainerItem(ctx, itemKey, id);
                addTranslation(ctx, id, "name", "#CSGO_Type_Spray", " | ", item_name, " (", tintNameToken, ")");
                addTranslation(ctx, id, "desc", description_string);
                addItem(ctx, {
                    baseId,
                    id,
                    image: getDefaultGraffitiImage(ctx, sticker_material, hexColor),
                    index: Number(index),
                    rarity: getRarityColorHex(ctx, [item_rarity]),
                    tint: tintId,
                    type: CS2ItemType.Graffiti
                });
                ctx.itemNames.set(id, `graffiti-${index}`);
            }
            continue;
        }
        const id = getItemId(ctx, `spray_${index}`);
        addContainerItem(ctx, itemKey, id);
        addTranslation(ctx, id, "name", "#CSGO_Type_Spray", " | ", item_name);
        addTranslation(ctx, id, "desc", description_string);
        if (tournament_event_id !== undefined) {
            addFormattedTranslation(
                ctx,
                id,
                "tournamentDesc",
                "#CSGO_Event_Desc",
                `#CSGO_Tournament_Event_Name_${tournament_event_id}`
            );
        }
        addItem(ctx, {
            baseId,
            def: 1348,
            id,
            image: getImage(ctx, `econ/stickers/${sticker_material}`),
            index: Number(index),
            rarity: getRarityColorHex(ctx, [itemKey, item_rarity]),
            type: CS2ItemType.Graffiti
        });
        ctx.itemNames.set(id, `graffiti-${index}`);
    }
}

async function parsePatches(ctx: ItemGeneratorContext) {
    const baseId = createStub(ctx, "patch", "#CSGO_Tool_Patch_Desc");
    for (const [index, sticker] of Object.entries(ctx.gameItems.sticker_kits)) {
        const { name, item_name, patch_material, description_string, tournament_event_id, item_rarity } = sticker;
        if (item_name.indexOf("#PatchKit") !== 0 && patch_material === undefined) {
            continue;
        }
        const id = getItemId(ctx, `patch_${index}`);
        const itemKey = `[${name}]patch`;
        addContainerItem(ctx, itemKey, id);
        addTranslation(ctx, id, "name", "#CSGO_Tool_Patch", " | ", item_name);
        addTranslation(ctx, id, "desc", description_string);
        if (tournament_event_id !== undefined) {
            addFormattedTranslation(
                ctx,
                id,
                "tournamentDesc",
                "#CSGO_Event_Desc",
                `#CSGO_Tournament_Event_Name_${tournament_event_id}`
            );
        }
        addItem(ctx, {
            baseId,
            def: 4609,
            id,
            image: getImage(ctx, `econ/patches/${patch_material}`),
            index: Number(index),
            rarity: getRarityColorHex(ctx, [itemKey, item_rarity]),
            type: CS2ItemType.Patch
        });
        ctx.itemNames.set(id, `patch-${index}`);
    }
}

async function parseAgents(ctx: ItemGeneratorContext) {
    for (const [index, item] of Object.entries(ctx.gameItems.items)) {
        const {
            name,
            item_name,
            used_by_classes,
            image_inventory,
            model_player,
            item_rarity,
            prefab,
            item_description
        } = item;
        if (
            item_name === undefined ||
            used_by_classes === undefined ||
            image_inventory === undefined ||
            model_player === undefined ||
            prefab !== "customplayertradable"
        ) {
            continue;
        }
        const teams = getTeams(used_by_classes);
        const id = getItemId(ctx, `agent_${getTeamsString(used_by_classes)}_${index}`);
        const model = model_player.replace("characters/models/", "").replace(".vmdl", "");
        addTranslation(ctx, id, "name", "#Type_CustomPlayer", " | ", item_name);
        addTranslation(ctx, id, "desc", item_description);
        addItem(ctx, {
            ...getItemCollection(ctx, id, name),
            def: Number(index),
            id,
            image: getImage(ctx, image_inventory),
            index: undefined,
            model,
            rarity: getRarityColorHex(ctx, [name, item_rarity]),
            teams,
            type: CS2ItemType.Agent
        });
    }
}

async function parseCollectibles(ctx: ItemGeneratorContext) {
    for (const [index, item] of Object.entries(ctx.gameItems.items)) {
        const { name, image_inventory, item_name, tool, attributes, item_rarity, item_description } = item;
        if (
            image_inventory === undefined ||
            item_name === undefined ||
            (!image_inventory.includes("/status_icons/") && !image_inventory.includes("/premier_seasons/")) ||
            tool?.use_string === "#ConsumeItem" ||
            attributes?.["set supply crate series"]?.attribute_class === "supply_crate_series" ||
            item_name.indexOf("#CSGO_TournamentPass") === 0 ||
            !attributes?.["pedestal display model"]
        ) {
            continue;
        }
        const id = getItemId(ctx, `pin_${index}`);
        const image = isImageValid(ctx, image_inventory)
            ? getImage(ctx, image_inventory)
            : await tryGetFallbackImage(ctx, "collectible", image_inventory, id);
        if (image === undefined) {
            continue;
        }
        addContainerItem(ctx, name, id);
        addTranslation(ctx, id, "name", "#CSGO_Type_Collectible", " | ", item_name);
        tryAddTranslation(ctx, id, "desc", item_description ?? `${item_name}_Desc`);
        if (attributes?.["tournament event id"] !== undefined) {
            addFormattedTranslation(
                ctx,
                id,
                "tournamentDesc",
                "#CSGO_Event_Desc",
                `#CSGO_Tournament_Event_Name_${attributes["tournament event id"].value}`
            );
        }
        addItem(ctx, {
            altName: name,
            def: Number(index),
            id,
            image,
            index: undefined,
            rarity: getRarityColorHex(ctx, [item_rarity, "ancient"]),
            type: CS2ItemType.Collectible
        });
        ctx.itemNames.set(id, `collectible-${index}`);
    }
}

async function parseTools(ctx: ItemGeneratorContext) {
    for (const [index, item] of Object.entries(ctx.gameItems.items)) {
        const { name, baseitem, item_name, image_inventory, prefab, item_description } = item;
        if (
            prefab !== "recipe" &&
            (item_name === undefined ||
                image_inventory === undefined ||
                !image_inventory.includes("econ/tools/") ||
                !prefab?.includes("csgo_tool"))
        ) {
            continue;
        }
        const id = getItemId(ctx, `tool_${index}`);
        const prefabData = ctx.gameItems.prefabs[prefab];
        const image = ensure(image_inventory || prefabData?.image_inventory);
        addContainerItem(ctx, name, id);
        addTranslation(ctx, id, "name", "#CSGO_Type_Tool", " | ", item_name);
        addTranslation(ctx, id, "desc", item_description);
        addItem(ctx, {
            def: Number(index),
            free: baseitem === "1" && index !== REMOVE_KEYCHAIN_TOOL_INDEX ? true : undefined,
            id,
            image: getImage(ctx, image),
            index: undefined,
            rarity: getRarityColorHex(ctx, ["common"]),
            type: CS2ItemType.Tool
        });
    }
}

async function parseContainers(ctx: ItemGeneratorContext) {
    const keyItems = new Map<string, number>();
    for (const [containerIndex, item] of Object.entries(ctx.gameItems.items)) {
        const {
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
        } = item;
        const hasSupplyCrateSeries = attributes?.["set supply crate series"]?.attribute_class === "supply_crate_series";
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
        const clientLootListKey =
            revolvingLootListKey !== undefined
                ? ctx.gameItems.revolving_loot_lists[revolvingLootListKey]
                : loot_list_name;
        if (clientLootListKey === undefined) {
            continue;
        }
        let contentsType: CS2ItemType | undefined;
        const contents: number[] = [];
        for (const itemKey of getClientLootListItems(ctx, clientLootListKey)) {
            const id = ensure(ctx.containerItems.get(itemKey));
            const contained = ensure(ctx.items.get(id));
            contentsType = contained.type;
            if (contained.tint !== undefined) {
                assert(contained.index !== undefined);
                for (const other of ctx.items.values()) {
                    if (other.tint !== undefined && other.index === contained.index) {
                        contents.push(other.id);
                    }
                }
            } else {
                contents.push(id);
            }
        }
        const specials: number[] = [];
        await populateContainerContents(item_name, contents, ctx.itemNames);
        await populateContainerSpecials(item_name, specials, ctx.itemNames);
        if (contents.length === 0) {
            continue;
        }
        const prefabData = tryGetPrefab(ctx, prefab);
        assert(
            associated_items !== undefined ||
                prefab === "sticker_capsule" ||
                prefab === "weapon_case_souvenirpkg" ||
                prefabData?.prefab === "weapon_case_souvenirpkg" ||
                tags?.StickerCapsule ||
                name.includes("crate_signature") ||
                name.includes("crate_pins") ||
                name.includes("crate_musickit") ||
                name.includes("crate_patch") ||
                name.includes("crate_sprays") ||
                name.includes("selfopeningitem") ||
                prefab?.includes("selfopening") ||
                item_name.includes("crate_xray")
        );
        const keys = await Promise.all(
            Object.keys(associated_items ?? {}).map(async (keyItemDef) => {
                if (keyItems.has(keyItemDef)) {
                    return ensure(keyItems.get(keyItemDef));
                }
                const keyItem = ensure(ctx.gameItems.items[keyItemDef]);
                assert(keyItem.image_inventory);
                const id = getItemId(ctx, `key_${keyItemDef}`);
                const nameToken = keyItem.item_name ?? "#CSGO_base_crate_key";
                keyItems.set(keyItemDef, id);
                addTranslation(ctx, id, "name", "#CSGO_Tool_WeaponCase_KeyTag", " | ", nameToken);
                tryAddTranslation(ctx, id, "desc", keyItem.item_description);
                addItem(ctx, {
                    def: Number(keyItemDef),
                    id,
                    image: getImage(ctx, keyItem.image_inventory),
                    rarity: getRarityColorHex(ctx, ["common"]),
                    type: CS2ItemType.Key
                });
                return id;
            })
        );
        const id = getItemId(ctx, `case_${containerIndex}`);
        const image = isImageValid(ctx, image_inventory)
            ? getImage(ctx, image_inventory)
            : await tryGetFallbackImage(ctx, "container", image_inventory, id);
        if (image === undefined) {
            continue;
        }
        const containerName = requireTranslation(ctx, item_name);
        const containsMusicKit = containerName.includes("Music Kit");
        const containsStatTrak = containerName.includes("StatTrak");
        addTranslation(ctx, id, "name", "#CSGO_Type_WeaponCase", " | ", item_name);
        tryAddTranslation(ctx, id, "desc", item_description);
        addItem(ctx, {
            ...getCollection(ctx, id, tags?.ItemSet?.tag_value),
            containerType: getContainerType(containerName, contentsType),
            contents,
            def: Number(containerIndex),
            id,
            image,
            keys: keys.length > 0 ? keys : undefined,
            rarity: getRarityColorHex(ctx, ["common"]),
            specials: specials.length > 0 ? specials : ctx.existingItemsById.get(id)?.specials,
            specialsImage: getSpecialsImage(ctx, image_unusual_item),
            statTrakless: containsMusicKit && !containsStatTrak ? true : undefined,
            statTrakOnly: containsMusicKit && containsStatTrak ? true : undefined,
            type: CS2ItemType.Container
        });
    }
}

function getItemId(ctx: ItemGeneratorContext, identifier: string) {
    assert(!ctx.uniqueIdentifiers.includes(identifier));
    ctx.uniqueIdentifiers.push(identifier);
    const index = ctx.allIdentifiers.indexOf(identifier);
    if (index === -1) {
        ctx.allIdentifiers.push(identifier);
        return ctx.allIdentifiers.length - 1;
    }
    return index;
}

function getRarityColorHex(ctx: ItemGeneratorContext, keywords: (string | undefined)[], defaultsTo?: string) {
    let colorHex =
        defaultsTo !== undefined
            ? defaultsTo.startsWith("#")
                ? defaultsTo
                : ctx.raritiesColorHex[defaultsTo]
            : undefined;
    for (const keyword of keywords) {
        if (keyword === undefined) {
            continue;
        }
        if (keyword.startsWith("#")) {
            colorHex = keyword;
            break;
        }
        colorHex =
            ctx.itemsRaritiesColorHex[keyword] ??
            ctx.paintKitsRaritiesColorHex[keyword] ??
            ctx.raritiesColorHex[keyword];
        if (colorHex !== undefined) {
            break;
        }
    }
    return ensure((colorHex ?? ctx.raritiesColorHex.default) as CS2RarityColor);
}

function getPrefab(ctx: ItemGeneratorContext, prefab?: string) {
    return ensure(ctx.gameItems.prefabs[ensure(prefab)]);
}

function tryGetPrefab(ctx: ItemGeneratorContext, prefab?: string) {
    return prefab !== undefined ? ctx.gameItems.prefabs[prefab] : undefined;
}

function getTeams(teams?: Record<string, string>, fallback?: CS2ItemTeam) {
    if (teams === undefined) {
        return ensure(fallback);
    }
    const keys = Object.keys(teams);
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

function getTeamsString(teams?: Record<string, string>, fallback?: string) {
    return teams === undefined
        ? ensure(fallback)
        : Object.keys(teams)
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

export function hydrateExistingModelFields(ctx: ItemGeneratorContext, item: CS2ExtendedItem): void {
    const previous = ctx.existingItemsById.get(item.id);
    if (ctx.mode !== "limited" || previous === undefined) {
        return;
    }
    const requiredFields = [
        "compositeMaterial",
        "modelData",
        "modelPlayer",
        "stickerMax",
        "stickerMaxForLegacy"
    ] as const;
    for (const field of requiredFields) {
        const fallback = previous[field];
        if (!(field in item) && fallback !== undefined) {
            (item as unknown as Record<string, unknown>)[field] = fallback;
        }
    }
}

export function getStickerCompositeMaterial(ctx: ItemGeneratorContext, stickerMaterial: string): string | undefined {
    if (ctx.mode !== "full") {
        return undefined;
    }
    const resolvedMaterialPath = resolveMaterialResourcePath(ctx.cs2, getStickerMaterialPath(stickerMaterial));
    const normalizedMaterialPath = normalizeMaterialResourcePath(resolvedMaterialPath);
    ctx.materialsToProcess.add(normalizedMaterialPath);
    return `/materials/${getIndexedVmatFilename(ctx.cs2, normalizedMaterialPath)}`;
}

function addItem(ctx: ItemGeneratorContext, item: CS2ExtendedItem) {
    hydrateExistingModelFields(ctx, item);
    if (item.base) {
        ctx.baseItems.push(item);
    }
    ctx.items.set(item.id, item);
}

function getBaseWeaponCategory(name: string, category: string) {
    return HEAVY_WEAPONS.includes(name) ? "heavy" : category;
}

function getPaintAltName(className: string) {
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

function getStickerCategory(
    ctx: ItemGeneratorContext,
    input: { sticker_material: string; tournament_event_id?: string }
) {
    const { sticker_material, tournament_event_id } = input;
    let category: string | undefined;
    let categoryToken: string | undefined;
    const [folder, subfolder] = sticker_material.split("/");
    if (folder === "alyx") {
        categoryToken = "#CSGO_crate_sticker_pack_hlalyx_capsule";
        category = findTranslation(ctx, categoryToken);
    }
    if (subfolder === "elemental_craft") {
        categoryToken = "#CSGO_crate_sticker_pack_stkr_craft_01_capsule";
        category = findTranslation(ctx, categoryToken);
    }
    if (folder !== undefined && UNCATEGORIZED_STICKERS.includes(folder)) {
        category = "Valve";
        categoryToken = undefined;
    }
    if (category === undefined) {
        categoryToken = `#CSGO_crate_sticker_pack_${folder}`;
        category = findTranslation(ctx, categoryToken);
    }
    if (category === undefined) {
        categoryToken = `#CSGO_crate_sticker_pack_${folder}_capsule`;
        category = findTranslation(ctx, categoryToken);
    }
    if (tournament_event_id !== undefined) {
        categoryToken = `#CSGO_Tournament_Event_NameShort_${tournament_event_id}`;
        category = findTranslation(ctx, categoryToken);
    }
    if (category === undefined) {
        categoryToken = `#CSGO_crate_sticker_pack_${subfolder}_capsule`;
        category = findTranslation(ctx, categoryToken);
    }
    if (category === undefined) {
        categoryToken = `#CSGO_sticker_crate_key_${folder}`;
        category = findTranslation(ctx, categoryToken);
    }
    return [ensure(category ?? "Valve"), categoryToken] as const;
}

function createStub(ctx: ItemGeneratorContext, name: string, descToken: string) {
    const id = getItemId(ctx, `stub_${name}`);
    addTranslation(ctx, id, "name", "#Rarity_Default");
    addTranslation(ctx, id, "desc", descToken);
    addItem(ctx, { id, type: CS2ItemType.Stub });
    return id;
}
