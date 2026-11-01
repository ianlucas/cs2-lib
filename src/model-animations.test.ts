/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, test } from "vitest";
import { CS2Economy } from "./economy.ts";
import { CS2_ITEMS } from "./items.ts";
import { CS2_MODEL_ANIMATIONS } from "./model-animations.ts";

const MIRROR = "https://mirror.example";
const CLIP = { path: "/animations/chicken.world.chick_idle01_0123abcd.json", skeleton: "chicken" } as const;

test("getAnimationUrl resolves a loaded clip against the assets base URL", () => {
    CS2Economy.load({
        animations: { "chicken/world/chick_idle01": CLIP },
        assetsBaseUrl: MIRROR,
        items: CS2_ITEMS
    });
    expect(CS2Economy.getAnimationUrl("chicken/world/chick_idle01")).toBe(`${MIRROR}${CLIP.path}`);
});

test("getAnimationUrl has no URL for a name no clip has", () => {
    CS2Economy.load({ animations: { "chicken/world/chick_idle01": CLIP }, items: CS2_ITEMS });
    for (const name of ["chick_idle01", "not_a_clip", "", "toString", "__proto__", "constructor"]) {
        expect(CS2Economy.getAnimationUrl(name), name).toBeUndefined();
    }
});

test("getAnimationUrl knows no clip until the animations are loaded", () => {
    CS2Economy.load({ animations: { "chicken/world/chick_idle01": CLIP }, items: CS2_ITEMS });
    CS2Economy.load({ items: CS2_ITEMS });
    expect(CS2Economy.getAnimationUrl("chicken/world/chick_idle01")).toBeUndefined();
});

const PLAYER_CLIP = {
    path: "/animations/chicken.snapshot.chick_snapshots_char01_0123abcd.json",
    skeleton: "character"
} as const;
const ANIMATIONS = {
    "chicken/world/chick_idle01": CLIP,
    "chicken/snapshot/chick_snapshots_char01": PLAYER_CLIP
};

test("getAnimationSkeleton names the skeleton a loaded clip is authored against", () => {
    CS2Economy.load({ animations: ANIMATIONS, items: CS2_ITEMS });
    expect(CS2Economy.getAnimationSkeleton("chicken/world/chick_idle01")).toBe("chicken");
    expect(CS2Economy.getAnimationSkeleton("chicken/snapshot/chick_snapshots_char01")).toBe("character");
});

test("getAnimationSkeleton has no skeleton for a name no clip has", () => {
    CS2Economy.load({ animations: ANIMATIONS, items: CS2_ITEMS });
    for (const name of ["chick_idle01", "not_a_clip", "", "toString", "__proto__", "constructor"]) {
        expect(CS2Economy.getAnimationSkeleton(name), name).toBeUndefined();
    }
    CS2Economy.load({ items: CS2_ITEMS });
    expect(CS2Economy.getAnimationSkeleton("chicken/world/chick_idle01")).toBeUndefined();
});

test("getAnimationNames lists the loaded clips, or those authored against a skeleton", () => {
    CS2Economy.load({ animations: ANIMATIONS, items: CS2_ITEMS });
    expect(CS2Economy.getAnimationNames()).toEqual([
        "chicken/world/chick_idle01",
        "chicken/snapshot/chick_snapshots_char01"
    ]);
    expect(CS2Economy.getAnimationNames("character")).toEqual(["chicken/snapshot/chick_snapshots_char01"]);
    expect(CS2Economy.getAnimationNames("egg")).toEqual([]);
    CS2Economy.load({ items: CS2_ITEMS });
    expect(CS2Economy.getAnimationNames()).toEqual([]);
});

describe.skipIf(Object.keys(CS2_MODEL_ANIMATIONS).length === 0)("CS2_MODEL_ANIMATIONS", () => {
    test("every clip is content-addressed under its own name", () => {
        for (const [name, { path }] of Object.entries(CS2_MODEL_ANIMATIONS)) {
            const stem = name.replace(/[/+]/g, ".");
            expect(path.startsWith(`/animations/${stem}_`), name).toBe(true);
            expect(path.slice(`/animations/${stem}`.length), name).toMatch(/^_[0-9a-f]{8}\.json$/);
        }
    });

    test("every clip names a skeleton", () => {
        for (const [name, { skeleton }] of Object.entries(CS2_MODEL_ANIMATIONS)) {
            expect(["character", "chicken", "egg", "viewmodel"], name).toContain(skeleton);
        }
    });

    test("every additive clip's absolute copy is named after it", () => {
        for (const name of Object.keys(CS2_MODEL_ANIMATIONS).filter((name) => name.endsWith("+non_additive"))) {
            expect(Object.hasOwn(CS2_MODEL_ANIMATIONS, name.slice(0, -"+non_additive".length)), name).toBe(true);
        }
    });
});
