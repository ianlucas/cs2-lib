/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, test } from "vitest";
import { type CS2Item, CS2ItemType } from "../../../src/economy-types.ts";
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

    test("queues the sticker preview model on the sticker stub in full mode", async () => {
        const ctx = createStickerParsingContext();

        await parseStickers(ctx);

        const stub = ctx.items.get(0);
        const sticker = [...ctx.items.values()].find((item) => item.type === CS2ItemType.Sticker);
        expect(stub).toMatchObject({
            id: 0,
            modelData: "/models/sticker_preview_mesh_model123.json",
            modelPlayer: "/models/sticker_preview_mesh_model123.glb",
            type: CS2ItemType.Stub
        });
        expect(ctx.modelsToProcess.get("stickers/dev/sticker_preview_mesh.vmdl_c")).toMatchObject({
            base: "sticker_preview_mesh",
            crc: "model123",
            modelData: "/models/sticker_preview_mesh_model123.json",
            modelPlayer: "/models/sticker_preview_mesh_model123.glb"
        });
        expect(sticker?.modelData).toBeUndefined();
        expect(sticker?.modelPlayer).toBeUndefined();
    });

    test("fails full-mode sticker parsing when the sticker preview model is missing", async () => {
        const ctx = createStickerParsingContext({ includeModel: false });

        await expect(parseStickers(ctx)).rejects.toThrow(
            "Unable to resolve model 'stickers/dev/sticker_preview_mesh.vmdl' for 'sticker' stub."
        );
    });

    test("reuses existing sticker stub model fields in limited mode", async () => {
        const ctx = createStickerParsingContext({
            existingItemsById: new Map([
                [
                    0,
                    {
                        id: 0,
                        modelData: "/models/existing-sticker.json",
                        modelPlayer: "/models/existing-sticker.glb",
                        type: CS2ItemType.Stub
                    }
                ]
            ]),
            includeModel: false,
            mode: "limited"
        });

        await parseStickers(ctx);

        expect(ctx.items.get(0)).toMatchObject({
            modelData: "/models/existing-sticker.json",
            modelPlayer: "/models/existing-sticker.glb"
        });
        expect(ctx.modelsToProcess.size).toBe(0);
    });

    test("leaves sticker stub model fields unset in limited mode when no existing fields are available", async () => {
        const ctx = createStickerParsingContext({ includeModel: false, mode: "limited" });

        await parseStickers(ctx);

        expect(ctx.items.get(0)).toMatchObject({
            id: 0,
            type: CS2ItemType.Stub
        });
        expect(ctx.items.get(0)?.modelData).toBeUndefined();
        expect(ctx.items.get(0)?.modelPlayer).toBeUndefined();
        expect(ctx.modelsToProcess.size).toBe(0);
    });
});

function createStickerParsingContext({
    existingItemsById = new Map(),
    includeModel = true,
    mode = "full"
}: {
    existingItemsById?: Map<number, CS2Item>;
    includeModel?: boolean;
    mode?: ItemGeneratorContext["mode"];
} = {}): ItemGeneratorContext {
    const vpkIndex = new Map([
        ["stickers/columbus2016/sig_s1mple.vmat_c", { crc: "abc123", fnumber: "1" }],
        ["panorama/images/econ/stickers/columbus2016/sig_s1mple_png.png", { crc: "img123", fnumber: "1" }],
        ["panorama/images/econ/stickers/columbus2016/sig_s1mple_1355_37_png.png", { crc: "key123", fnumber: "1" }]
    ]);
    if (includeModel) {
        vpkIndex.set("stickers/dev/sticker_preview_mesh.vmdl_c", { crc: "model123", fnumber: "1" });
    }
    return {
        mode,
        cs2: {
            vpkIndex
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
        existingItemsById,
        imagesToProcess: new Map(),
        itemsRaritiesColorHex: {},
        items: new Map(),
        itemNames: new Map(),
        materialsToProcess: new Set(),
        modelsToProcess: new Map(),
        neededVpkPaths: new Set(),
        paintKitsRaritiesColorHex: {},
        raritiesColorHex: {
            default: "#b0c3d9",
            rare: "#4b69ff"
        }
    } as unknown as ItemGeneratorContext;
}
