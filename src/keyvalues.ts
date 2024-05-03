/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { fail } from "./util.js";

type KeyValue = [string, string | KeyValue[]];

export function CS_parseValveKeyValue<T = any>(data: string) {
    data = data.replace(/\[[\$!][^\]]+\]/g, "");
    let index = 0;

    function skipWhitespace() {
        while (data[index] && data[index].match(/[\s\t\r\n]/)) {
            index += 1;
        }
        if (data[index] === "/" && data[index + 1] === "/") {
            while (data[index] && data[index] !== "\n") {
                index += 1;
            }
            skipWhitespace();
        }
    }

    function parseString() {
        if (data[index] === '"') {
            index += 1;
            let value = "";
            while (data[index] && data[index] !== '"') {
                while (data[index] && data[index] === "\\") {
                    index += 1;
                    const char = data[index];
                    if (char === "n") {
                        value += "\n";
                    } else {
                        value += char;
                    }
                    index += 1;
                }
                if (data[index] !== '"') {
                    value += data[index];
                    index += 1;
                }
            }
            if (data[index] !== '"') {
                fail("Bad end of string.");
            }
            index += 1;
            return value;
        }
        return "";
    }

    function parseValue() {
        if (data[index] === '"') {
            return parseString();
        }
        if (data[index] === "{") {
            index += 1;
            return parsePairs();
        }
        if (data[index] === "}") {
            return "";
        }
        console.log(
            data.substring(Math.max(0, index - 64), index) +
                data[index] +
                data.substring(index + 1, Math.min(data.length, index + 63))
        );
        console.log("".padStart(64, " ") + "^");
        fail(`Unexpected character at index ${index}.`);
    }

    function parsePairs() {
        const pairs: KeyValue[] = [];
        while (data[index]) {
            if (data[index] === "}") {
                index += 1;
                return pairs;
            }
            skipWhitespace();
            const key = parseString();
            skipWhitespace();
            const value = parseValue();
            skipWhitespace();
            pairs.push([key, value]);
        }
        return pairs;
    }

    function walk(context: any, pairs: KeyValue[]) {
        return pairs.reduce((object, pair) => {
            const [key, value] = pair;
            if (object[key] && !Array.isArray(object[key])) {
                object[key] = [object[key]];
            }
            const newValue = typeof value === "string" ? value : walk({}, value);
            if (Array.isArray(object[key])) {
                object[key].push(newValue);
            } else {
                object[key] = newValue;
            }
            return object;
        }, context);
    }

    return walk({}, parsePairs()) as T;
}
