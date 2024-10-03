/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ChildProcessWithoutNullStreams } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { access } from "fs/promises";
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

export function shouldRun(url: string) {
    return basename(process.argv[1]) === basename(fileURLToPath(url));
}

export async function exists(path: string) {
    try {
        await access(path);
        return true;
    } catch {
        return false;
    }
}

export function readProcess(ps: ChildProcessWithoutNullStreams) {
    return new Promise<string>((resolve, reject) => {
        let data = "";
        ps.stdout.on("data", (chunk) => (data += chunk));
        ps.stderr.on("data", (chunk) => (data += chunk));
        ps.on("close", (code) => {
            if (code === 0) {
                resolve(data);
            } else {
                reject(data);
            }
        });
    });
}

export function prependHash<T extends string | undefined>(str: T) {
    if (str === undefined || str.startsWith("#")) {
        return str;
    }
    return `#${str}`;
}
