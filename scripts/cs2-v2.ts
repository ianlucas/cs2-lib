/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export { buildVpkIndex, decompileAssets, decompileItemDefinitionResources, decompileModelAssets } from "./cs2-v2/decompile.ts";
export { ensureAssetPackages, ensureItemDefinitionPackages, syncAssetsManifest } from "./cs2-v2/depot.ts";
export { extractMaterialMetadata, extractModelMetadata } from "./cs2-v2/extract.ts";
export { createDefaultCs2Paths, ASSETS_MANIFEST_PATH, DECOMPILED_DIR, SCRIPTS_DIR, WORKDIR_DIR } from "./cs2-v2/paths.ts";
export { createCs2Runtime, isWorkspaceDepotSource } from "./cs2-v2/runtime.ts";
export type {
    Cs2Paths,
    Cs2Runtime,
    Cs2RuntimeConfig,
    Cs2SourceMode,
    DecompileAssetsOptions,
    MaterialMetadataExtractionResult,
    ModelMetadataEntry,
    ModelMetadataExtractionResult,
    VpkIndexEntry
} from "./cs2-v2/types.ts";
