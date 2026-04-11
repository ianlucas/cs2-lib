/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { existsSync } from "fs";
import { join } from "path";
import { assert } from "../../src/utils.ts";
import { Cs2Runtime, Cs2RuntimeConfig } from "./types.ts";
import { CSGO_PAK_DIR_PATH } from "./paths.ts";

export function createCs2Runtime(config: Cs2RuntimeConfig): Cs2Runtime {
    if (config.source === "installed_game") {
        assert(config.installedGamePath !== undefined, "installed_game source requires CS2_CSGO_PATH to be set.");
        assert(existsSync(config.installedGamePath), `CS2 install path does not exist: ${config.installedGamePath}`);
        const pakDirPath = join(config.installedGamePath, "pak01_dir.vpk");
        assert(existsSync(pakDirPath), `Unable to find pak01_dir.vpk at ${pakDirPath}`);
        return {
            config: {
                ...config,
                paths: {
                    ...config.paths,
                    pakDirPath
                }
            },
            vpkIndex: new Map()
        };
    }
    return {
        config: {
            ...config,
            paths: {
                ...config.paths,
                pakDirPath: CSGO_PAK_DIR_PATH
            }
        },
        vpkIndex: new Map()
    };
}

export function isWorkspaceDepotSource(runtime: Cs2Runtime) {
    return runtime.config.source === "workspace_depot";
}
