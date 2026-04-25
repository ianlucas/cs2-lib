/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as BunnyStorageSDK from "@bunny.net/storage-sdk";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTTextureWebP } from "@gltf-transform/extensions";
import { createHash } from "crypto";
import { createReadStream } from "fs";
import { copyFile, mkdir, readdir, rename, writeFile } from "fs/promises";
import { basename, dirname, join } from "path";
import sharp from "sharp";
import { Readable } from "stream";
import { ensure } from "../../../src/utils.ts";
import { decompileAssets, decompileModelAssets } from "../../cs2-tools/decompile.ts";
import { ensureAssetPackages } from "../../cs2-tools/depot.ts";
import {
    extractCompositeMaterialMetadata,
    extractMaterialMetadata,
    extractModelMetadata
} from "../../cs2-tools/extract.ts";
import { STORAGE_ACCESS_KEY, STORAGE_ZONE } from "../../env.ts";
import { PromiseQueue, exists, getFileSha256, log, rmIfExists } from "../../utils.ts";
import {
    CDN_UPLOAD_CONCURRENCY,
    DECOMPILED_DIR,
    ITEM_GENERATOR_BUILD_DIR,
    ITEM_GENERATOR_CACHE_DIR,
    ITEM_GENERATOR_WORKDIR_DIR,
    OUTPUT_DIR,
    OUTPUT_WEBP_OPTIONS,
    STATIC_IMAGES_DIR
} from "../config.ts";
import { formatCount } from "../logging.ts";
import { type GlbMaterialExtras, type ItemGeneratorContext, type PendingModelTask } from "../types.ts";
import {
    getTextureFilename,
    normalizeMaterialResourcePath,
    patchMaterialResourceReferences,
    resolveMaterialResourcePath,
    toCompiledMaterialResourcePath
} from "./material-paths.ts";

const MODEL_TEXTURE_FORMATS_TO_OPTIMIZE = /^image\/(?:jpeg|png|webp)$/;

export async function prepareWorkspace(ctx: ItemGeneratorContext): Promise<void> {
    await mkdir(ITEM_GENERATOR_WORKDIR_DIR, { recursive: true });
    await mkdir(ITEM_GENERATOR_CACHE_DIR, { recursive: true });
    await mkdir(ITEM_GENERATOR_BUILD_DIR, { recursive: true });
    await rmIfExists(OUTPUT_DIR);
    ctx.staticAssets = {};
    for (const folder of ["images", "materials", "models", "textures"]) {
        await mkdir(join(OUTPUT_DIR, folder), { recursive: true });
    }
    for (const filename of await readdir(STATIC_IMAGES_DIR)) {
        const path = join(STATIC_IMAGES_DIR, filename);
        if (filename.endsWith(".png")) {
            const key = `/images/${filename}`;
            const value = await copyAndOptimizeImage(path, "/images/{sha256}.webp");
            ctx.staticAssets[key] = value;
        } else {
            await copyFile(path, join(OUTPUT_DIR, "images", filename));
        }
    }
    for (const item of ctx.existingItemsById.values()) {
        if (item.image !== undefined) {
            ctx.existingImages.add(item.image);
        }
        if (item.collectionImage !== undefined) {
            ctx.existingImages.add(item.collectionImage);
        }
        if (item.specialsImage !== undefined) {
            ctx.existingImages.add(item.specialsImage);
        }
    }
}

export async function processAssets(ctx: ItemGeneratorContext): Promise<void> {
    if (ctx.neededVpkPaths.size > 0) {
        const vpkPaths = Array.from(ctx.neededVpkPaths);
        log(`Resolving ${formatCount(vpkPaths.length, "VPK asset")}...`);
        await ensureAssetPackages(ctx.cs2, vpkPaths);
        await decompileAssets(ctx.cs2, vpkPaths);
    }
    await processImages(ctx);
    if (ctx.mode === "full") {
        await preProcessCompositeMaterials(ctx);
        await processModels(ctx);
        await preProcessMaterials(ctx);
        await processMaterialTextures(ctx);
        await writeMaterialMetadata(ctx);
    }
}

async function processImages(ctx: ItemGeneratorContext) {
    if (ctx.imagesToProcess.size === 0) {
        return;
    }
    const kindCounts = Array.from(ctx.imagesToProcess.values()).reduce(
        (counts, task) => {
            counts[task.kind]++;
            return counts;
        },
        { graffiti: 0, paint: 0, regular: 0, svg: 0 }
    );
    const kinds = Object.entries(kindCounts)
        .filter(([_, count]) => count > 0)
        .map(([kind, count]) => `${count} ${kind}`)
        .join(", ");
    log(`Processing ${formatCount(ctx.imagesToProcess.size, "image task")} (${kinds})...`);
    const queue = new PromiseQueue(Math.max(2, ctx.imagesToProcess.size > 8 ? 8 : ctx.imagesToProcess.size));
    for (const task of ctx.imagesToProcess.values()) {
        if (task.kind === "regular") {
            queue.push(async () => {
                await sharp(task.localPath).webp(OUTPUT_WEBP_OPTIONS).toFile(join(OUTPUT_DIR, task.filename));
            });
            continue;
        }
        if (task.kind === "paint") {
            queue.push(async () => {
                for (const [src, suffix] of task.localPaths) {
                    await sharp(src)
                        .webp(OUTPUT_WEBP_OPTIONS)
                        .toFile(join(OUTPUT_DIR, `/images/${task.baseName}_${suffix}.webp`));
                }
                await sharp(ensure(task.localPaths[0])[0])
                    .webp(OUTPUT_WEBP_OPTIONS)
                    .toFile(join(OUTPUT_DIR, task.baseFilename));
            });
            continue;
        }
        if (task.kind === "graffiti") {
            queue.push(async () => {
                await colorizeGraffitiImage(task.localPath, task.hexColor, task.filename);
            });
            continue;
        }
        queue.push(async () => {
            await sharp(task.localPath)
                .resize(256, 198, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
                .webp(OUTPUT_WEBP_OPTIONS)
                .toFile(join(OUTPUT_DIR, task.filename));
        });
    }
    await queue.waitForIdle();
    log(`Processed ${formatCount(ctx.imagesToProcess.size, "image task")}.`);
}

async function processModels(ctx: ItemGeneratorContext) {
    if (ctx.modelsToProcess.size === 0) {
        return;
    }
    log(`Processing ${formatCount(ctx.modelsToProcess.size, "model")}...`);
    await decompileModelAssets(ctx.cs2, Array.from(ctx.modelsToProcess.keys()));
    await extractModelData(ctx);
    await preProcessMaterials(ctx);
    for (const [vpkPath, model] of ctx.modelsToProcess) {
        const modelDir = join(DECOMPILED_DIR, dirname(vpkPath));
        const base = basename(vpkPath, ".vmdl_c");
        const glbPath = join(modelDir, `${base}.glb`);
        await patchGlbAssets(ctx, glbPath);
        await optimizeModelGlb(glbPath);
        const dependencyHash = getDependencyHash([
            await getFileSha256(glbPath),
            await getFileSha256(join(OUTPUT_DIR, model.modelData))
        ]);
        const versionedBase = `${model.base}_${model.crc}_${dependencyHash}`;
        const versionedModelPlayer = `/models/${versionedBase}.glb`;
        const versionedModelData = `/models/${versionedBase}.json`;
        await rename(glbPath, join(OUTPUT_DIR, versionedModelPlayer));
        await rename(join(OUTPUT_DIR, model.modelData), join(OUTPUT_DIR, versionedModelData));
        updateModelAssetReferences(ctx, model, versionedModelPlayer, versionedModelData);
    }
    log(`Processed ${formatCount(ctx.modelsToProcess.size, "model")}.`);
}

async function extractModelData(ctx: ItemGeneratorContext) {
    const entries = Array.from(ctx.modelsToProcess.entries()).map(([vpkPath, model]) => ({
        vpkPath,
        targetFilename: model.modelPlayer
    }));
    const results = await extractModelMetadata(ctx.cs2, entries);
    for (const [index, result] of results.entries()) {
        const { filename, data, materials } = result;
        const { vpkPath } = ensure(entries[index]);
        const model = ensure(ctx.modelsToProcess.get(vpkPath));
        for (const material of materials) {
            ctx.materialsToProcess.add(material);
            model.directMaterials.add(material);
        }
        await writeFile(join(OUTPUT_DIR, "models", filename), JSON.stringify(data), "utf-8");
        const stickerMarkup = data?.m_modelInfo?.m_keyValueText?.StickerMarkup;
        if (Array.isArray(stickerMarkup)) {
            const stickerMax = stickerMarkup.filter((sticker: { Mesh: string }) => sticker.Mesh === "body_hd").length;
            const stickerMaxForLegacy = stickerMarkup.length - stickerMax;
            const modelDataPath = `/models/${filename}`;
            for (const item of ctx.items.values()) {
                if (item.modelData === modelDataPath) {
                    item.stickerMax = stickerMax;
                    item.stickerMaxForLegacy = stickerMaxForLegacy;
                }
            }
        }
    }
}

async function preProcessCompositeMaterials(ctx: ItemGeneratorContext) {
    const pending = Array.from(ctx.compositeMaterialsToProcess).filter(
        (vcompmatPath) => !ctx.compositeMaterialDataByPath.has(vcompmatPath)
    );
    if (pending.length === 0) {
        return;
    }
    log(`Extracting ${formatCount(pending.length, "composite material")}...`);
    const processed = new Set<string>(ctx.compositeMaterialDataByPath.keys());
    const queue = new Set<string>(pending);
    while (queue.size > 0) {
        const batch = Array.from(queue);
        queue.clear();
        requireVpkEntries(ctx, batch);
        const results = await extractCompositeMaterialMetadata(ctx.cs2, batch);
        for (const { compositeMaterialRefs, data, filename, vcompmatPath, vmatRefs, vtexRefs } of results) {
            processed.add(vcompmatPath);
            ctx.compositeMaterialDataByPath.set(vcompmatPath, data);
            ctx.compositeMaterialFilenameByPath.set(vcompmatPath, filename);
            ctx.compositeMaterialRefsByPath.set(vcompmatPath, compositeMaterialRefs);
            for (const vmat of vmatRefs) {
                ctx.materialsToProcess.add(resolveMaterialResourcePath(ctx.cs2, vmat));
            }
            for (const vtex of vtexRefs) {
                addTextureToProcess(ctx, vtex);
            }
            for (const child of compositeMaterialRefs) {
                const normalized = resolveMaterialResourcePath(ctx.cs2, child);
                ctx.compositeMaterialsToProcess.add(normalized);
                if (!processed.has(normalized) && !queue.has(normalized)) {
                    queue.add(normalized);
                }
            }
        }
    }
    log(
        `Extracted ${formatCount(processed.size, "composite material")} and found ${formatCount(ctx.materialsToProcess.size, "material reference")}.`
    );
}

function requireVpkEntries(ctx: ItemGeneratorContext, paths: Iterable<string>) {
    for (const path of paths) {
        resolveMaterialResourcePath(ctx.cs2, path);
    }
}

export function addTextureToProcess(ctx: ItemGeneratorContext, vtexPath: string): void {
    ctx.texturesToProcess.add(normalizeMaterialResourcePath(resolveMaterialResourcePath(ctx.cs2, vtexPath)));
}

async function preProcessMaterials(ctx: ItemGeneratorContext) {
    const pending = Array.from(ctx.materialsToProcess).filter((vmatPath) => !ctx.materialDataByPath.has(vmatPath));
    if (pending.length === 0) {
        return;
    }
    log(`Extracting ${formatCount(pending.length, "material")}...`);
    const processed = new Set<string>(ctx.materialDataByPath.keys());
    const queue = new Set<string>(pending);
    while (queue.size > 0) {
        const batch = Array.from(queue);
        queue.clear();
        requireVpkEntries(ctx, batch);
        const results = await extractMaterialMetadata(ctx.cs2, batch);
        for (const { vmatPath, filename, data, vtexRefs, vmatRefs } of results) {
            processed.add(vmatPath);
            ctx.materialFilenameByPath.set(vmatPath, filename);
            ctx.materialRefsByPath.set(vmatPath, vmatRefs);
            ctx.materialDataByPath.set(vmatPath, data);
            for (const vtex of vtexRefs) addTextureToProcess(ctx, vtex);
            for (const vmat of vmatRefs) {
                const normalized = resolveMaterialResourcePath(ctx.cs2, vmat);
                ctx.materialsToProcess.add(normalized);
                if (!processed.has(normalized) && !queue.has(normalized)) {
                    queue.add(normalized);
                }
            }
        }
    }
    log(
        `Extracted ${formatCount(processed.size, "material")} and found ${formatCount(ctx.texturesToProcess.size, "texture reference")}.`
    );
}

async function processMaterialTextures(ctx: ItemGeneratorContext) {
    const pending = Array.from(ctx.texturesToProcess).filter((vtexPath) => !ctx.textureFilenameByPath.has(vtexPath));
    if (pending.length === 0) {
        return;
    }
    log(`Processing ${formatCount(pending.length, "material texture")}...`);
    requireVpkEntries(ctx, pending);
    const compiledPaths = pending.map(toCompiledMaterialResourcePath);
    await ensureAssetPackages(ctx.cs2, compiledPaths);
    await decompileAssets(ctx.cs2, compiledPaths, { textureDecodeFlags: "none" });
    const queue = new PromiseQueue(Math.max(2, pending.length > 8 ? 8 : pending.length));
    for (const vtexPath of pending) {
        queue.push(async () => {
            const resolvedVtexPath = resolveMaterialResourcePath(ctx.cs2, vtexPath);
            const entry = ensure(ctx.cs2.vpkIndex.get(toCompiledMaterialResourcePath(resolvedVtexPath)));
            const base = join(DECOMPILED_DIR, dirname(resolvedVtexPath), basename(resolvedVtexPath, ".vtex"));
            const pngPath = `${base}.png`;
            const exrPath = `${base}.exr`;
            if (await exists(pngPath)) {
                const filename = getTextureFilename(resolvedVtexPath, entry.crc, ".webp");
                await sharp(pngPath)
                    .webp(OUTPUT_WEBP_OPTIONS)
                    .toFile(join(OUTPUT_DIR, "textures", filename));
                ctx.textureFilenameByPath.set(resolvedVtexPath, `/textures/${filename}`);
                return;
            }
            if (await exists(exrPath)) {
                const filename = getTextureFilename(resolvedVtexPath, entry.crc, ".exr");
                await rename(exrPath, join(OUTPUT_DIR, "textures", filename));
                ctx.textureFilenameByPath.set(resolvedVtexPath, `/textures/${filename}`);
                return;
            }
            throw new Error(`Unable to find decompiled texture output for '${resolvedVtexPath}'.`);
        });
    }
    await queue.waitForIdle();
    log(`Processed ${formatCount(pending.length, "material texture")}.`);
}

async function writeMaterialMetadata(ctx: ItemGeneratorContext) {
    const resolveCompositeMaterial = (path: string) => {
        const filename = ctx.compositeMaterialFilenameByPath.get(resolveMaterialResourcePath(ctx.cs2, path));
        return filename === undefined ? undefined : `/materials/${filename}`;
    };
    const resolveVmat = (path: string) => {
        const filename = ctx.materialFilenameByPath.get(resolveMaterialResourcePath(ctx.cs2, path));
        return filename === undefined ? undefined : `/materials/${filename}`;
    };
    const resolveTexture = (path: string) => ctx.textureFilenameByPath.get(resolveMaterialResourcePath(ctx.cs2, path));
    for (const [vcompmatPath, data] of ctx.compositeMaterialDataByPath) {
        if (data === null) {
            continue;
        }
        const filename = ensure(ctx.compositeMaterialFilenameByPath.get(vcompmatPath));
        const json = JSON.stringify(
            patchMaterialResourceReferences(data, resolveCompositeMaterial, resolveVmat, resolveTexture)
        );
        assertMaterialReferencesRewritten(json, filename);
        await writeFile(join(OUTPUT_DIR, "materials", filename), json, "utf-8");
    }
    for (const [vmatPath, data] of ctx.materialDataByPath) {
        if (data === null) {
            continue;
        }
        const filename = ensure(ctx.materialFilenameByPath.get(vmatPath));
        const json = JSON.stringify(
            patchMaterialResourceReferences(data, resolveCompositeMaterial, resolveVmat, resolveTexture)
        );
        assertMaterialReferencesRewritten(json, filename);
        await writeFile(join(OUTPUT_DIR, "materials", filename), json, "utf-8");
    }
}

function assertMaterialReferencesRewritten(json: string, filename: string) {
    const originalReference = json.match(/resource(?:_name)?:|\.vtex|\.vmat(?!\.json)|\.vcompmat(?!\.json)/);
    if (originalReference !== null) {
        throw new Error(`Unrewritten material reference '${originalReference[0]}' found in '${filename}'.`);
    }
}

function getDependencyHash(dependencies: Iterable<string>) {
    const hash = createHash("sha256");
    hash.update([...new Set(dependencies)].sort().join("\n"), "utf8");
    return hash.digest("hex").toLowerCase().slice(0, 8);
}

function updateModelAssetReferences(
    ctx: ItemGeneratorContext,
    model: PendingModelTask,
    modelPlayer: string,
    modelData: string
) {
    for (const item of ctx.items.values()) {
        if (item.modelPlayer === model.modelPlayer) {
            item.modelPlayer = modelPlayer;
        }
        if (item.modelData === model.modelData) {
            item.modelData = modelData;
        }
    }
    model.modelPlayer = modelPlayer;
    model.modelData = modelData;
}

function getMaterialName(ctx: ItemGeneratorContext, vmatPath: string) {
    const filename = ctx.materialFilenameByPath.get(vmatPath);
    return filename ? basename(filename, ".vmat.json") : undefined;
}

function createModelGlbIO(): NodeIO {
    return new NodeIO().registerExtensions(ALL_EXTENSIONS);
}

export async function optimizeModelGlb(glbPath: string): Promise<void> {
    const io = createModelGlbIO();
    const document = await io.read(glbPath);
    for (const texture of document.getRoot().listTextures()) {
        if (!MODEL_TEXTURE_FORMATS_TO_OPTIMIZE.test(texture.getMimeType())) {
            continue;
        }
        const image = texture.getImage();
        if (image === null) {
            continue;
        }
        const webp = await sharp(image).webp(OUTPUT_WEBP_OPTIONS).toBuffer();
        texture.setImage(webp).setMimeType("image/webp").setURI("");
    }
    if (
        document
            .getRoot()
            .listTextures()
            .some((texture) => texture.getMimeType() === "image/webp")
    ) {
        document.createExtension(EXTTextureWebP).setRequired(true);
    }
    await writeFile(glbPath, await io.writeBinary(document));
}

async function patchGlbAssets(ctx: ItemGeneratorContext, glbPath: string) {
    const io = createModelGlbIO();
    const document = await io.read(glbPath);
    for (const material of document.getRoot().listMaterials()) {
        const extras = material.getExtras() as GlbMaterialExtras | null;
        const vmatPath = extras?.vmat?.Name;
        if (typeof vmatPath !== "string") {
            continue;
        }
        const name = getMaterialName(ctx, vmatPath.replace(/\\/g, "/"));
        if (name !== undefined) {
            material.setName(name);
        }
    }
    await writeFile(glbPath, await io.writeBinary(document));
}

async function colorizeGraffitiImage(src: string, hexColor: string, dest: string) {
    const colorR = parseInt(hexColor.slice(1, 3), 16) / 255;
    const colorG = parseInt(hexColor.slice(3, 5), 16) / 255;
    const colorB = parseInt(hexColor.slice(5, 7), 16) / 255;
    const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const output = Buffer.alloc(info.width * info.height * 4);
    for (let index = 0; index < info.width * info.height; index++) {
        const offset = index * 4;
        const gray =
            0.2126 * ((data[offset] ?? 0) / 255) +
            0.7152 * ((data[offset + 1] ?? 0) / 255) +
            0.0722 * ((data[offset + 2] ?? 0) / 255);
        output[offset] = Math.round(gray * colorR * 255);
        output[offset + 1] = Math.round(gray * colorG * 255);
        output[offset + 2] = Math.round(gray * colorB * 255);
        output[offset + 3] = data[offset + 3] ?? 255;
    }
    await sharp(output, { raw: { width: info.width, height: info.height, channels: 4 } })
        .webp(OUTPUT_WEBP_OPTIONS)
        .toFile(join(OUTPUT_DIR, dest));
}

async function copyAndOptimizeImage(src: string, dest: string) {
    const filename = dest.includes("{sha256}") ? dest.replace("{sha256}", await getFileSha256(src)) : dest;
    await sharp(src).webp(OUTPUT_WEBP_OPTIONS).toFile(join(OUTPUT_DIR, filename));
    return filename;
}

export async function uploadAssets(ctx: ItemGeneratorContext): Promise<void> {
    if (STORAGE_ZONE === undefined || STORAGE_ACCESS_KEY === undefined) {
        log("CDN credentials not configured; skipping upload.");
        return;
    }
    const sz = BunnyStorageSDK.zone.connect_with_accesskey(
        BunnyStorageSDK.regions.StorageRegion.NewYork,
        STORAGE_ZONE,
        STORAGE_ACCESS_KEY
    );
    const queue = new PromiseQueue(CDN_UPLOAD_CONCURRENCY);
    let uploadCount = 0;
    for (const folder of ["images", "materials", "textures", "models"]) {
        const fileChecksums = Object.fromEntries(
            (await BunnyStorageSDK.file.list(sz, `/${folder}`)).map((file) => [
                `${file.path.replace(`/${STORAGE_ZONE}`, "")}${file.objectName}`,
                file.checksum?.toLowerCase()
            ])
        );
        const assetsPath = join(OUTPUT_DIR, folder);
        for (const filename of await readdir(assetsPath)) {
            const assetPath = join(assetsPath, filename);
            const cdnPath = `/${folder}/${filename}`;
            if (fileChecksums[cdnPath] === undefined) {
                uploadCount++;
                queue.push(async () => {
                    await BunnyStorageSDK.file.upload(sz, cdnPath, Readable.toWeb(createReadStream(assetPath)));
                });
            }
        }
    }
    log(`Uploading ${formatCount(uploadCount, "new CDN asset")}...`);
    await queue.waitForIdle();
    log(`Uploaded ${formatCount(uploadCount, "new CDN asset")}.`);
}
