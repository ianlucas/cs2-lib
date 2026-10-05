/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, test } from "vitest";
import { CS2Economy } from "./economy.ts";
import { CS2_ITEMS } from "./items.ts";
import { CS2_MODEL_MATERIALS } from "./model-materials.ts";

CS2Economy.load({ items: CS2_ITEMS });

const usedModelPaths = new Set(
    CS2Economy.itemsAsArray.map((item) => item.getModelPath()).filter((path) => path !== undefined)
);

describe.skipIf(Object.keys(CS2_MODEL_MATERIALS).length === 0)("CS2_MODEL_MATERIALS", () => {
    test("every model an item uses has its mesh materials", () => {
        expect([...usedModelPaths].filter((path) => !Object.hasOwn(CS2_MODEL_MATERIALS, path))).toEqual([]);
    });

    test("every model with mesh materials is used by an item", () => {
        expect(Object.keys(CS2_MODEL_MATERIALS).filter((path) => !usedModelPaths.has(path))).toEqual([]);
    });
});
