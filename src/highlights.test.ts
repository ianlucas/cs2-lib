/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, test } from "vitest";
import { CS2_CHARM_DETACHMENT_TOOL_DEFINITION_INDEX } from "./economy-constants.ts";
import { CS2RarityColor } from "./economy-container.ts";
import { type CS2Item, CS2ItemType } from "./economy-types.ts";
import { CS2EconomyInstance } from "./economy.ts";
import { checkAddable, checkHighlight, checkInventoryItem, repairInventoryItem } from "./inventory-rules.ts";
import type { CS2BaseInventoryItem } from "./inventory-types.ts";
import { CS2Inventory } from "./inventory.ts";

const SKIN_ID = 1;
const EVENT_CHARM_ID = 2;
const OTHER_EVENT_CHARM_ID = 3;
const PLAIN_CHARM_ID = 4;
const CHARM_DETACHMENT_ID = 5;
const HIGHLIGHT_ID = 10;
const SECOND_HIGHLIGHT_ID = 11;
const OTHER_EVENT_HIGHLIGHT_ID = 12;
const UNKNOWN_ID = 99;

const VIDEO_URL =
    "https://cdn.steamstatic.com/apps/csgo/videos/highlightreels/024/081v106_005/024_081v106_005_de_mirage_aus2025_chopper2kvsmouzonmirage1_ww_1080p.webm?v=1752707770";

function charm(id: number): CS2Item {
    return { id, type: CS2ItemType.Keychain, rarityColor: CS2RarityColor.Rare, definitionIndex: 1355 };
}

function highlight(id: number, parentId: number, variantIndex: number): CS2Item {
    return { id, type: CS2ItemType.Highlight, parentId, variantIndex, videoUrl: VIDEO_URL };
}

const economy = new CS2EconomyInstance();
economy.load({
    items: [
        { id: SKIN_ID, type: CS2ItemType.Weapon, rarityColor: CS2RarityColor.Common, variantIndex: 1 },
        charm(EVENT_CHARM_ID),
        charm(OTHER_EVENT_CHARM_ID),
        charm(PLAIN_CHARM_ID),
        {
            id: CHARM_DETACHMENT_ID,
            type: CS2ItemType.Tool,
            rarityColor: CS2RarityColor.Common,
            definitionIndex: CS2_CHARM_DETACHMENT_TOOL_DEFINITION_INDEX
        },
        highlight(HIGHLIGHT_ID, EVENT_CHARM_ID, 1),
        highlight(SECOND_HIGHLIGHT_ID, EVENT_CHARM_ID, 2),
        highlight(OTHER_EVENT_HIGHLIGHT_ID, OTHER_EVENT_CHARM_ID, 493)
    ]
});

function repair(item: CS2BaseInventoryItem): CS2BaseInventoryItem {
    expect(repairInventoryItem(economy, item)).toBe(true);
    return item;
}

describe("highlight economy items", () => {
    test("an event's charm lists the highlights it can play", () => {
        expect(economy.getById(EVENT_CHARM_ID).hasHighlights()).toBe(true);
        expect(
            economy
                .getById(EVENT_CHARM_ID)
                .getHighlights()
                .map(({ id }) => id)
        ).toEqual([HIGHLIGHT_ID, SECOND_HIGHLIGHT_ID]);
        expect(
            economy
                .getById(OTHER_EVENT_CHARM_ID)
                .getHighlights()
                .map(({ id }) => id)
        ).toEqual([OTHER_EVENT_HIGHLIGHT_ID]);
        expect(economy.getById(PLAIN_CHARM_ID).hasHighlights()).toBe(false);
        expect(economy.getById(PLAIN_CHARM_ID).getHighlights()).toEqual([]);
        expect(economy.getById(SKIN_ID).hasHighlights()).toBe(false);
        expect(() => economy.getById(SKIN_ID).getHighlights()).toThrow();
    });

    test("a highlight is parented to its charm and needs no rarity", () => {
        const item = economy.getById(HIGHLIGHT_ID);
        expect(item.isHighlight()).toBe(true);
        expect(item.parent?.id).toBe(EVENT_CHARM_ID);
        expect(() => item.expectHighlight()).not.toThrow();
        expect(() => economy.getById(EVENT_CHARM_ID).expectHighlight()).toThrow();
    });

    test("an event's charm has no seed", () => {
        expect(economy.getById(EVENT_CHARM_ID).hasSeed()).toBe(false);
        expect(economy.getById(PLAIN_CHARM_ID).hasSeed()).toBe(true);
        expect(economy.safeValidateSeed(42, economy.getById(EVENT_CHARM_ID))).toBe(false);
    });

    test("validateHighlight requires a highlight of the charm on an event's charm", () => {
        const eventCharm = economy.getById(EVENT_CHARM_ID);
        expect(economy.validateHighlight(undefined)).toBe(true);
        expect(economy.validateHighlight(undefined, economy.getById(SKIN_ID))).toBe(true);
        expect(economy.validateHighlight(undefined, economy.getById(PLAIN_CHARM_ID))).toBe(true);
        expect(() => economy.validateHighlight(undefined, eventCharm)).toThrow();
        expect(economy.validateHighlight(HIGHLIGHT_ID)).toBe(true);
        expect(economy.validateHighlight(HIGHLIGHT_ID, eventCharm)).toBe(true);
        expect(() => economy.validateHighlight(OTHER_EVENT_HIGHLIGHT_ID, eventCharm)).toThrow();
        expect(() => economy.validateHighlight(HIGHLIGHT_ID, economy.getById(PLAIN_CHARM_ID))).toThrow();
        expect(() => economy.validateHighlight(HIGHLIGHT_ID, economy.getById(SKIN_ID))).toThrow();
        expect(() => economy.validateHighlight(EVENT_CHARM_ID, eventCharm)).toThrow();
        expect(economy.safeValidateHighlight(UNKNOWN_ID, eventCharm)).toBe(false);
    });

    test("getVideoUrl plays the clip at 1080p or 480p", () => {
        const item = economy.getById(HIGHLIGHT_ID);
        expect(item.getVideoUrl()).toBe(VIDEO_URL);
        expect(item.getVideoUrl("1080p")).toBe(VIDEO_URL);
        expect(item.getVideoUrl("480p")).toBe(VIDEO_URL.replace("_1080p.webm", "_480p.webm"));
        expect(() => economy.getById(EVENT_CHARM_ID).getVideoUrl()).toThrow();
    });
});

describe("highlight inventory items", () => {
    test("a highlight is not an inventory item", () => {
        const inventory = new CS2Inventory({ economy });
        expect(checkAddable(economy.getById(HIGHLIGHT_ID))).toBe(false);
        expect(checkInventoryItem(economy, { id: HIGHLIGHT_ID })).toBe(false);
        expect(() => inventory.add({ id: HIGHLIGHT_ID })).toThrow();
        expect(inventory.size()).toBe(0);
        const loaded = new CS2Inventory({ economy, data: { items: { 0: { id: HIGHLIGHT_ID } }, version: 2 } });
        expect(loaded.size()).toBe(0);
        expect(loaded.loadChanges?.dropped).toEqual([{ uid: 0, id: HIGHLIGHT_ID, reason: "unrepairable" }]);
    });

    test("a loose event's charm holds a highlight of its own and no seed", () => {
        const inventory = new CS2Inventory({ economy });
        inventory.add({ id: EVENT_CHARM_ID, highlight: HIGHLIGHT_ID });
        expect(inventory.get(0).highlight).toBe(HIGHLIGHT_ID);
        expect(inventory.get(0).asBase().highlight).toBe(HIGHLIGHT_ID);
        expect(() => inventory.add({ id: EVENT_CHARM_ID })).toThrow();
        expect(() => inventory.add({ id: EVENT_CHARM_ID, highlight: HIGHLIGHT_ID, seed: 42 })).toThrow();
        expect(() => inventory.add({ id: EVENT_CHARM_ID, highlight: OTHER_EVENT_HIGHLIGHT_ID })).toThrow();
        expect(() => inventory.add({ id: PLAIN_CHARM_ID, highlight: HIGHLIGHT_ID })).toThrow();
        expect(() => inventory.add({ id: SKIN_ID, highlight: HIGHLIGHT_ID })).toThrow();
        expect(() => inventory.add({ id: EVENT_CHARM_ID, highlight: UNKNOWN_ID })).toThrow();
        expect(() => inventory.edit(0, { highlight: OTHER_EVENT_HIGHLIGHT_ID })).toThrow();
        expect(() => inventory.edit(0, { highlight: undefined })).toThrow();
        expect(() => inventory.edit(0, { seed: 42 })).toThrow();
        inventory.edit(0, { highlight: SECOND_HIGHLIGHT_ID });
        expect(inventory.get(0).highlight).toBe(SECOND_HIGHLIGHT_ID);
        inventory.add({ id: PLAIN_CHARM_ID, seed: 42 });
        expect(inventory.size()).toBe(2);
    });

    test("an attached event's charm holds a highlight of its own and no seed", () => {
        const inventory = new CS2Inventory({ economy });
        const keychains = (keychain: { id: number; highlight?: number; seed?: number }) => ({
            keychains: { 0: keychain }
        });
        inventory.add({ id: SKIN_ID, ...keychains({ id: EVENT_CHARM_ID, highlight: HIGHLIGHT_ID }) });
        expect(inventory.get(0).keychains?.get(0)?.highlight).toBe(HIGHLIGHT_ID);
        for (const keychain of [
            { id: EVENT_CHARM_ID },
            { id: EVENT_CHARM_ID, highlight: HIGHLIGHT_ID, seed: 42 },
            { id: EVENT_CHARM_ID, highlight: OTHER_EVENT_HIGHLIGHT_ID },
            { id: PLAIN_CHARM_ID, highlight: HIGHLIGHT_ID }
        ]) {
            expect(() => inventory.add({ id: SKIN_ID, ...keychains(keychain) })).toThrow();
            expect(() => inventory.edit(0, keychains(keychain))).toThrow();
        }
        expect(inventory.get(0).keychains?.get(0)?.highlight).toBe(HIGHLIGHT_ID);
        inventory.add({ id: SKIN_ID, ...keychains({ id: PLAIN_CHARM_ID, seed: 42 }) });
        expect(inventory.size()).toBe(2);
    });

    test("the highlight travels with the charm onto a weapon and back", () => {
        const inventory = new CS2Inventory({ economy });
        inventory.add({ id: EVENT_CHARM_ID, highlight: HIGHLIGHT_ID });
        inventory.addWithKeychain(0, SKIN_ID, { x: 1 });
        expect(inventory.get(0).keychains?.get(0)).toEqual({ highlight: HIGHLIGHT_ID, id: EVENT_CHARM_ID, x: 1 });

        inventory.add({ id: CHARM_DETACHMENT_ID });
        inventory.removeItemKeychain(0, 0);
        const detached = inventory.getAll().find((item) => item.id === EVENT_CHARM_ID);
        expect(detached?.highlight).toBe(HIGHLIGHT_ID);
        expect(detached?.seed).toBe(undefined);

        inventory.applyItemKeychain(0, detached!.uid);
        expect(inventory.get(0).keychains?.get(0)).toEqual({ highlight: HIGHLIGHT_ID, id: EVENT_CHARM_ID });
        inventory.editItemKeychain(0, 0, { x: 2 });
        expect(inventory.get(0).keychains?.get(0)?.highlight).toBe(HIGHLIGHT_ID);
    });

    test("a charm with a highlight survives a round trip", () => {
        const inventory = new CS2Inventory({ economy });
        inventory.add({ id: EVENT_CHARM_ID, highlight: HIGHLIGHT_ID });
        inventory.add({ id: SKIN_ID, keychains: { 0: { id: EVENT_CHARM_ID, highlight: SECOND_HIGHLIGHT_ID } } });
        const loaded = CS2Inventory.load(inventory.stringify(), { economy });
        expect(loaded.get(0).highlight).toBe(HIGHLIGHT_ID);
        expect(loaded.get(1).keychains?.get(0)?.highlight).toBe(SECOND_HIGHLIGHT_ID);
        expect(loaded.loadChanges?.repairedUids).toEqual([]);
    });
});

describe("highlight rules", () => {
    test("checkHighlight holds a highlight to the item carrying it", () => {
        expect(checkHighlight({}, economy.getById(SKIN_ID))).toBe(true);
        expect(checkHighlight({}, economy.getById(PLAIN_CHARM_ID))).toBe(true);
        expect(checkHighlight({}, economy.getById(EVENT_CHARM_ID))).toBe(false);
        expect(checkHighlight({ highlight: HIGHLIGHT_ID }, economy.getById(EVENT_CHARM_ID))).toBe(true);
        expect(checkHighlight({ highlight: HIGHLIGHT_ID }, economy.getById(OTHER_EVENT_CHARM_ID))).toBe(false);
        expect(checkHighlight({ highlight: HIGHLIGHT_ID }, economy.getById(SKIN_ID))).toBe(false);
    });

    test("repair drops a stray highlight and an event charm's seed", () => {
        expect(repair({ id: EVENT_CHARM_ID, highlight: HIGHLIGHT_ID })).toEqual({
            id: EVENT_CHARM_ID,
            highlight: HIGHLIGHT_ID
        });
        expect(repair({ id: EVENT_CHARM_ID, highlight: HIGHLIGHT_ID, seed: 7 }).seed).toBe(undefined);
        expect(repair({ id: PLAIN_CHARM_ID, highlight: HIGHLIGHT_ID, seed: 7 })).toEqual({
            id: PLAIN_CHARM_ID,
            seed: 7
        });
        expect(repair({ id: SKIN_ID, highlight: HIGHLIGHT_ID }).highlight).toBe(undefined);
        expect(
            repair({ id: SKIN_ID, keychains: { 0: { id: EVENT_CHARM_ID, highlight: HIGHLIGHT_ID, seed: 7 } } })
                .keychains
        ).toEqual({ 0: { id: EVENT_CHARM_ID, highlight: HIGHLIGHT_ID } });
        expect(
            repair({ id: SKIN_ID, keychains: { 0: { id: PLAIN_CHARM_ID, highlight: HIGHLIGHT_ID, seed: 7 } } })
                .keychains
        ).toEqual({ 0: { id: PLAIN_CHARM_ID, seed: 7 } });
    });

    test("repair removes an event's charm without a highlight of its own", () => {
        for (const highlight of [undefined, OTHER_EVENT_HIGHLIGHT_ID, UNKNOWN_ID]) {
            expect(repairInventoryItem(economy, { id: EVENT_CHARM_ID, highlight })).toBe(false);
            expect(
                repair({ id: SKIN_ID, keychains: { 0: { id: EVENT_CHARM_ID, highlight, seed: 7 } } }).keychains
            ).toEqual({});
        }
    });

    test("loading removes the event charms saved before highlights", () => {
        const loaded = new CS2Inventory({
            economy,
            data: {
                items: {
                    0: { id: SKIN_ID, keychains: { 0: { id: EVENT_CHARM_ID, seed: 7 } } },
                    1: { id: EVENT_CHARM_ID, seed: 7 },
                    2: { id: EVENT_CHARM_ID, highlight: HIGHLIGHT_ID },
                    3: { id: SKIN_ID, keychains: { 0: { id: PLAIN_CHARM_ID, highlight: HIGHLIGHT_ID } } }
                },
                version: 2
            }
        });
        expect(loaded.get(0).getKeychainsCount()).toBe(0);
        expect(loaded.get(2).highlight).toBe(HIGHLIGHT_ID);
        expect(loaded.get(3).keychains?.get(0)).toEqual({ id: PLAIN_CHARM_ID });
        expect(loaded.loadChanges?.dropped).toEqual([{ uid: 1, id: EVENT_CHARM_ID, reason: "unrepairable" }]);
        expect(loaded.loadChanges?.repairedUids).toEqual([0, 3]);
    });
});
