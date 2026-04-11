/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, test } from "vitest";
import {
    getCompositeMaterialFilename,
    getPaintCompositeMaterialPath,
    getTextureFilename,
    getVmatFilename,
    normalizeMaterialResourcePath,
    patchMaterialResourceReferences,
    toCompiledMaterialResourcePath
} from "./material-paths.ts";

describe("material path helpers", () => {
    test("resolves explicit and legacy paint composite material paths", () => {
        expect(getPaintCompositeMaterialPath("aq_oiled", "weapons/paints/custom/foo.vcompmat")).toBe(
            "weapons/paints/custom/foo.vcompmat"
        );
        expect(getPaintCompositeMaterialPath("aq_oiled")).toBe("weapons/paints/legacy/aq_oiled.vcompmat");
    });

    test("normalizes resource prefixes and compiled paths", () => {
        expect(normalizeMaterialResourcePath("resource:materials\\foo.vtex")).toBe("materials/foo.vtex");
        expect(normalizeMaterialResourcePath("resource_name:materials/foo.vmat")).toBe("materials/foo.vmat");
        expect(toCompiledMaterialResourcePath("Materials/Foo.vmat")).toBe("materials/foo.vmat_c");
        expect(toCompiledMaterialResourcePath("weapons/paints/foo.vcompmat_c")).toBe(
            "weapons/paints/foo.vcompmat_c"
        );
    });

    test("builds CRC-appended output filenames", () => {
        expect(getCompositeMaterialFilename("weapons/paints/legacy/aq_oiled.vcompmat", "abc123")).toBe(
            "aq_oiled_abc123.vcompmat.json"
        );
        expect(getVmatFilename("materials/models/weapons/customization/paints/vmats/aq_oiled.vmat", "def456")).toBe(
            "aq_oiled_def456.vmat.json"
        );
        expect(
            getTextureFilename(
                "materials/models/weapons/customization/paints/antiqued/oiled_psd_9f35e709.vtex",
                "789abc",
                ".webp"
            )
        ).toBe("oiled_psd_9f35e709_789abc.webp");
    });

    test("rewrites nested material references", () => {
        const patched = patchMaterialResourceReferences(
            {
                include: "weapons/paints/legacy/_shared.vcompmat",
                material: "resource_name:materials/foo.vmat",
                nested: [{ texture: "resource:materials/foo_color.vtex" }]
            },
            (path) => `/materials/${path.split("/").pop()}.json`,
            (path) => `/materials/${path.split("/").pop()}.json`,
            (path) => `/textures/${path.split("/").pop()}.webp`
        );
        expect(patched).toEqual({
            include: "/materials/_shared.vcompmat.json",
            material: "/materials/foo.vmat.json",
            nested: [{ texture: "/textures/foo_color.vtex.webp" }]
        });
    });
});
