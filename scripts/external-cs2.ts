/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DecompilerArgs, vrfDecompiler } from "@ianlucas/vrf-decompiler";
import { resolve } from "path";
import { ensure } from "../src/utils";
import { CS2_CSGO_FULL_PATH } from "./env";
import { readProcess } from "./utils";

export class ExternalCS2 {
    public active = CS2_CSGO_FULL_PATH !== undefined;

    async decompile(options: DecompilerArgs) {
        return await readProcess(
            vrfDecompiler({
                input: resolve(ensure(CS2_CSGO_FULL_PATH), "pak01_dir.vpk"),
                ...options
            })
        );
    }
}
