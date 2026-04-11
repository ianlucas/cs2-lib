/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type Cs2SourceMode = "installed_game" | "workspace_depot";

export interface VpkIndexEntry {
    crc: string;
    fnumber: string;
}

export interface Cs2Paths {
    assetsManifestPath: string;
    decompiledDir: string;
    depotCsgoPath: string;
    depotFileListPath: string;
    pakDirPath: string;
    tempPakFileListPath: string;
    workdirPath: string;
}

export interface Cs2RuntimeConfig {
    force?: boolean;
    installedGamePath?: string;
    paths: Cs2Paths;
    source: Cs2SourceMode;
}

export interface Cs2Runtime {
    config: Cs2RuntimeConfig;
    vpkIndex: Map<string, VpkIndexEntry>;
}

export interface DecompileAssetsOptions {
    block?: string;
    gltfExportFormat?: "glb";
    gltfExportMaterials?: boolean;
    output?: string;
    textureDecodeFlags?: string;
    threads?: number;
}

export interface ModelMetadataEntry {
    targetFilename: string;
    vpkPath: string;
}

export interface ModelMetadataExtractionResult {
    data: any;
    filename: string;
    materials: string[];
}

export interface CompositeMaterialMetadataExtractionResult {
    compositeMaterialRefs: string[];
    data: any;
    filename: string;
    vcompmatPath: string;
    vmatRefs: string[];
    vtexRefs: string[];
}

export interface MaterialMetadataExtractionResult {
    data: any;
    filename: string;
    vmatPath: string;
    vmatRefs: string[];
    vtexRefs: string[];
}
