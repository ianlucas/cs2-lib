/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as dotenv from "dotenv";
dotenv.config();

export const ITEMS_PATH = process.env.ITEMS_PATH as string;
export const LANGUAGE_PATH = process.env.LANGUAGE_PATH as string;
export const IMAGES_PATH = process.env.IMAGES_PATH as string;
export const CS2_IMAGES_PATH = process.env.CS2_IMAGES_PATH as string;
