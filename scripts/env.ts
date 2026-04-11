/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dotenv from "dotenv";
import { join } from "path";
dotenv.config({
    quiet: true
});

export const CWD_PATH: string = process.cwd();
export const CS2_CSGO_PATH: string = process.env.CS2_CSGO_PATH ?? join(CWD_PATH, "scripts/workdir/decompiled");
export const INPUT_FORCE: string | undefined = process.env.INPUT_FORCE;
export const STORAGE_ZONE: string | undefined = process.env.STORAGE_ZONE;
export const STORAGE_ACCESS_KEY: string | undefined = process.env.STORAGE_ACCESS_KEY;
export const INPUT_TEXTURES: string | undefined = process.env.INPUT_TEXTURES;
