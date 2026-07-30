/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Renames item properties in the generated data, one group of docs/item-property-renames.md at a
// time. The generator reads its own output back — AssetWorkspace loads scripts/data/items.json into
// ctx.ExistingItemsById, which feeds HydrateExistingModelFields, the specials carry-forward in
// ParseContainers and GetModel's limited-mode reuse — so a property renamed in Types.cs while the
// data still uses the old key deserializes to null and hydration silently stops matching. A full
// generator run needs the depot; this rewrites the generated files instead, byte for byte as the
// generator would have written them.
//
// Usage: npx tsx scripts/rename-item-fields.ts

import { readdir } from "fs/promises";
import { assert, ensure } from "../src/utils.ts";
import { log, read, write } from "./utils.ts";

// All groups combined — migrates the pre-rename data merged from main to the v9 schema in one
// pass. No key is renamed twice across the groups, so the union composes cleanly.
const renames: Record<string, string> = {
    altName: "alternateName",
    base: "isBase",
    baseId: "parentId",
    collection: "collectionKey",
    model: "modelKey",
    stickerId: "displayedStickerId",
    category: "loadoutCategory",
    clothCollider: "hasColliderData",
    collectionImage: "collectionImagePath",
    contents: "contentIds",
    def: "definitionIndex",
    displaySeed: "previewSeed",
    free: "isDefault",
    image: "imagePath",
    index: "variantIndex",
    keys: "keyIds",
    legacy: "isLegacyModel",
    paintMaterial: "materialPath",
    playerModel: "modelPath",
    rarity: "rarityColor",
    specials: "specialIds",
    specialsImage: "specialsImagePath",
    teams: "team",
    tint: "tintIndex",
    keychainOffsetXMax: "keychainPositionXMax",
    keychainOffsetXMin: "keychainPositionXMin",
    keychainOffsetYMax: "keychainPositionYMax",
    keychainOffsetYMin: "keychainPositionYMin",
    keychainOffsetZMax: "keychainPositionZMax",
    keychainOffsetZMin: "keychainPositionZMin",
    legacyKeychainOffsetXMax: "legacyKeychainPositionXMax",
    legacyKeychainOffsetXMin: "legacyKeychainPositionXMin",
    legacyKeychainOffsetYMax: "legacyKeychainPositionYMax",
    legacyKeychainOffsetYMin: "legacyKeychainPositionYMin",
    legacyKeychainOffsetZMax: "legacyKeychainPositionZMax",
    legacyKeychainOffsetZMin: "legacyKeychainPositionZMin"
};

// The same, for CS2ItemTranslation. `category` means a sticker's capsule here and a weapon's
// loadout slot on the item, which is the collision that forces two maps.
const translationRenames: Record<string, string> = {
    category: "categoryName",
    collectionDesc: "collectionDescription",
    desc: "description",
    tournamentDesc: "tournamentDescription"
};

// Renames that also rewrite the value. The two StatTrak booleans collapse into one enum, so both
// old keys land on `statTrakMode` — an item carrying both would lose a property, which the
// per-item key count below catches.
const rewrites: Record<string, readonly [string, JsonValue]> = {
    statTrakless: ["statTrakMode", "excluded"],
    statTrakOnly: ["statTrakMode", "guaranteed"]
};

const itemsJsonPath = "scripts/data/items.json";
const itemsTsPath = "src/items.ts";
const englishJsonPath = "scripts/data/english.json";
const translationsTsDir = "src/translations";
const typesCsPath = "scripts/item-generator/Types.cs";

type JsonValue = string | number | boolean | JsonValue[];
type ItemRecord = Record<string, JsonValue>;
// A Map, not an object: the generator keys this by item id and emits its .NET dictionary in
// insertion order, which a JavaScript object would silently re-sort into ascending numeric order.
type TranslationMap = Map<string, ItemRecord>;

function rename(key: string, value: JsonValue): readonly [string, JsonValue] {
    return rewrites[key] ?? [renames[key] ?? key, value];
}

function renameTranslation(key: string, value: JsonValue): readonly [string, JsonValue] {
    return [translationRenames[key] ?? key, value];
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

function encodeRecord(record: ItemRecord): string {
    const properties = Object.entries(record).map(([key, value]) => `${encodeString(key)}:${encodeValue(value)}`);
    return `{${properties.join(",")}}`;
}

function encodeItems(items: ItemRecord[]): string {
    return `[${items.map(encodeRecord).join(",")}]`;
}

/** Mirrors OutputWriter.SerializeTranslationMap: one object keyed by the item id. */
function encodeTranslations(map: TranslationMap): string {
    const entries = Array.from(map, ([id, record]) => `${encodeString(id)}:${encodeRecord(record)}`);
    return `{${entries.join(",")}}`;
}

/**
 * Parses a translation map, recovering the id order from the source because JSON.parse loses it.
 * The order this reads out only has to be a guess — encodeTranslations is asserted against these
 * same bytes below, which is what proves it right. Values are always strings and the encoder
 * escapes every quote inside them, so a bare `"` in the JSON is only ever a delimiter.
 */
function parseTranslations(json: string): TranslationMap {
    const parsed = JSON.parse(json) as Record<string, ItemRecord>;
    const ids = Array.from(json.matchAll(/[{,]"(\d+)":\{/g)).map(([, id]) => ensure(id));
    const map = new Map(ids.map((id) => [id, ensure(parsed[id])] as const));
    assert(map.size === ids.length, "the translation map has a duplicate id");
    assert(map.size === Object.keys(parsed).length, "unable to recover the translation id order");
    return map;
}

const banner =
    "/*---------------------------------------------------------------------------------------------\n *  Copyright (c) Ian Lucas. All rights reserved.\n *  Licensed under the MIT License. See License.txt in the project root for license information.\n *--------------------------------------------------------------------------------------------*/";

/** Mirrors OutputWriter.Banner and OutputWriter.CreateItemsModule. */
function createItemsModule(itemsJson: string): string {
    return `${banner}\n\nimport type { CS2Item } from "./economy-types.ts";\n\n// @generated\n// @ts-ignore\nexport const CS2_ITEMS: CS2Item[] = ${itemsJson};`;
}

/** Everything OutputWriter.CreateTranslationModule writes ahead of the JSON. */
function translationModulePrefix(language: string): string {
    return `${banner}\n\nimport type { CS2ItemTranslationMap } from "../economy-types.ts";\n\n// @generated\n// @ts-ignore\nexport const ${language}: CS2ItemTranslationMap = `;
}

/** Mirrors OutputWriter.CreateTranslationModule. */
function createTranslationModule(language: string, tokensJson: string): string {
    return `${translationModulePrefix(language)}${tokensJson};`;
}

/** The order the generator emits properties in is the order Types.cs declares them. */
function readEmittedKeys(typesCs: string, className: string, until: string): string[] {
    const start = typesCs.indexOf(`public class ${className}`);
    const end = typesCs.indexOf(until);
    assert(start !== -1 && end > start, `unable to locate ${className} in Types.cs`);
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

/**
 * Renames one record's keys and re-sorts it into the order Types.cs declares, asserting that no
 * property is dropped and no value moves. Two old keys mapping onto one new one would lose a
 * property, which the key count catches.
 */
function renameRecord(
    record: ItemRecord,
    renameKey: (key: string, value: JsonValue) => readonly [string, JsonValue],
    emittedAt: Map<string, number>,
    counts: Record<string, number>,
    label: string
): ItemRecord {
    const properties = Object.entries(record).map(([key, value]) => {
        const [renamedKey, renamedValue] = renameKey(key, value);
        assert(emittedAt.has(renamedKey), `'${key}' is neither renamed nor declared in Types.cs`);
        counts[key] = (counts[key] ?? 0) + 1;
        return [renamedKey, renamedValue] as const;
    });
    properties.sort(([a], [b]) => ensure(emittedAt.get(a)) - ensure(emittedAt.get(b)));
    const renamed: ItemRecord = Object.fromEntries(properties);
    assert(Object.keys(renamed).length === Object.keys(record).length, `${label} lost a property`);
    for (const [key, value] of Object.entries(record)) {
        const [renamedKey, renamedValue] = renameKey(key, value);
        assert(isSameValue(renamed[renamedKey], renamedValue), `${label} changed value of '${key}'`);
    }
    return renamed;
}

async function renameItems(emittedAt: Map<string, number>, counts: Record<string, number>): Promise<void> {
    const itemsJson = await read(itemsJsonPath);
    const items = JSON.parse(itemsJson) as ItemRecord[];

    // Nothing below is safe unless this writer reproduces the generator's own bytes, so prove it
    // against the file as it stands before rewriting anything.
    assert(encodeItems(items) === itemsJson, `${itemsJsonPath} does not round-trip through this writer`);
    assert(createItemsModule(itemsJson) === (await read(itemsTsPath)), `${itemsTsPath} is not the module it emits`);

    const renamed = items.map((item) => renameRecord(item, rename, emittedAt, counts, `item ${item.id}`));
    assert(renamed.length === items.length, "the item count changed");

    const renamedJson = encodeItems(renamed);
    await write(itemsJsonPath, renamedJson);
    await write(itemsTsPath, createItemsModule(renamedJson));
    log(`Successfully generated '${itemsJsonPath}'.`);
    log(`Successfully generated '${itemsTsPath}'.`);
}

async function renameTranslations(emittedAt: Map<string, number>, counts: Record<string, number>): Promise<void> {
    const languages = (await readdir(translationsTsDir))
        .filter((file) => file.endsWith(".ts") && file !== "index.ts")
        .map((file) => file.slice(0, -".ts".length))
        .sort();
    assert(languages.includes("english"), "english.ts is missing");

    for (const language of languages) {
        const tsPath = `${translationsTsDir}/${language}.ts`;
        const module = await read(tsPath);
        // Everything around the JSON has to be the generator's own bytes before any of it is
        // rewritten, and the JSON itself has to survive a round-trip through this writer.
        const prefix = translationModulePrefix(language);
        assert(module.startsWith(prefix) && module.endsWith(";"), `${tsPath} is not the module it emits`);
        const tokensJson = module.slice(prefix.length, -1);
        const map = parseTranslations(tokensJson);
        assert(encodeTranslations(map) === tokensJson, `${tsPath} does not round-trip through this writer`);

        const renamed: TranslationMap = new Map();
        for (const [id, record] of map) {
            renamed.set(
                id,
                renameRecord(record, renameTranslation, emittedAt, counts, `${language} translation ${id}`)
            );
        }
        assert(renamed.size === map.size, `${language} lost a translation`);

        const renamedJson = encodeTranslations(renamed);
        await write(tsPath, createTranslationModule(language, renamedJson));
        log(`Successfully generated '${tsPath}'.`);

        // english.json is the same bytes the english module embeds — see OutputWriter.EmitOutputs.
        if (language === "english") {
            assert(tokensJson === (await read(englishJsonPath)), `${englishJsonPath} is not the embedded english map`);
            await write(englishJsonPath, renamedJson);
            log(`Successfully generated '${englishJsonPath}'.`);
        }
    }
}

async function main(): Promise<void> {
    const typesCs = await read(typesCsPath);
    const itemKeys = readEmittedKeys(typesCs, "CS2Item", "public class CS2ItemTranslation");
    const translationKeys = readEmittedKeys(typesCs, "CS2ItemTranslation", "public record VpkIndexEntry");
    const itemEmittedAt = new Map(itemKeys.map((key, at) => [key, at] as const));
    const translationEmittedAt = new Map(translationKeys.map((key, at) => [key, at] as const));
    for (const key of [...Object.values(renames), ...Object.values(rewrites).map(([key]) => key)]) {
        assert(itemEmittedAt.has(key), `Types.cs does not declare CS2Item.'${key}'`);
    }
    for (const key of Object.values(translationRenames)) {
        assert(translationEmittedAt.has(key), `Types.cs does not declare CS2ItemTranslation.'${key}'`);
    }

    // `category` is a key on both sides and means something different on each, so the two runs
    // count separately rather than reporting one conflated total.
    const itemCounts: Record<string, number> = {};
    const translationCounts: Record<string, number> = {};
    await renameItems(itemEmittedAt, itemCounts);
    await renameTranslations(translationEmittedAt, translationCounts);

    const total = Object.keys(renames).length + Object.keys(rewrites).length + Object.keys(translationRenames).length;
    log(`Renamed ${total} properties.`);
    for (const [from, to] of Object.entries(renames)) {
        log(`  CS2Item.${from} -> ${to} (${itemCounts[from] ?? 0} items)`);
    }
    for (const [from, [to, value]] of Object.entries(rewrites)) {
        log(`  CS2Item.${from} -> ${to}: ${JSON.stringify(value)} (${itemCounts[from] ?? 0} items)`);
    }
    for (const [from, to] of Object.entries(translationRenames)) {
        log(`  CS2ItemTranslation.${from} -> ${to} (${translationCounts[from] ?? 0} translations)`);
    }
}

await main();
