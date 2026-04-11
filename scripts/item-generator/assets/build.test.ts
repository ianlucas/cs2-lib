/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, test } from "vitest";
import { type ItemGeneratorContext } from "../types.ts";
import { addTextureToProcess } from "./build.ts";

describe("material texture processing", () => {
    test("deduplicates shared texture references by normalized resolved VTEX path", () => {
        const ctx = {
            cs2: {
                vpkIndex: new Map([
                    [
                        "materials/default/stickers/sticker_default_scratches_psd_a9ad199b.vtex_c",
                        { crc: "1", fnumber: "1" }
                    ]
                ])
            },
            texturesToProcess: new Set<string>()
        } as ItemGeneratorContext;

        addTextureToProcess(ctx, "resource:materials/default/stickers/sticker_default_scratches_psd_a9ad199b.vtex");
        addTextureToProcess(ctx, "Materials/Default/Stickers/Sticker_Default_Scratches_Psd_A9Ad199B.vtex");

        expect([...ctx.texturesToProcess]).toEqual([
            "materials/default/stickers/sticker_default_scratches_psd_a9ad199b.vtex"
        ]);
    });
});
