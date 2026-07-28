/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Renames item properties in the generated data, one group of docs/item-property-renames.md at a
// time. The generator reads its own output back — AssetWorkspace loads scripts/data/items.json into
// ctx.ExistingItemsById, which feeds HydrateExistingModelFields, the specials carry-forward in
// ParseContainers and GetModel's limited-mode reuse — so a property renamed in Types.cs while the
// data still uses the old key deserializes to null and hydration silently stops matching. A full
// generator run needs the depot; this rewrites the two generated files instead, byte for byte as
// the generator would have written them.
//
// Usage: npx tsx scripts/rename-item-fields.ts

import { assert, ensure } from "../src/utils.ts";
import { log, read, write } from "./utils.ts";

// Group 3 — booleans. Swap this map for the next group's; everything else is generic. These three
// sort into a different slot than the names they replace, so the emitted key order moves with them
// — which is why every item is re-sorted against Types.cs below rather than rewritten in place.
const renames: Record<string, string> = {
    base: "isBase",
    free: "isDefault",
    legacy: "isLegacyModel"
};

// Renames that also rewrite the value, as when two booleans collapse into one enum. Two old keys
// mapping onto one new one would lose a property, which the per-item key count below catches.
const rewrites: Record<string, readonly [string, JsonValue]> = {};

const itemsJsonPath = "scripts/data/items.json";
const itemsTsPath = "src/items.ts";
const typesCsPath = "scripts/item-generator/Types.cs";

type JsonValue = string | number | boolean | JsonValue[];
type ItemRecord = Record<string, JsonValue>;

function rename(key: string, value: JsonValue): readonly [string, JsonValue] {
    return rewrites[key] ?? [renames[key] ?? key, value];
}

// System.Text.Json's default encoder allows Basic Latin except the characters that are unsafe to
// drop into HTML or a script tag, and escapes everything else as \uXXXX.
const unsafeCharCodes = new Set([0x22, 0x26, 0x27, 0x2b, 0x3c, 0x3e, 0x60]);
const shortEscapes: Record<number, string> = {
    0x08: "\\b",
    0x09: "\\t",
    0x0a: "\\n",
    0x0c: "\\f",
    0x0d: "\\r",
    0x5c: "\\\\"
};

function encodeString(value: string): string {
    let encoded = '"';
    for (let index = 0; index < value.length; index++) {
        const charCode = value.charCodeAt(index);
        const shortEscape = shortEscapes[charCode];
        if (shortEscape !== undefined) {
            encoded += shortEscape;
        } else if (charCode >= 0x20 && charCode <= 0x7e && !unsafeCharCodes.has(charCode)) {
            encoded += value[index];
        } else {
            encoded += `\\u${charCode.toString(16).toUpperCase().padStart(4, "0")}`;
        }
    }
    return `${encoded}"`;
}

function encodeValue(value: JsonValue): string {
    if (typeof value === "string") {
        return encodeString(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map(encodeValue).join(",")}]`;
    }
    return JSON.stringify(value);
}

function encodeItems(items: ItemRecord[]): string {
    const encoded = items.map((item) => {
        const properties = Object.entries(item).map(([key, value]) => `${encodeString(key)}:${encodeValue(value)}`);
        return `{${properties.join(",")}}`;
    });
    return `[${encoded.join(",")}]`;
}

/** Mirrors OutputWriter.Banner and OutputWriter.CreateItemsModule. */
function createItemsModule(itemsJson: string): string {
    const banner =
        "/*---------------------------------------------------------------------------------------------\n *  Copyright (c) Ian Lucas. All rights reserved.\n *  Licensed under the MIT License. See License.txt in the project root for license information.\n *--------------------------------------------------------------------------------------------*/";
    return `${banner}\n\nimport type { CS2Item } from "./economy-types.ts";\n\n// @generated\n// @ts-ignore\nexport const CS2_ITEMS: CS2Item[] = ${itemsJson};`;
}

/** The order the generator emits properties in is the order Types.cs declares them. */
function readEmittedKeys(typesCs: string): string[] {
    const start = typesCs.indexOf("public class CS2Item");
    const end = typesCs.indexOf("public class CS2ItemTranslation");
    assert(start !== -1 && end > start, "unable to locate CS2Item in Types.cs");
    return Array.from(typesCs.slice(start, end).matchAll(/JsonPropertyName\("([^"]+)"\)/g)).map(([, key]) =>
        ensure(key)
    );
}

function isSameValue(a: JsonValue | undefined, b: JsonValue | undefined): boolean {
    if (Array.isArray(a) || Array.isArray(b)) {
        return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, at) => value === b[at]);
    }
    return a === b;
}

async function main(): Promise<void> {
    const itemsJson = await read(itemsJsonPath);
    const items = JSON.parse(itemsJson) as ItemRecord[];

    // Nothing below is safe unless this writer reproduces the generator's own bytes, so prove it
    // against the file as it stands before rewriting anything.
    assert(encodeItems(items) === itemsJson, `${itemsJsonPath} does not round-trip through this writer`);
    assert(createItemsModule(itemsJson) === (await read(itemsTsPath)), `${itemsTsPath} is not the module it emits`);

    const emittedKeys = readEmittedKeys(await read(typesCsPath));
    const emittedAt = new Map(emittedKeys.map((key, at) => [key, at] as const));
    for (const key of [...Object.values(renames), ...Object.values(rewrites).map(([key]) => key)]) {
        assert(emittedAt.has(key), `Types.cs does not declare '${key}'`);
    }

    const counts: Record<string, number> = {};
    const renamed = items.map((item) => {
        const properties = Object.entries(item).map(([key, value]) => {
            const [renamedKey, renamedValue] = rename(key, value);
            assert(emittedAt.has(renamedKey), `'${key}' is neither renamed nor declared in Types.cs`);
            counts[key] = (counts[key] ?? 0) + 1;
            return [renamedKey, renamedValue] as const;
        });
        properties.sort(([a], [b]) => ensure(emittedAt.get(a)) - ensure(emittedAt.get(b)));
        const record: ItemRecord = Object.fromEntries(properties);
        assert(Object.keys(record).length === Object.keys(item).length, `item ${item.id} lost a property`);
        for (const [key, value] of Object.entries(item)) {
            const [renamedKey, renamedValue] = rename(key, value);
            assert(isSameValue(record[renamedKey], renamedValue), `item ${item.id} changed value of '${key}'`);
        }
        return record;
    });
    assert(renamed.length === items.length, "the item count changed");

    const renamedJson = encodeItems(renamed);
    await write(itemsJsonPath, renamedJson);
    await write(itemsTsPath, createItemsModule(renamedJson));

    const total = Object.keys(renames).length + Object.keys(rewrites).length;
    log(`Renamed ${total} properties over ${renamed.length} items.`);
    for (const [from, to] of Object.entries(renames)) {
        log(`  ${from} -> ${to} (${counts[from] ?? 0} items)`);
    }
    for (const [from, [to, value]] of Object.entries(rewrites)) {
        log(`  ${from} -> ${to}: ${JSON.stringify(value)} (${counts[from] ?? 0} items)`);
    }
    log(`Successfully generated '${itemsJsonPath}'.`);
    log(`Successfully generated '${itemsTsPath}'.`);
}

await main();
