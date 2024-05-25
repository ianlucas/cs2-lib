/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { existsSync, readFileSync, writeFileSync } from "fs";
import { decode as htmlEntitiesDecode } from "html-entities";
import { basename, resolve } from "path";
import { fileURLToPath } from "url";

export const log = console.log;
export const warning = console.warn;

export function writeJson(path: string, contents: any) {
    const file = resolve(process.cwd(), path);
    const stringified = JSON.stringify(contents);
    writeFileSync(file, stringified, "utf-8");
}

export function readJson<T>(path: string, fallback?: T) {
    const file = resolve(process.cwd(), path);
    if (fallback !== undefined && !existsSync(file)) {
        return fallback;
    }
    return JSON.parse(readFileSync(file, "utf-8")) as T;
}

export function write(path: string, contents: string) {
    const file = resolve(process.cwd(), path);
    writeFileSync(file, contents, "utf-8");
}

export function read(path: string) {
    const file = resolve(process.cwd(), path);
    return readFileSync(file, "utf-8");
}

export async function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchText(url: string) {
    url = htmlEntitiesDecode(url);
    log(`GET ${url}`);
    return (await fetch(url)).text();
}

export function dedupe<T>(array: T[]) {
    return [...new Set(array)];
}

export function push<T, U extends Record<string | number, U[]>>(obj: T, key: string | number, value: any) {
    if (!obj[key]) {
        obj[key] = [];
    }
    if (obj[key].includes(value)) {
        return;
    }
    obj[key].push(value);
}

export function isNotUndefined<T>(value: T): value is NonNullable<T> {
    return value !== undefined;
}

export function shouldRun(url: string) {
    return basename(process.argv[1]) === basename(fileURLToPath(url));
}
