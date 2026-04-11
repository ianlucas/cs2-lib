/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, test } from "vitest";
import { CS2ItemType } from "../../../src/economy-types.ts";
import { type ItemGeneratorContext } from "../types.ts";
import { getStickerCompositeMaterial, hydrateExistingModelFields, parseStickers } from "./build.ts";

function createContext(mode: ItemGeneratorContext["mode"]): ItemGeneratorContext {
    return {
        mode,
        existingItemsById: new Map([
            [
                1,
                {
                    compositeMaterial: "/materials/known.vcompmat.json",
                    id: 1,
                    modelData: "/models/known.json",
                    modelPlayer: "/models/known.glb",
                    stickerMax: 4,
                    stickerMaxForLegacy: 2,
                    type: CS2ItemType.Weapon
                }
            ]
        ])
    } as unknown as ItemGeneratorContext;
}

describe("hydrateExistingModelFields", () => {
    test("copies known composite material in limited mode", () => {
        const item = { id: 1, type: CS2ItemType.Weapon };
        hydrateExistingModelFields(createContext("limited"), item);
        expect(item).toMatchObject({
            compositeMaterial: "/materials/known.vcompmat.json",
            modelData: "/models/known.json",
            modelPlayer: "/models/known.glb",
            stickerMax: 4,
            stickerMaxForLegacy: 2
        });
    });

    test("does not overwrite current generated composite material", () => {
        const item = {
            compositeMaterial: "/materials/current.vcompmat.json",
            id: 1,
            type: CS2ItemType.Weapon
        };
        hydrateExistingModelFields(createContext("limited"), item);
        expect(item.compositeMaterial).toBe("/materials/current.vcompmat.json");
    });

    test("does not overwrite fields explicitly set to undefined", () => {
        const item = {
            compositeMaterial: undefined,
            id: 1,
            modelData: undefined,
            modelPlayer: undefined,
            stickerMax: undefined,
            stickerMaxForLegacy: undefined,
            type: CS2ItemType.Weapon
        };
        hydrateExistingModelFields(createContext("limited"), item);
        expect(item).toEqual({
            compositeMaterial: undefined,
            id: 1,
            modelData: undefined,
            modelPlayer: undefined,
            stickerMax: undefined,
            stickerMaxForLegacy: undefined,
            type: CS2ItemType.Weapon
        });
    });

    test("keeps paint-cleared parent fields while hydrating omitted paint fields", () => {
        const item = {
            baseId: 10,
            id: 1,
            modelData: undefined,
            modelPlayer: undefined,
            stickerMax: undefined,
            stickerMaxForLegacy: undefined,
            type: CS2ItemType.Weapon
        };
        hydrateExistingModelFields(createContext("limited"), item);
        expect(item).toEqual({
            baseId: 10,
            compositeMaterial: "/materials/known.vcompmat.json",
            id: 1,
            modelData: undefined,
            modelPlayer: undefined,
            stickerMax: undefined,
            stickerMaxForLegacy: undefined,
            type: CS2ItemType.Weapon
        });
    });

    test("does not copy known values in full mode", () => {
        const item = { id: 1, type: CS2ItemType.Weapon };
        hydrateExistingModelFields(createContext("full"), item);
        expect(item).toEqual({ id: 1, type: CS2ItemType.Weapon });
    });
});

describe("sticker material extraction", () => {
    test("builds a full-mode sticker material URI and queues the VMAT once", () => {
        const ctx = {
            mode: "full",
            cs2: {
                vpkIndex: new Map([["stickers/columbus2016/sig_s1mple.vmat_c", { crc: "abc123", fnumber: "1" }]])
            },
            materialsToProcess: new Set<string>()
        } as unknown as ItemGeneratorContext;

        expect(getStickerCompositeMaterial(ctx, "columbus2016/sig_s1mple")).toBe(
            "/materials/sig_s1mple_abc123.vmat.json"
        );
        expect([...ctx.materialsToProcess]).toEqual(["stickers/columbus2016/sig_s1mple.vmat"]);
    });

    test("does not resolve new sticker materials in limited mode", () => {
        const ctx = {
            mode: "limited",
            materialsToProcess: new Set<string>()
        } as unknown as ItemGeneratorContext;

        expect(getStickerCompositeMaterial(ctx, "columbus2016/sig_s1mple")).toBeUndefined();
        expect(ctx.materialsToProcess.size).toBe(0);
    });

    test("copies known sticker composite material in limited mode", () => {
        const item = { id: 1, type: CS2ItemType.Sticker };
        hydrateExistingModelFields(createContext("limited"), item);
        expect(item).toMatchObject({
            compositeMaterial: "/materials/known.vcompmat.json"
        });
    });

    test("adds composite material only to the sticker item, not the display-case keychain", async () => {
        const ctx = createStickerParsingContext();

        await parseStickers(ctx);

        const items = [...ctx.items.values()];
        const sticker = items.find((item) => item.type === CS2ItemType.Sticker && item.def === 1209);
        const keychain = items.find((item) => item.type === CS2ItemType.Keychain);
        expect(sticker?.compositeMaterial).toBe("/materials/sig_s1mple_abc123.vmat.json");
        expect(keychain).toBeDefined();
        expect(keychain?.compositeMaterial).toBeUndefined();
    });
});

function createStickerParsingContext(): ItemGeneratorContext {
    return {
        mode: "full",
        cs2: {
            vpkIndex: new Map([
                ["stickers/columbus2016/sig_s1mple.vmat_c", { crc: "abc123", fnumber: "1" }],
                ["panorama/images/econ/stickers/columbus2016/sig_s1mple_png.png", { crc: "img123", fnumber: "1" }],
                [
                    "panorama/images/econ/stickers/columbus2016/sig_s1mple_1355_37_png.png",
                    { crc: "key123", fnumber: "1" }
                ]
            ])
        },
        gameItems: {
            sticker_kits: {
                "1": {
                    description_string: "#Sticker_Desc",
                    item_name: "#Sticker_Name",
                    item_rarity: "rare",
                    name: "s1mple",
                    sticker_material: "columbus2016/sig_s1mple"
                }
            }
        },
        csgoTranslationByLanguage: {
            english: {
                csgo_tool_sticker: "Sticker",
                csgo_tool_sticker_desc: "Apply this sticker.",
                keychain_kc_sticker_display_case: "Sticker Slab",
                keychain_kc_sticker_display_case_desc: "The sticker is safely sealed in this slab.",
                rarity_default: "Default",
                sticker_desc: "A sticker.",
                sticker_name: "s1mple"
            }
        },
        itemTranslationByLanguage: {
            english: {}
        },
        allIdentifiers: [],
        uniqueIdentifiers: [],
        containerItems: new Map(),
        existingImages: new Set(),
        existingItemsById: new Map(),
        imagesToProcess: new Map(),
        itemsRaritiesColorHex: {},
        items: new Map(),
        itemNames: new Map(),
        materialsToProcess: new Set(),
        neededVpkPaths: new Set(),
        paintKitsRaritiesColorHex: {},
        raritiesColorHex: {
            default: "#b0c3d9",
            rare: "#4b69ff"
        }
    } as unknown as ItemGeneratorContext;
}
