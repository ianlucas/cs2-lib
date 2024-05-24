/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CS2_ITEMS } from "../src/items.js";
import { Cs2ItemTeam, Cs2ItemType } from "../src/new-economy.js";
import { assert } from "../src/util";
import { ensure, log, readJson, shouldRun } from "./util";

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
    agent: Cs2ItemType.Agent,
    case: Cs2ItemType.Container,
    collectible: Cs2ItemType.Collectible,
    glove: Cs2ItemType.Gloves,
    graffiti: Cs2ItemType.Graffiti,
    key: Cs2ItemType.ContainerKey,
    melee: Cs2ItemType.Melee,
    musickit: Cs2ItemType.MusicKit,
    patch: Cs2ItemType.Patch,
    sticker: Cs2ItemType.Sticker,
    tool: Cs2ItemType.Tool,
    weapon: Cs2ItemType.Weapon
};

function v4TeamsToV5Teams(value: number[]) {
    const t = value.includes(2);
    const ct = value.includes(3);
    return t && ct ? Cs2ItemTeam.Both : t ? Cs2ItemTeam.T : Cs2ItemTeam.CT;
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
