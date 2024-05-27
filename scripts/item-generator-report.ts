/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CS2ItemTeam, CS2ItemType } from "../src/economy-types.js";
import { CS2_ITEMS } from "../src/items.js";
import { assert, ensure } from "../src/utils.js";
import { log, readJson, shouldRun } from "./utils.js";

const v4BaseUrl = "https://raw.githubusercontent.com/ianlucas/cs2-lib/172d584a9b60f51ec8a197fe257d4ac8f4a8fd1b";

async function fetchFromV4(path: string) {
    return await (await fetch(`${v4BaseUrl}/${path}`)).json();
}

const v4PropertiesToV5 = {
    altname: "altName",
    collectiondesc: "collectionDesc",
    collectionid: "collection",
    collectionname: "collectionName",
    specialsimage: "specialsImage",
    stattrakless: "statTrakless",
    stattrakonly: "statTrakOnly",
    tournamentdesc: "tournamentDesc",
    vofallback: "voFallback",
    vofemale: "voFemale",
    voprefix: "voPrefix",
    wearmax: "wearMax",
    wearmin: "wearMin"
};

const v4TypeToV5 = {
    agent: CS2ItemType.Agent,
    case: CS2ItemType.Container,
    collectible: CS2ItemType.Collectible,
    glove: CS2ItemType.Gloves,
    graffiti: CS2ItemType.Graffiti,
    key: CS2ItemType.ContainerKey,
    melee: CS2ItemType.Melee,
    musickit: CS2ItemType.MusicKit,
    patch: CS2ItemType.Patch,
    sticker: CS2ItemType.Sticker,
    tool: CS2ItemType.Tool,
    weapon: CS2ItemType.Weapon
};

function v4TeamsToV5Teams(value: number[]) {
    const t = value.includes(2);
    const ct = value.includes(3);
    return t && ct ? CS2ItemTeam.Both : t ? CS2ItemTeam.T : CS2ItemTeam.CT;
}

function equals(a: any, b: any) {
    if (Array.isArray(a) && Array.isArray(b)) {
        return a.length === b.length && a.every((v, i) => v === b[i]);
    }
    return a === b;
}

async function testV5Upgrade() {
    const v4Items = new Map<number, any>(
        (await fetchFromV4("assets/data/items.json")).map((item: any) => [item.id, item])
    );
    const v5Items = new Map(CS2_ITEMS.map((item) => [item.id, item]));

    for (const v4Item of v4Items.values()) {
        const v5Item = ensure(v5Items.get(v4Item.id));
        for (let [v4Key, v4Value] of Object.entries<any>(v4Item)) {
            if (v4Key === "teams") {
                // Patches now don't have teams.
                v4Value = v4Item.type === "patch" ? undefined : v4TeamsToV5Teams(v4Value);
            }
            if (v4Key === "type") {
                v4Value = v4TypeToV5[v4Value];
            }
            if (v4Key === "base" && v4Item.type === "musickit" && !v4Item.free) {
                // Now paid Music Kits have `base` equals `undefined`.
                v4Value = undefined;
            }
            if (v4Key === "category" && ["tool", "case"].includes(v4Item.type)) {
                // Now Cases & Tools have `category` equals `undefined`.
                // They're moved to the language file.
                v4Value = undefined;
            }
            const v5Key = v4PropertiesToV5[v4Key] ?? v4Key;
            assert(
                equals(v5Item[v5Key], v4Value),
                `Item ${v4Item.id} has different value for ${v4Key} (${v4Value} vs ${v5Item[v5Key]})`
            );
        }
    }

    const v4English = await fetchFromV4("assets/translations/items-english.json");
    const v5English = readJson<any>("assets/translations/items-english.json");
    for (const [id, v4Translation] of Object.entries<any>(v4English)) {
        const v5Translation = ensure(v5English[id]);
        const v4Item = ensure(v4Items.get(Number(id)));
        const v5Item = ensure(v5Items.get(Number(id)));
        for (let [v4Key, v4Value] of Object.entries<any>(v4Translation)) {
            if (v4Key === "customdesc") {
                // `customdesc` is ditched in favor of `baseId`.
                continue;
            }
            if (v4Key === "desc") {
                if (
                    !["agent", "collectible", "case", "key", "tool"].includes(v4Item.type) &&
                    ((!v4Item.free && !v4Item.base) ||
                        ["musickit", "sticker", "patch", "graffiti"].includes(v4Item.type))
                ) {
                    // We assert that the baseId has v4's description.
                    // All (paid* OR with stub) items should have a `baseId`.
                    // * `agent`, `collectible` don't have `baseId`.
                    assert(v5Item.baseId !== undefined, `Item ${id} is expected to have a baseId`);
                    const baseV5Translation = v5English[v5Item.baseId];
                    assert(
                        baseV5Translation.desc === v4Value,
                        `Translation ${id} (${v5Item.baseId}) has different value for (base)desc ("""${v4Value}""" vs """${baseV5Translation.desc}""")`
                    );
                    v4Value = v4Translation.customdesc;
                }
                if (v4Item.type === "patch") {
                    // Patches didn't have description in v4.
                    v4Value = v5Translation.desc;
                }
            }
            const v5Key = v4PropertiesToV5[v4Key] ?? v4Key;
            assert(
                equals(v5Translation[v5Key], v4Value),
                `Translation ${id} has different value for ${v4Key} ("""${v4Value}""" vs """${v5Translation[v5Key]}""")`
            );
        }
    }
    log("All items and translations are upgraded correctly.");
}

async function main() {
    await testV5Upgrade();
    log("All tests passed.");
}

if (shouldRun(import.meta.url)) {
    main().catch(console.error);
}
