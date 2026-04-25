/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, test } from "vitest";
import { Document, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import sharp from "sharp";
import { type ItemGeneratorContext } from "../types.ts";
import { addTextureToProcess, optimizeModelGlb } from "./build.ts";

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

describe("model GLB optimization", () => {
    test("optimizes embedded model textures as WebP without resizing", async () => {
        const dir = await mkdtemp(join(tmpdir(), "cs2-lib-glb-"));
        try {
            const glbPath = join(dir, "model.glb");
            const io = createTestGlbIO();
            const png = await sharp({
                create: {
                    background: { alpha: 1, b: 255, g: 0, r: 0 },
                    channels: 4,
                    height: 9,
                    width: 13
                }
            })
                .png()
                .toBuffer();
            const document = new Document();
            document.createBuffer();
            document.createTexture("paint").setImage(png).setMimeType("image/png").setURI("paint.png");
            await writeFile(glbPath, await io.writeBinary(document));

            await optimizeModelGlb(glbPath);

            const optimized = await io.read(glbPath);
            const texture = optimized.getRoot().listTextures()[0]!;
            const image = texture.getImage()!;
            const metadata = await sharp(image).metadata();
            expect(texture.getMimeType()).toBe("image/webp");
            expect(texture.getURI()).toBe("");
            expect(metadata.width).toBe(13);
            expect(metadata.height).toBe(9);
            expect(optimized.getRoot().listExtensionsUsed().map((extension) => extension.extensionName)).toContain(
                "EXT_texture_webp"
            );
        } finally {
            await rm(dir, { force: true, recursive: true });
        }
    });

    test("keeps EXR model textures unchanged", async () => {
        const dir = await mkdtemp(join(tmpdir(), "cs2-lib-glb-"));
        try {
            const glbPath = join(dir, "model.glb");
            const io = createTestGlbIO();
            const exr = Buffer.from([0x76, 0x2f, 0x31, 0x01, 0x02, 0x03, 0x04, 0x05]);
            const document = new Document();
            document.createBuffer();
            document.createTexture("roughness").setImage(exr).setMimeType("image/exr").setURI("roughness.exr");
            await writeFile(glbPath, await io.writeBinary(document));

            await optimizeModelGlb(glbPath);

            const optimized = await io.read(glbPath);
            const texture = optimized.getRoot().listTextures()[0]!;
            expect(texture.getMimeType()).toBe("image/exr");
            expect(Buffer.from(texture.getImage()!)).toEqual(exr);
            expect(optimized.getRoot().listExtensionsUsed().map((extension) => extension.extensionName)).not.toContain(
                "EXT_texture_webp"
            );
        } finally {
            await rm(dir, { force: true, recursive: true });
        }
    });
});

function createTestGlbIO() {
    return new NodeIO().registerExtensions(ALL_EXTENSIONS);
}
