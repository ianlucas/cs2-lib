/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, test } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import sharp from "sharp";
import { type ItemGeneratorContext } from "../types.ts";
import {
    addTextureToProcess,
    assertNoExternalGltfImageUris,
    buildGltfpackArgs,
    embedOptimizedWebpTexturesInGlb
} from "./build.ts";

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
    test("builds gltfpack args with meshopt compression", () => {
        expect(buildGltfpackArgs("input.glb", "output.glb")).toEqual([
            "-i",
            "input.glb",
            "-o",
            "output.glb",
            "-cc",
            "-ke",
            "-km",
            "-kn"
        ]);
    });

    test("rejects optimized GLB JSON with external texture URIs", () => {
        expect(() =>
            assertNoExternalGltfImageUris(
                {
                    images: [{ uri: "weapon_color.webp" }, { uri: "data:image/webp;base64,AAAA" }, { bufferView: 0 }]
                },
                "weapon.glb"
            )
        ).toThrow("External GLB texture URI found in 'weapon.glb': weapon_color.webp");
    });

    test("embeds GLB images as WebP buffer views", async () => {
        const dir = await mkdtemp(join(tmpdir(), "cs2-lib-glb-"));
        try {
            const glbPath = join(dir, "model.glb");
            const png = await sharp({
                create: {
                    background: { alpha: 1, b: 0, g: 0, r: 255 },
                    channels: 4,
                    height: 1,
                    width: 1
                }
            })
                .png()
                .toBuffer();
            await writeFile(
                glbPath,
                writeTestGlb(
                    {
                        asset: { version: "2.0" },
                        buffers: [{ byteLength: png.byteLength }],
                        bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: png.byteLength }],
                        images: [{ bufferView: 0, mimeType: "image/png" }],
                        textures: [{ source: 0 }]
                    },
                    png
                )
            );
            await embedOptimizedWebpTexturesInGlb(glbPath);

            const { json } = parseTestGlb(await readFile(glbPath));
            expect(json.images).toEqual([{ mimeType: "image/webp", bufferView: 0 }]);
            expect(json.bufferViews).toHaveLength(1);
            expect(json.extensionsRequired).toContain("EXT_texture_webp");
            expect(json.extensionsUsed).toContain("EXT_texture_webp");
            expect(json.textures[0].extensions.EXT_texture_webp).toEqual({ source: 0 });
        } finally {
            await rm(dir, { force: true, recursive: true });
        }
    });
});

function parseTestGlb(buffer: Buffer): { json: any } {
    const jsonChunkLength = buffer.readUInt32LE(12);
    return {
        json: JSON.parse(buffer.subarray(20, 20 + jsonChunkLength).toString("utf8").trimEnd())
    };
}

function writeTestGlb(json: any, bin: Buffer): Buffer {
    const jsonBuffer = padTestBuffer(Buffer.from(JSON.stringify(json), "utf8"), 0x20);
    const binBuffer = padTestBuffer(bin, 0);
    const header = Buffer.alloc(12);
    header.writeUInt32LE(0x46546c67, 0);
    header.writeUInt32LE(2, 4);
    header.writeUInt32LE(12 + 8 + jsonBuffer.byteLength + 8 + binBuffer.byteLength, 8);
    const jsonHeader = Buffer.alloc(8);
    jsonHeader.writeUInt32LE(jsonBuffer.byteLength, 0);
    jsonHeader.writeUInt32LE(0x4e4f534a, 4);
    const binHeader = Buffer.alloc(8);
    binHeader.writeUInt32LE(binBuffer.byteLength, 0);
    binHeader.writeUInt32LE(0x004e4942, 4);
    return Buffer.concat([header, jsonHeader, jsonBuffer, binHeader, binBuffer]);
}

function padTestBuffer(buffer: Buffer, paddingByte: number): Buffer {
    const paddedLength = Math.ceil(buffer.byteLength / 4) * 4;
    if (paddedLength === buffer.byteLength) {
        return buffer;
    }
    return Buffer.concat([buffer, Buffer.alloc(paddedLength - buffer.byteLength, paddingByte)]);
}
