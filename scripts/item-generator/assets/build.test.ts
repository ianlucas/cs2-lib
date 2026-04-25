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
    assertGltfMeshoptCompressionRangesInBounds,
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

            const { bin, json } = parseTestGlb(await readFile(glbPath));
            expect(json.images).toEqual([{ mimeType: "image/webp", bufferView: 1 }]);
            expect(json.bufferViews).toHaveLength(2);
            expect(json.bufferViews[0]).toEqual({ buffer: 0, byteOffset: 0, byteLength: png.byteLength });
            expect(json.bufferViews[1]).toMatchObject({
                buffer: 0,
                byteOffset: Math.ceil(png.byteLength / 4) * 4
            });
            expect(json.bufferViews[1].byteLength).toBeGreaterThan(0);
            expect(json.buffers).toEqual([{ byteLength: bin.byteLength }]);
            expect(json.extensionsRequired).toContain("EXT_texture_webp");
            expect(json.extensionsUsed).toContain("EXT_texture_webp");
            expect(json.textures[0].extensions.EXT_texture_webp).toEqual({ source: 0 });
        } finally {
            await rm(dir, { force: true, recursive: true });
        }
    });

    test("preserves meshopt compression ranges when embedding WebP images", async () => {
        const dir = await mkdtemp(join(tmpdir(), "cs2-lib-glb-"));
        try {
            const glbPath = join(dir, "model.glb");
            const png = await sharp({
                create: {
                    background: { alpha: 1, b: 255, g: 0, r: 0 },
                    channels: 4,
                    height: 1,
                    width: 1
                }
            })
                .png()
                .toBuffer();
            const meshoptData = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
            const originalBin = Buffer.concat([padTestBuffer(png, 0), meshoptData]);
            const meshoptByteOffset = Math.ceil(png.byteLength / 4) * 4;
            await writeFile(
                glbPath,
                writeTestGlb(
                    {
                        asset: { version: "2.0" },
                        buffers: [{ byteLength: originalBin.byteLength }],
                        bufferViews: [
                            { buffer: 0, byteOffset: 0, byteLength: png.byteLength },
                            {
                                buffer: 0,
                                byteOffset: 0,
                                byteLength: 24,
                                extensions: {
                                    EXT_meshopt_compression: {
                                        buffer: 0,
                                        byteOffset: meshoptByteOffset,
                                        byteLength: meshoptData.byteLength,
                                        byteStride: 12,
                                        count: 2,
                                        mode: "ATTRIBUTES"
                                    }
                                }
                            }
                        ],
                        extensionsRequired: ["EXT_meshopt_compression"],
                        extensionsUsed: ["EXT_meshopt_compression"],
                        images: [{ bufferView: 0, mimeType: "image/png" }],
                        textures: [{ source: 0 }]
                    },
                    originalBin
                )
            );

            await embedOptimizedWebpTexturesInGlb(glbPath);

            const { bin, json } = parseTestGlb(await readFile(glbPath));
            expect(bin.subarray(meshoptByteOffset, meshoptByteOffset + meshoptData.byteLength)).toEqual(meshoptData);
            expect(json.bufferViews[1].extensions.EXT_meshopt_compression).toMatchObject({
                byteOffset: meshoptByteOffset,
                byteLength: meshoptData.byteLength
            });
            expect(json.images).toEqual([{ mimeType: "image/webp", bufferView: 2 }]);
            expect(json.bufferViews[2].byteOffset).toBeGreaterThanOrEqual(originalBin.byteLength);
            assertGltfMeshoptCompressionRangesInBounds(json, bin.byteLength, "model.glb");
        } finally {
            await rm(dir, { force: true, recursive: true });
        }
    });

    test("rejects out-of-bounds meshopt compression ranges", () => {
        expect(() =>
            assertGltfMeshoptCompressionRangesInBounds(
                {
                    bufferViews: [
                        {
                            extensions: {
                                EXT_meshopt_compression: {
                                    byteOffset: 12,
                                    byteLength: 8
                                }
                            }
                        }
                    ]
                },
                16,
                "weapon.glb"
            )
        ).toThrow("Out-of-bounds EXT_meshopt_compression range in 'weapon.glb' bufferView 0: 12+8 > 16");
    });
});

function parseTestGlb(buffer: Buffer): { bin: Buffer; json: any } {
    const jsonChunkLength = buffer.readUInt32LE(12);
    const binChunkOffset = 20 + jsonChunkLength;
    const binChunkLength = buffer.readUInt32LE(binChunkOffset);
    return {
        bin: buffer.subarray(binChunkOffset + 8, binChunkOffset + 8 + binChunkLength),
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
