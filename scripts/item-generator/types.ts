/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Cs2Runtime } from "../cs2-tools/types.ts";
import { ItemGeneratorMode } from "./config.ts";
import { CS2Item, CS2ItemTranslationByLanguage, CS2StickerMarkup } from "../../src/economy-types.ts";
import { CS2ExportItem, CS2ExtendedItem, CS2GameItems, CS2Language } from "./source-types.ts";

export type PendingImageTask =
    | { kind: "regular"; localPath: string; filename: string }
    | { kind: "paint"; localPaths: [string, string][]; baseName: string; baseFilename: string }
    | { kind: "graffiti"; localPath: string; hexColor: string; filename: string }
    | { kind: "svg"; localPath: string; filename: string };

export type PendingModelTask = {
    base: string;
    crc: string;
    modelData: string;
    modelPlayer: string;
    directMaterials: Set<string>;
    materialFilenames: Set<string>;
    textureFilenames: Set<string>;
};

export type GlbMaterialExtras = {
    vmat?: {
        Name?: string;
    };
};

export type PaintKitRecord = {
    className: string;
    compositeMaterialPath?: string;
    descToken?: string;
    index: number;
    isLegacy: boolean;
    nameToken: string;
    rarityColorHex: string;
    wearMax: number;
    wearMin: number;
};

export type GraffitiTintRecord = {
    hexColor: string;
    id: number;
    name: string;
    nameToken: string;
};

export type ExternalCacheMetadata = {
    etag?: string;
    lastModified?: string;
    url: string;
};

export interface ItemGeneratorContext {
    mode: ItemGeneratorMode;
    cs2: Cs2Runtime;
    gameItemsAsText: string;
    gameItems: CS2GameItems["items_game"];
    csgoTranslationByLanguage: Record<string, CS2Language["lang"]["Tokens"]>;
    itemTranslationByLanguage: CS2ItemTranslationByLanguage;
    itemNames: Map<number, string>;
    itemSetImage: Record<string, string | undefined>;
    itemSetItemKey: Record<string, string | undefined>;
    itemsRaritiesColorHex: Record<string, string | undefined>;
    paintKitsRaritiesColorHex: Record<string, string | undefined>;
    raritiesColorHex: Record<string, string | undefined>;
    staticAssets: Record<string, string | undefined>;
    existingImages: Set<string>;
    neededVpkPaths: Set<string>;
    imagesToProcess: Map<string, PendingImageTask>;
    modelsToProcess: Map<string, PendingModelTask>;
    materialsToProcess: Set<string>;
    texturesToProcess: Set<string>;
    materialFilenameByPath: Map<string, string>;
    materialRefsByPath: Map<string, string[]>;
    baseItems: CS2ExtendedItem[];
    containerItems: Map<string, number>;
    items: Map<number, CS2ExtendedItem>;
    stickerMarkup: CS2StickerMarkup;
    paintKits: PaintKitRecord[];
    graffitiTints: GraffitiTintRecord[];
    keychainBaseId: number | undefined;
    allIdentifiers: string[];
    uniqueIdentifiers: string[];
    existingItemsById: Map<number, CS2Item>;
    workState: Record<string, unknown>;
}

export type EmittedItem = CS2ExportItem;
