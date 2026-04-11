/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, test } from "vitest";
import { CS2ItemType } from "../../../src/economy-types.ts";
import { type ItemGeneratorContext } from "../types.ts";
import { hydrateExistingModelFields } from "./build.ts";

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
    } as ItemGeneratorContext;
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

    test("does not copy known values in full mode", () => {
        const item = { id: 1, type: CS2ItemType.Weapon };
        hydrateExistingModelFields(createContext("full"), item);
        expect(item).toEqual({ id: 1, type: CS2ItemType.Weapon });
    });
});
