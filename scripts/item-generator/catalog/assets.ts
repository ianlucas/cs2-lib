/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { basename, join } from "path";
import sharp from "sharp";
import { ensure } from "../../../src/utils.ts";
import { exists, getFileSha256 } from "../../utils.ts";
import { findFallbackImage } from "../sources/external.ts";
import { ItemGeneratorContext } from "../types.ts";
import { GAME_IMAGES_DIR, OUTPUT_DIR, PAINT_IMAGE_SUFFIXES, STATIC_IMAGES_DIR } from "../config.ts";

async function copyAndOptimizeImage(src: string, dest: string) {
    const filename = dest.includes("{sha256}") ? dest.replace("{sha256}", await getFileSha256(src)) : dest;
    await sharp(src).webp({ quality: 95 }).toFile(join(OUTPUT_DIR, filename));
    return filename;
}

function getImagePath(path: string) {
    return join(GAME_IMAGES_DIR, `${path}_png.png`.toLowerCase());
}

function getPaintImagePath(className: string | undefined, paintClassName: string | undefined, suffix = "light") {
    return join(
        GAME_IMAGES_DIR,
        `econ/default_generated/${className}_${paintClassName}_${suffix}_png.png`.toLowerCase()
    );
}

export function requireStaticAsset(ctx: ItemGeneratorContext, path: string) {
    return ensure(ctx.staticAssets[path], `Unable to find '${path}' static asset.`);
}

function getVpkImagePath(path: string) {
    return `panorama/images/${path}_png.png`.toLowerCase();
}

function getVpkPaintImagePath(className: string, paintClassName: string, suffix: string) {
    return `panorama/images/econ/default_generated/${className}_${paintClassName}_${suffix}_png.png`.toLowerCase();
}

function vpkCrcFilename(vpkPath: string, crc: string, suffix?: string) {
    const base = basename(vpkPath, ".png").replace(/_png$/, "");
    return suffix ? `/images/${base}_${crc}_${suffix}.webp` : `/images/${base}_${crc}.webp`;
}

export async function tryGetFallbackImage(
    ctx: ItemGeneratorContext,
    source: "collectible" | "container" | "keychain",
    imagePath: string,
    existingId: number
) {
    const existing = ctx.existingItemsById.get(existingId)?.image;
    if (existing !== undefined) {
        return existing;
    }
    const staticKey = `/images/${basename(imagePath)}.png`;
    if (ctx.staticAssets[staticKey] !== undefined) {
        return ctx.staticAssets[staticKey];
    }
    const localPath = join(STATIC_IMAGES_DIR, basename(staticKey));
    if (!(await exists(localPath)) && (await findFallbackImage(source, imagePath)) === undefined) {
        return undefined;
    }
    const filename = await copyAndOptimizeImage(localPath, "/images/{sha256}.webp");
    ctx.staticAssets[staticKey] = filename;
    return filename;
}

export function isImageValid(ctx: ItemGeneratorContext, path: string) {
    return ctx.cs2.vpkIndex.has(getVpkImagePath(path));
}

export function isPaintImageValid(ctx: ItemGeneratorContext, className?: string, paintClassName?: string) {
    return ctx.cs2.vpkIndex.has(getVpkPaintImagePath(ensure(className), ensure(paintClassName), "light"));
}

export function getBaseImage(ctx: ItemGeneratorContext, className: string) {
    return getImage(ctx, `econ/weapons/base_weapons/${className}`);
}

export function getImage(ctx: ItemGeneratorContext, path: string) {
    const vpkPath = getVpkImagePath(path);
    const entry = ensure(ctx.cs2.vpkIndex.get(vpkPath), `VPK entry not found: ${vpkPath}`);
    const filename = vpkCrcFilename(vpkPath, entry.crc);
    if (!ctx.existingImages.has(filename)) {
        ctx.neededVpkPaths.add(vpkPath);
        ctx.imagesToProcess.set(vpkPath, { kind: "regular", localPath: getImagePath(path), filename });
    }
    return filename;
}

export function getPaintImage(ctx: ItemGeneratorContext, className: string | undefined, paintClassName: string | undefined) {
    const cn = ensure(className);
    const pcn = ensure(paintClassName);
    const lightVpkPath = getVpkPaintImagePath(cn, pcn, "light");
    const entry = ensure(ctx.cs2.vpkIndex.get(lightVpkPath), `VPK entry not found: ${lightVpkPath}`);
    const baseName = `${cn}_${pcn}_${entry.crc}`;
    const baseFilename = `/images/${baseName}.webp`;
    if (!ctx.existingImages.has(baseFilename)) {
        const localPaths = PAINT_IMAGE_SUFFIXES.map((suffix) => [getPaintImagePath(cn, pcn, suffix), suffix] as [string, string]);
        for (const suffix of PAINT_IMAGE_SUFFIXES) {
            ctx.neededVpkPaths.add(getVpkPaintImagePath(cn, pcn, suffix));
        }
        ctx.imagesToProcess.set(lightVpkPath, { kind: "paint", localPaths, baseName, baseFilename });
    }
    return baseFilename;
}

export function getDefaultGraffitiImage(ctx: ItemGeneratorContext, stickerMaterial: string, hexColor: string) {
    const vpkPath = getVpkImagePath(`econ/stickers/${stickerMaterial}`);
    const entry = ensure(ctx.cs2.vpkIndex.get(vpkPath), `VPK entry not found: ${vpkPath}`);
    const materialBase = ensure(stickerMaterial.split("/").pop());
    const colorNoHash = hexColor.replace("#", "");
    const filename = `/images/${materialBase}_${colorNoHash}_${entry.crc}.webp`;
    if (!ctx.existingImages.has(filename)) {
        ctx.neededVpkPaths.add(vpkPath);
        ctx.imagesToProcess.set(`${vpkPath}:${hexColor}`, {
            kind: "graffiti",
            localPath: getImagePath(`econ/stickers/${stickerMaterial}`),
            hexColor,
            filename
        });
    }
    return filename;
}

export function getSpecialsImage(ctx: ItemGeneratorContext, path?: string) {
    if (path === undefined) {
        return requireStaticAsset(ctx, "/images/default_rare_item.png");
    }
    const vpkPath = getVpkImagePath(path);
    if (!ctx.cs2.vpkIndex.has(vpkPath)) {
        return requireStaticAsset(ctx, "/images/default_rare_item.png");
    }
    const entry = ensure(ctx.cs2.vpkIndex.get(vpkPath));
    const filename = vpkCrcFilename(vpkPath, entry.crc, "rare");
    if (!ctx.existingImages.has(filename)) {
        ctx.neededVpkPaths.add(vpkPath);
        ctx.imagesToProcess.set(`${vpkPath}:rare`, {
            kind: "regular",
            localPath: getImagePath(path),
            filename
        });
    }
    return filename;
}

export function getModel(ctx: ItemGeneratorContext, path?: string, existingId?: number) {
    if (path === undefined) {
        return undefined;
    }
    if (ctx.mode === "limited" && existingId !== undefined) {
        const existing = ctx.existingItemsById.get(existingId);
        return existing !== undefined ? { modelData: existing.modelData, modelPlayer: existing.modelPlayer } : undefined;
    }
    const vpkPath = path.replace(".vmdl", ".vmdl_c").toLowerCase();
    const entry = ctx.cs2.vpkIndex.get(vpkPath);
    if (!entry) {
        return undefined;
    }
    const base = basename(path, ".vmdl");
    const modelPlayer = `/models/${base}_${entry.crc}.glb`;
    const modelData = `/models/${base}_${entry.crc}.json`;
    ctx.modelsToProcess.set(vpkPath, {
        base,
        crc: entry.crc,
        modelData,
        modelPlayer,
        directMaterials: new Set(),
        materialFilenames: new Set(),
        textureFilenames: new Set()
    });
    return { modelPlayer, modelData };
}

export function getCollectionImage(ctx: ItemGeneratorContext, name: string) {
    const pngVpkPath = `panorama/images/econ/set_icons/${name}_png.png`;
    const svgVpkPath = `panorama/images/econ/set_icons/${name}.svg`;
    const isSvg = !ctx.cs2.vpkIndex.has(pngVpkPath) && ctx.cs2.vpkIndex.has(svgVpkPath);
    const vpkPath = isSvg ? svgVpkPath : pngVpkPath;
    if (!ctx.cs2.vpkIndex.has(vpkPath)) {
        return undefined;
    }
    const entry = ensure(ctx.cs2.vpkIndex.get(vpkPath));
    const filename = `/images/${name}_${entry.crc}.webp`;
    if (!ctx.existingImages.has(filename)) {
        const ext = isSvg ? ".svg" : "_png.png";
        const localPath = join(GAME_IMAGES_DIR, `econ/set_icons/${name}${ext}`);
        ctx.neededVpkPaths.add(vpkPath);
        ctx.imagesToProcess.set(vpkPath, isSvg ? { kind: "svg", localPath, filename } : { kind: "regular", localPath, filename });
    }
    return filename;
}
