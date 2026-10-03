/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, describe, expect, test, vi } from "vitest";
import { CS2RarityColor, CS2_SOUVENIR_HIGHLIGHT_ODD } from "./economy-container.ts";
import { CS2ContainerType, type CS2Item, CS2ItemType } from "./economy-types.ts";
import { CS2EconomyInstance } from "./economy.ts";
import { checkInventoryItem, checkSouvenir, repairInventoryItem } from "./inventory-rules.ts";
import type { CS2BaseInventoryItem } from "./inventory-types.ts";
import { CS2Inventory } from "./inventory.ts";

const SKIN_ID = 1;
const DEFAULT_WEAPON_ID = 2;
const KNIFE_SKIN_ID = 3;
const EVENT_STICKER_ID = 10;
const OTHER_EVENT_STICKER_ID = 11;
const MAP_STICKER_ID = 12;
const TEAM_A_STICKER_ID = 20;
const TEAM_B_STICKER_ID = 21;
const TEAM_C_STICKER_ID = 22;
const TEAM_A_AUTOGRAPH_IDS = [30, 31];
const TEAM_B_AUTOGRAPH_IDS = [32, 33];
const TEAM_C_AUTOGRAPH_IDS = [34, 35];
const HIGHLIGHT_KEYCHAIN_ID = 40;
const HIGHLIGHT_ID = 41;
const LONE_PACKAGE_ID = 50;
const AUTOGRAPH_PACKAGE_ID = 51;
const MAP_PACKAGE_ID = 52;
const HIGHLIGHT_PACKAGE_ID = 53;
const BARE_PACKAGE_ID = 54;
const WEAPON_CASE_ID = 55;

const TEAM_STICKER_IDS = [TEAM_A_STICKER_ID, TEAM_B_STICKER_ID, TEAM_C_STICKER_ID];
const AUTOGRAPH_IDS_BY_TEAM: Record<number, number[]> = {
    [TEAM_A_STICKER_ID]: TEAM_A_AUTOGRAPH_IDS,
    [TEAM_B_STICKER_ID]: TEAM_B_AUTOGRAPH_IDS,
    [TEAM_C_STICKER_ID]: TEAM_C_AUTOGRAPH_IDS
};
const ROLLS = 200;

function sticker(id: number): CS2Item {
    return { id, type: CS2ItemType.Sticker, rarityColor: CS2RarityColor.Ancient };
}

function container(id: number, containerType: CS2ContainerType, souvenir: Partial<CS2Item> = {}): CS2Item {
    return {
        id,
        type: CS2ItemType.Container,
        rarityColor: CS2RarityColor.Common,
        containerType,
        contentIds: [SKIN_ID],
        ...souvenir
    };
}

// The catalog is published by the Update workflow, so the packages carry no souvenir data in
// CS2_ITEMS until it runs. These mirror what the item generator emits for each era.
const economy = new CS2EconomyInstance();
economy.load({
    items: [
        { id: SKIN_ID, type: CS2ItemType.Weapon, rarityColor: CS2RarityColor.Common, variantIndex: 1 },
        { id: DEFAULT_WEAPON_ID, type: CS2ItemType.Weapon, rarityColor: CS2RarityColor.Default, isDefault: true },
        { id: KNIFE_SKIN_ID, type: CS2ItemType.Melee, rarityColor: CS2RarityColor.Ancient, variantIndex: 1 },
        ...[EVENT_STICKER_ID, OTHER_EVENT_STICKER_ID, MAP_STICKER_ID, ...TEAM_STICKER_IDS].map(sticker),
        ...Object.values(AUTOGRAPH_IDS_BY_TEAM).flat().map(sticker),
        { id: HIGHLIGHT_KEYCHAIN_ID, type: CS2ItemType.Keychain, rarityColor: CS2RarityColor.Rare },
        {
            id: HIGHLIGHT_ID,
            type: CS2ItemType.Highlight,
            parentId: HIGHLIGHT_KEYCHAIN_ID,
            teamStickerIds: [TEAM_C_STICKER_ID, TEAM_A_STICKER_ID],
            variantIndex: 1
        },
        container(LONE_PACKAGE_ID, CS2ContainerType.SouvenirCase, {
            souvenirEventStickerIds: [EVENT_STICKER_ID, OTHER_EVENT_STICKER_ID]
        }),
        container(AUTOGRAPH_PACKAGE_ID, CS2ContainerType.SouvenirCase, {
            souvenirEventStickerIds: [EVENT_STICKER_ID],
            souvenirTeamStickerIds: TEAM_STICKER_IDS.map((id) => [id, ...AUTOGRAPH_IDS_BY_TEAM[id]!])
        }),
        container(MAP_PACKAGE_ID, CS2ContainerType.SouvenirCase, {
            souvenirEventStickerIds: [EVENT_STICKER_ID],
            souvenirMapStickerId: MAP_STICKER_ID,
            souvenirTeamStickerIds: TEAM_STICKER_IDS.map((id) => [id])
        }),
        container(HIGHLIGHT_PACKAGE_ID, CS2ContainerType.SouvenirCase, {
            souvenirEventStickerIds: [EVENT_STICKER_ID],
            souvenirHighlightIds: [HIGHLIGHT_ID],
            souvenirMapStickerId: MAP_STICKER_ID,
            souvenirTeamStickerIds: TEAM_STICKER_IDS.map((id) => [id])
        }),
        container(BARE_PACKAGE_ID, CS2ContainerType.SouvenirCase),
        container(WEAPON_CASE_ID, CS2ContainerType.WeaponCase)
    ]
});

function stickerIdsOf(stickers: Record<string, { id: number }> | undefined): number[] {
    return Object.values(stickers ?? {}).map(({ id }) => id);
}

function unlock(id: number, options?: { highlight?: boolean }) {
    return economy.getById(id).unlockContainer(options).attributes;
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe("souvenir economy items", () => {
    test("only a weapon skin can be a souvenir", () => {
        expect(economy.getById(SKIN_ID).hasSouvenir()).toBe(true);
        for (const id of [DEFAULT_WEAPON_ID, KNIFE_SKIN_ID, EVENT_STICKER_ID, AUTOGRAPH_PACKAGE_ID]) {
            expect(economy.getById(id).hasSouvenir()).toBe(false);
        }
    });

    test("validateSouvenir accepts only true on an item that can be a souvenir", () => {
        const skin = economy.getById(SKIN_ID);
        expect(economy.validateSouvenir(undefined)).toBe(true);
        expect(economy.validateSouvenir(undefined, economy.getById(KNIFE_SKIN_ID))).toBe(true);
        expect(economy.validateSouvenir(true)).toBe(true);
        expect(economy.validateSouvenir(true, skin)).toBe(true);
        expect(() => economy.validateSouvenir(false, skin)).toThrow();
        expect(() => economy.validateSouvenir(true, economy.getById(KNIFE_SKIN_ID))).toThrow();
        expect(economy.safeValidateSouvenir(true, economy.getById(DEFAULT_WEAPON_ID))).toBe(false);
    });
});

describe("unlocking a souvenir package", () => {
    test("the item is a souvenir and never StatTrak", () => {
        for (let roll = 0; roll < ROLLS; roll++) {
            const attributes = unlock(AUTOGRAPH_PACKAGE_ID);
            expect(attributes.souvenir).toBe(true);
            expect(attributes.statTrak).toBe(undefined);
            expect(attributes.containerId).toBe(AUTOGRAPH_PACKAGE_ID);
        }
    });

    test("a weapon case still drops a regular item", () => {
        const statTraks = new Set<number | undefined>();
        for (let roll = 0; roll < ROLLS; roll++) {
            const attributes = unlock(WEAPON_CASE_ID);
            expect(attributes.souvenir).toBe(undefined);
            expect(attributes.stickers).toBe(undefined);
            expect(attributes.keychains).toBe(undefined);
            statTraks.add(attributes.statTrak);
        }
        expect(statTraks).toEqual(new Set([0, undefined]));
        expect(() => economy.getById(WEAPON_CASE_ID).rollSouvenirAttachments()).toThrow();
    });

    test("a package without teams gives one of the event's stickers", () => {
        const seen = new Set<number>();
        for (let roll = 0; roll < ROLLS; roll++) {
            const stickerIds = stickerIdsOf(unlock(LONE_PACKAGE_ID).stickers);
            expect(stickerIds).toHaveLength(1);
            seen.add(stickerIds[0]!);
        }
        expect(seen).toEqual(new Set([EVENT_STICKER_ID, OTHER_EVENT_STICKER_ID]));
    });

    test("an autograph package gives two teams, the event and one of their players", () => {
        const seen = new Set<number>();
        for (let roll = 0; roll < ROLLS; roll++) {
            const attributes = unlock(AUTOGRAPH_PACKAGE_ID);
            const [team0, team1, event, autograph, ...rest] = stickerIdsOf(attributes.stickers);
            expect(Object.keys(attributes.stickers ?? {})).toEqual(["0", "1", "2", "3"]);
            expect(rest).toEqual([]);
            expect(TEAM_STICKER_IDS).toContain(team0);
            expect(TEAM_STICKER_IDS).toContain(team1);
            expect(team0).not.toBe(team1);
            expect(event).toBe(EVENT_STICKER_ID);
            expect([...AUTOGRAPH_IDS_BY_TEAM[team0!]!, ...AUTOGRAPH_IDS_BY_TEAM[team1!]!]).toContain(autograph);
            expect(attributes.keychains).toBe(undefined);
            seen.add(team0!).add(team1!).add(autograph!);
        }
        expect(seen).toEqual(new Set([...TEAM_STICKER_IDS, ...Object.values(AUTOGRAPH_IDS_BY_TEAM).flat()]));
    });

    test("a map package gives the map's sticker in the autograph's place", () => {
        for (let roll = 0; roll < ROLLS; roll++) {
            const attributes = unlock(MAP_PACKAGE_ID, { highlight: true });
            const [team0, team1, ...rest] = stickerIdsOf(attributes.stickers);
            expect(TEAM_STICKER_IDS).toContain(team0);
            expect(TEAM_STICKER_IDS).toContain(team1);
            expect(team0).not.toBe(team1);
            expect(rest).toEqual([EVENT_STICKER_ID, MAP_STICKER_ID]);
            expect(attributes.keychains).toBe(undefined);
        }
    });

    test("a highlight sets the match and plays on the charm", () => {
        const attributes = unlock(HIGHLIGHT_PACKAGE_ID, { highlight: true });
        expect(stickerIdsOf(attributes.stickers)).toEqual([
            TEAM_C_STICKER_ID,
            TEAM_A_STICKER_ID,
            EVENT_STICKER_ID,
            MAP_STICKER_ID
        ]);
        expect(attributes.keychains).toStrictEqual({ 0: { highlight: HIGHLIGHT_ID, id: HIGHLIGHT_KEYCHAIN_ID } });
        for (let roll = 0; roll < ROLLS; roll++) {
            expect(unlock(HIGHLIGHT_PACKAGE_ID, { highlight: false }).keychains).toBe(undefined);
        }
    });

    test("a highlight is rolled at CS2_SOUVENIR_HIGHLIGHT_ODD when not chosen", () => {
        const random = vi.spyOn(Math, "random");
        random.mockReturnValue(CS2_SOUVENIR_HIGHLIGHT_ODD);
        expect(economy.getById(HIGHLIGHT_PACKAGE_ID).rollSouvenirAttachments().keychains).not.toBe(undefined);
        random.mockReturnValue(CS2_SOUVENIR_HIGHLIGHT_ODD + 0.01);
        expect(economy.getById(HIGHLIGHT_PACKAGE_ID).rollSouvenirAttachments().keychains).toBe(undefined);
    });

    test("a package the catalog has no souvenir data for still drops a souvenir", () => {
        const attributes = unlock(BARE_PACKAGE_ID, { highlight: true });
        expect(attributes.souvenir).toBe(true);
        expect(attributes.statTrak).toBe(undefined);
        expect(attributes.stickers).toBe(undefined);
        expect(attributes.keychains).toBe(undefined);
    });
});

describe("souvenir inventory items", () => {
    test("unlocking a package adds the souvenir with its stickers and charm", () => {
        const inventory = new CS2Inventory({ economy });
        inventory.add({ id: HIGHLIGHT_PACKAGE_ID });
        const unlocked = economy.getById(HIGHLIGHT_PACKAGE_ID).unlockContainer({ highlight: true });
        inventory.unlockContainer(unlocked, 0);
        const item = inventory.get(0);
        expect(item.id).toBe(SKIN_ID);
        expect(item.souvenir).toBe(true);
        expect(item.statTrak).toBe(undefined);
        expect(item.containerId).toBe(HIGHLIGHT_PACKAGE_ID);
        expect(item.allStickers().map(([, { id, schema }]) => [id, schema])).toEqual([
            [TEAM_C_STICKER_ID, 0],
            [TEAM_A_STICKER_ID, 1],
            [EVENT_STICKER_ID, 2],
            [MAP_STICKER_ID, 3]
        ]);
        expect(item.keychains?.get(0)).toEqual(unlocked.attributes.keychains?.[0]);
    });

    test("a souvenir can be added directly", () => {
        const inventory = new CS2Inventory({ economy });
        inventory.add({
            id: SKIN_ID,
            souvenir: true,
            ...economy.getById(AUTOGRAPH_PACKAGE_ID).rollSouvenirAttachments()
        });
        expect(inventory.get(0).souvenir).toBe(true);
        expect(inventory.get(0).getStickersCount()).toBe(4);
        expect(inventory.get(0).asBase().souvenir).toBe(true);
    });

    test("a souvenir cannot be StatTrak, a knife or a default weapon", () => {
        const inventory = new CS2Inventory({ economy });
        expect(() => inventory.add({ id: SKIN_ID, souvenir: true, statTrak: 0 })).toThrow();
        expect(() => inventory.add({ id: KNIFE_SKIN_ID, souvenir: true })).toThrow();
        expect(() => inventory.add({ id: DEFAULT_WEAPON_ID, souvenir: true })).toThrow();
        expect(() => inventory.add({ id: SKIN_ID, souvenir: false })).toThrow();
        expect(inventory.size()).toBe(0);
    });

    test("an edit cannot make a souvenir StatTrak or a StatTrak item a souvenir", () => {
        const inventory = new CS2Inventory({ economy });
        inventory.add({ id: SKIN_ID, souvenir: true });
        inventory.add({ id: SKIN_ID, statTrak: 7 });
        expect(() => inventory.edit(0, { statTrak: 0 })).toThrow();
        expect(() => inventory.edit(1, { souvenir: true })).toThrow();
        expect(inventory.get(0).statTrak).toBe(undefined);
        expect(inventory.get(1).souvenir).toBe(undefined);
        inventory.edit(0, { souvenir: undefined, statTrak: 0 });
        expect(inventory.get(0).souvenir).toBe(undefined);
        expect(inventory.get(0).statTrak).toBe(0);
    });

    test("a souvenir keeps its quality when its stickers are scraped off", () => {
        const inventory = new CS2Inventory({ economy });
        inventory.add({ id: SKIN_ID, souvenir: true, stickers: { 0: { id: EVENT_STICKER_ID } } });
        inventory.removeItemSticker(0, 0);
        expect(inventory.get(0).getStickersCount()).toBe(0);
        expect(inventory.get(0).souvenir).toBe(true);
    });

    test("a souvenir survives a round trip", () => {
        const inventory = new CS2Inventory({ economy });
        inventory.add({ id: SKIN_ID, souvenir: true, wear: 0.1 });
        const loaded = CS2Inventory.load(inventory.stringify(), { economy });
        expect(loaded.get(0).souvenir).toBe(true);
        expect(loaded.loadChanges?.repairedUids).toEqual([]);
    });
});

describe("souvenir rules", () => {
    test("checkSouvenir rejects what the game does not allow", () => {
        const skin = economy.getById(SKIN_ID);
        expect(checkSouvenir({}, skin)).toBe(true);
        expect(checkSouvenir({ statTrak: 0 }, skin)).toBe(true);
        expect(checkSouvenir({ souvenir: true }, skin)).toBe(true);
        expect(checkSouvenir({ souvenir: true, statTrak: 0 }, skin)).toBe(false);
        expect(checkSouvenir({ souvenir: false }, skin)).toBe(false);
        expect(checkSouvenir({ souvenir: true }, economy.getById(KNIFE_SKIN_ID))).toBe(false);
        expect(checkInventoryItem(economy, { id: SKIN_ID, souvenir: true })).toBe(true);
        expect(checkInventoryItem(economy, { id: SKIN_ID, souvenir: true, statTrak: 0 })).toBe(false);
    });

    test("repair drops a souvenir quality the item cannot hold", () => {
        const repair = (item: CS2BaseInventoryItem) => {
            expect(repairInventoryItem(economy, item)).toBe(true);
            return item;
        };
        expect(repair({ id: SKIN_ID, souvenir: true }).souvenir).toBe(true);
        expect(repair({ id: SKIN_ID, souvenir: false }).souvenir).toBe(undefined);
        expect(repair({ id: KNIFE_SKIN_ID, souvenir: true }).souvenir).toBe(undefined);
        expect(repair({ id: DEFAULT_WEAPON_ID, souvenir: true }).souvenir).toBe(undefined);
        expect(repair({ id: SKIN_ID, souvenir: true, statTrak: 12 })).toEqual({
            id: SKIN_ID,
            souvenir: undefined,
            statTrak: 12
        });
    });

    test("loading reports an item whose souvenir quality was dropped", () => {
        const loaded = new CS2Inventory({
            economy,
            data: { items: { 0: { id: KNIFE_SKIN_ID, souvenir: true } }, version: 2 }
        });
        expect(loaded.get(0).souvenir).toBe(undefined);
        expect(loaded.loadChanges?.repairedUids).toEqual([0]);
    });
});
