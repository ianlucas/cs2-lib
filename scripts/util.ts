/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

export function writeJson(path: string, contents: any) {
    const file = resolve(process.cwd(), path);
    const stringified = JSON.stringify(contents);
    writeFileSync(file, stringified, "utf-8");
}

export function replaceInFile(path: string, pattern: RegExp, replaceValue: string) {
    const file = readFileSync(path, "utf-8");
    writeFileSync(path, file.replace(pattern, replaceValue), "utf-8");
}
