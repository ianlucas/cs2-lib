/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dotenv from "dotenv";
dotenv.config();

export const CS2_CSGO_PATH = process.env.CS2_CSGO_PATH ?? `${process.cwd()}/scripts/workdir/decompiled`;
export const { CS2_CSGO_FULL_PATH, CS2_CSGO_DIRECTORY_PATH, INPUT_FORCE } = process.env;
