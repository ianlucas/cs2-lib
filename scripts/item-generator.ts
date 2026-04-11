/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { shouldRun } from "./utils.ts";
import { runItemGenerator } from "./item-generator/entry.ts";

if (shouldRun(import.meta.url)) {
    await runItemGenerator();
}
