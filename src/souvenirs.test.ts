/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, describe, expect, test, vi } from "vitest";
import { CS2RarityColor } from "./economy-container.ts";
import { CS2ContainerType, type CS2Item, CS2ItemType, CS2SouvenirStickerType } from "./economy-types.ts";
import { CS2EconomyInstance, type CS2SouvenirSource, composeSouvenirStickers } from "./economy.ts";
import { checkInventoryItem, checkSouvenir, repairInventoryItem } from "./inventory-rules.ts";
import type { CS2BaseInventoryItem } from "./inventory-types.ts";
import { CS2Inventory } from "./inventory.ts";

const SKIN_ID = 1;
const DEFAULT_WEAPON_ID = 2;
const KNIFE_SKIN_ID = 3;
const LOOSE_SKIN_ID = 4;
const HIGHLIGHT_SKIN_ID = 5;
const LEGACY_HIGHLIGHT_SKIN_ID = 6;

const KEYCHAIN_DEFAULT_LOCATION = [1, 0.5, 2, 1.2, 0.5, 2, 1, 0.6, 2.4, 1.2, 0.6, 2.4];
const LEGACY_KEYCHAIN_DEFAULT_LOCATION = [5, 0.1, 6, 5.1, 0.1, 6, 5, 0.1, 6.1, 5.1, 0.1, 6.1];

const LONE_EVENT_ID = 1;
const LONE_EVENT_STICKER_IDS = [10, 11];
const AUTOGRAPH_EVENT_ID = 7;
const AUTOGRAPH_EVENT_STICKER_ID = 12;
const AUTOGRAPH_TEAMS: Record<number, number[]> = { 1: [20, 30, 31], 2: [21, 32, 33], 3: [22, 34, 35] };
const MAP_EVENT_ID = 24;
const MAP_EVENT_STICKER_ID = 13;
const MAP_TEAMS: Record<number, number[]> = { 1: [23], 2: [24], 3: [25] };
const CRAFTED_EVENT_ID = 26;
const CRAFTED_TEAMS: Record<number, number[]> = { 1: [26, 40, 41], 2: [27, 42, 43], 3: [28, 44, 45] };
const MAP_STICKER_ID = 14;
const OTHER_MAP_STICKER_ID = 15;

const HIGHLIGHT_KEYCHAIN_ID = 50;
const HIGHLIGHT_ID = 51;
const LONE_PACKAGE_ID = 60;
const AUTOGRAPH_PACKAGE_ID = 61;
const MAP_PACKAGE_ID = 62;
const HIGHLIGHT_PACKAGE_ID = 63;
const BARE_PACKAGE_ID = 64;
const WEAPON_CASE_ID = 65;
const UNRELATED_STICKER_ID = 70;

const ROLLS = 200;

const logosOf = (teams: Record<number, number[]>) => Object.values(teams).map(([logo]) => logo!);
const autographsOf = (teams: Record<number, number[]>) => Object.values(teams).flatMap(([, ...rest]) => rest);

function buildItems({ crafted }: { crafted: boolean }): CS2Item[] {
    const stickers = new Map<number, CS2Item>();
    function sticker(id: number, type?: CS2SouvenirStickerType, eventId?: number, teamId?: number) {
        const item = stickers.get(id) ?? { id, type: CS2ItemType.Sticker, rarityColor: CS2RarityColor.Ancient };
        if (eventId !== undefined) {
            item.souvenirEventIds = [...(item.souvenirEventIds ?? []), eventId];
            item.souvenirStickerType = type;
            item.souvenirTeamId = teamId;
        }
        stickers.set(id, item);
    }
    function teams(eventId: number, teams: Record<number, number[]>) {
        for (const [teamId, [logo, ...autographs]] of Object.entries(teams)) {
            sticker(logo!, CS2SouvenirStickerType.Team, eventId, Number(teamId));
            for (const autograph of autographs) {
                sticker(autograph, CS2SouvenirStickerType.Autograph, eventId, Number(teamId));
            }
        }
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

    for (const id of LONE_EVENT_STICKER_IDS) {
        sticker(id, CS2SouvenirStickerType.Event, LONE_EVENT_ID);
    }
    sticker(AUTOGRAPH_EVENT_STICKER_ID, CS2SouvenirStickerType.Event, AUTOGRAPH_EVENT_ID);
    teams(AUTOGRAPH_EVENT_ID, AUTOGRAPH_TEAMS);
    sticker(MAP_EVENT_STICKER_ID, CS2SouvenirStickerType.Event, MAP_EVENT_ID);
    teams(MAP_EVENT_ID, MAP_TEAMS);
    for (const id of [MAP_STICKER_ID, OTHER_MAP_STICKER_ID]) {
        sticker(id, CS2SouvenirStickerType.Map, MAP_EVENT_ID);
    }
    if (crafted) {
        teams(CRAFTED_EVENT_ID, CRAFTED_TEAMS);
        for (const id of [MAP_STICKER_ID, OTHER_MAP_STICKER_ID]) {
            sticker(id, CS2SouvenirStickerType.Map, CRAFTED_EVENT_ID);
        }
    }
    sticker(UNRELATED_STICKER_ID);

    return [
        { id: SKIN_ID, type: CS2ItemType.Weapon, rarityColor: CS2RarityColor.Common, variantIndex: 1 },
        { id: DEFAULT_WEAPON_ID, type: CS2ItemType.Weapon, rarityColor: CS2RarityColor.Default, isDefault: true },
        { id: KNIFE_SKIN_ID, type: CS2ItemType.Melee, rarityColor: CS2RarityColor.Ancient, variantIndex: 1 },
        { id: LOOSE_SKIN_ID, type: CS2ItemType.Weapon, rarityColor: CS2RarityColor.Common, variantIndex: 2 },
        {
            id: HIGHLIGHT_SKIN_ID,
            type: CS2ItemType.Weapon,
            rarityColor: CS2RarityColor.Common,
            variantIndex: 3,
            stickerSchemaCount: 4,
            keychainDefaultLocation: KEYCHAIN_DEFAULT_LOCATION,
            legacyKeychainDefaultLocation: LEGACY_KEYCHAIN_DEFAULT_LOCATION
        },
        {
            id: LEGACY_HIGHLIGHT_SKIN_ID,
            type: CS2ItemType.Weapon,
            rarityColor: CS2RarityColor.Common,
            variantIndex: 4,
            isLegacyModel: true,
            keychainDefaultLocation: KEYCHAIN_DEFAULT_LOCATION,
            legacyKeychainDefaultLocation: LEGACY_KEYCHAIN_DEFAULT_LOCATION
        },
        ...stickers.values(),
        { id: HIGHLIGHT_KEYCHAIN_ID, type: CS2ItemType.Keychain, rarityColor: CS2RarityColor.Rare },
        {
            id: HIGHLIGHT_ID,
            type: CS2ItemType.Highlight,
            parentId: HIGHLIGHT_KEYCHAIN_ID,
            teamStickerIds: [MAP_TEAMS[3]![0]!, MAP_TEAMS[1]![0]!],
            variantIndex: 1
        },
        container(LONE_PACKAGE_ID, CS2ContainerType.SouvenirCase, { souvenirEventId: LONE_EVENT_ID }),
        container(AUTOGRAPH_PACKAGE_ID, CS2ContainerType.SouvenirCase, { souvenirEventId: AUTOGRAPH_EVENT_ID }),
        container(MAP_PACKAGE_ID, CS2ContainerType.SouvenirCase, {
            souvenirEventId: MAP_EVENT_ID,
            souvenirMapStickerId: MAP_STICKER_ID
        }),
        container(HIGHLIGHT_PACKAGE_ID, CS2ContainerType.SouvenirCase, {
            contentIds: [HIGHLIGHT_SKIN_ID],
            souvenirEventId: MAP_EVENT_ID,
            souvenirHighlightIds: [HIGHLIGHT_ID],
            souvenirMapStickerId: OTHER_MAP_STICKER_ID
        }),
        container(BARE_PACKAGE_ID, CS2ContainerType.SouvenirCase),
        container(WEAPON_CASE_ID, CS2ContainerType.WeaponCase)
    ];
}

const economy = new CS2EconomyInstance();
economy.load({ items: buildItems({ crafted: true }) });

const packagedEconomy = new CS2EconomyInstance();
packagedEconomy.load({ items: buildItems({ crafted: false }) });

function stickerIdsOf(stickers: Record<string, { id: number }> | undefined): number[] {
    return Object.values(stickers ?? {}).map(({ id }) => id);
}

function stickersOf(...ids: number[]): CS2BaseInventoryItem["stickers"] {
    return Object.fromEntries(ids.map((id, slot) => [slot, { id }]));
}

function contentOf(containerId: number) {
    return economy.getById(economy.getById(containerId).contentIds![0]!);
}

function unlock(id: number) {
    return economy.getById(id).unlockContainer().attributes;
}

function describeSource({ container, eventId, eventStickers, highlights, mapStickers, teams }: CS2SouvenirSource) {
    return {
        container: container?.id,
        eventId,
        eventStickers: eventStickers.map(({ id }) => id),
        highlights: highlights.map(({ id }) => id),
        mapStickers: mapStickers.map(({ id }) => id),
        teams: Object.fromEntries(
            teams.map(({ autographs, id, sticker }) => [id, [sticker.id, ...autographs.map(({ id }) => id)]])
        )
    };
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe("souvenir economy items", () => {
    test("only a weapon skin can be a souvenir", () => {
        expect(economy.getById(SKIN_ID).hasSouvenir()).toBe(true);
        expect(economy.getById(LOOSE_SKIN_ID).hasSouvenir()).toBe(true);
        for (const id of [DEFAULT_WEAPON_ID, KNIFE_SKIN_ID, AUTOGRAPH_EVENT_STICKER_ID, AUTOGRAPH_PACKAGE_ID]) {
            expect(economy.getById(id).hasSouvenir()).toBe(false);
        }
    });

    test("with no crafted event, only a skin a souvenir package drops can be a souvenir", () => {
        expect(packagedEconomy.getById(SKIN_ID).hasSouvenir()).toBe(true);
        expect(packagedEconomy.getById(LOOSE_SKIN_ID).hasSouvenir()).toBe(false);
        expect(packagedEconomy.getById(LOOSE_SKIN_ID).getSouvenirSources()).toEqual([]);
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

    test("a skin's souvenir sources are the packages that drop it and the crafted events", () => {
        expect(economy.getSouvenirContainers(SKIN_ID).map(({ id }) => id)).toEqual([
            LONE_PACKAGE_ID,
            AUTOGRAPH_PACKAGE_ID,
            MAP_PACKAGE_ID,
            BARE_PACKAGE_ID
        ]);
        expect(economy.getById(SKIN_ID).getSouvenirSources().map(describeSource)).toEqual([
            {
                container: LONE_PACKAGE_ID,
                eventId: LONE_EVENT_ID,
                eventStickers: LONE_EVENT_STICKER_IDS,
                highlights: [],
                mapStickers: [],
                teams: {}
            },
            {
                container: AUTOGRAPH_PACKAGE_ID,
                eventId: AUTOGRAPH_EVENT_ID,
                eventStickers: [AUTOGRAPH_EVENT_STICKER_ID],
                highlights: [],
                mapStickers: [],
                teams: AUTOGRAPH_TEAMS
            },
            {
                container: MAP_PACKAGE_ID,
                eventId: MAP_EVENT_ID,
                eventStickers: [MAP_EVENT_STICKER_ID],
                highlights: [],
                mapStickers: [MAP_STICKER_ID],
                teams: MAP_TEAMS
            },
            {
                container: undefined,
                eventId: CRAFTED_EVENT_ID,
                eventStickers: [],
                highlights: [],
                mapStickers: [MAP_STICKER_ID, OTHER_MAP_STICKER_ID],
                teams: CRAFTED_TEAMS
            }
        ]);
        expect(economy.getById(HIGHLIGHT_SKIN_ID).getSouvenirSources().map(describeSource)[0]).toMatchObject({
            container: HIGHLIGHT_PACKAGE_ID,
            highlights: [HIGHLIGHT_ID],
            mapStickers: [OTHER_MAP_STICKER_ID]
        });
        expect(
            economy
                .getById(LOOSE_SKIN_ID)
                .getSouvenirSources()
                .map(({ eventId }) => eventId)
        ).toEqual([CRAFTED_EVENT_ID]);
        expect(economy.getById(KNIFE_SKIN_ID).getSouvenirSources()).toEqual([]);
        expect(economy.getSouvenirContainerSource(BARE_PACKAGE_ID)).toBe(undefined);
        expect(() => economy.getSouvenirContainerSource(WEAPON_CASE_ID)).toThrow();
    });

    test("composeSouvenirStickers lays out the teams, the event, the autograph and the map", () => {
        const [team0, team1, event, autograph, map] = [21, 20, 12, 33, 14].map((id) => economy.getById(id));
        expect(
            stickerIdsOf(
                composeSouvenirStickers({ autograph, eventSticker: event, mapSticker: map, teams: [team0!, team1!] })
            )
        ).toEqual([21, 20, 12, 33, 14]);
        expect(composeSouvenirStickers({ autograph, mapSticker: map })).toEqual({ 0: { id: 33 }, 1: { id: 14 } });
        expect(composeSouvenirStickers({})).toBe(undefined);
    });

    test("rollKeychainDefaultPosition picks a point inside the model's default charm location", () => {
        const random = vi.spyOn(Math, "random");
        random.mockReturnValue(0);
        expect(economy.getById(HIGHLIGHT_SKIN_ID).rollKeychainDefaultPosition()).toEqual({ x: 1, y: 0.5, z: 2 });
        expect(economy.getById(LEGACY_HIGHLIGHT_SKIN_ID).rollKeychainDefaultPosition()).toEqual({ x: 5, y: 0.1, z: 6 });
        random.mockReturnValue(0.5);
        expect(economy.getById(HIGHLIGHT_SKIN_ID).rollKeychainDefaultPosition()).toEqual({ x: 1.1, y: 0.55, z: 2.2 });
        random.mockReturnValueOnce(1 / 3).mockReturnValueOnce(1 / 7);
        expect(economy.getById(HIGHLIGHT_SKIN_ID).rollKeychainDefaultPosition()).toEqual({
            x: 1.0667,
            y: 0.5143,
            z: 2.0571
        });
        expect(economy.getById(SKIN_ID).rollKeychainDefaultPosition()).toBe(undefined);
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
        expect(() => economy.getById(WEAPON_CASE_ID).rollSouvenirAttachments(contentOf(WEAPON_CASE_ID))).toThrow();
    });

    test("a package without teams gives one of the event's stickers", () => {
        const seen = new Set<number>();
        for (let roll = 0; roll < ROLLS; roll++) {
            const stickerIds = stickerIdsOf(unlock(LONE_PACKAGE_ID).stickers);
            expect(stickerIds).toHaveLength(1);
            seen.add(stickerIds[0]!);
        }
        expect(seen).toEqual(new Set(LONE_EVENT_STICKER_IDS));
    });

    test("an autograph package gives two teams, the event and one of their players", () => {
        const seen = new Set<number>();
        for (let roll = 0; roll < ROLLS; roll++) {
            const attributes = unlock(AUTOGRAPH_PACKAGE_ID);
            const [team0, team1, event, autograph, ...rest] = stickerIdsOf(attributes.stickers);
            const [teamId0, teamId1] = [team0, team1].map((logo) =>
                Object.keys(AUTOGRAPH_TEAMS).find((id) => AUTOGRAPH_TEAMS[Number(id)]![0] === logo)
            );
            expect(Object.keys(attributes.stickers ?? {})).toEqual(["0", "1", "2", "3"]);
            expect(rest).toEqual([]);
            expect(teamId0).not.toBe(undefined);
            expect(teamId1).not.toBe(undefined);
            expect(teamId0).not.toBe(teamId1);
            expect(event).toBe(AUTOGRAPH_EVENT_STICKER_ID);
            expect([
                ...AUTOGRAPH_TEAMS[Number(teamId0)]!.slice(1),
                ...AUTOGRAPH_TEAMS[Number(teamId1)]!.slice(1)
            ]).toContain(autograph);
            expect(attributes.keychains).toBe(undefined);
            seen.add(team0!).add(team1!).add(autograph!);
        }
        expect(seen).toEqual(new Set([...logosOf(AUTOGRAPH_TEAMS), ...autographsOf(AUTOGRAPH_TEAMS)]));
    });

    test("a map package gives the map's sticker in the autograph's place", () => {
        for (let roll = 0; roll < ROLLS; roll++) {
            const attributes = unlock(MAP_PACKAGE_ID);
            const [team0, team1, ...rest] = stickerIdsOf(attributes.stickers);
            expect(logosOf(MAP_TEAMS)).toContain(team0);
            expect(logosOf(MAP_TEAMS)).toContain(team1);
            expect(team0).not.toBe(team1);
            expect(rest).toEqual([MAP_EVENT_STICKER_ID, MAP_STICKER_ID]);
            expect(attributes.keychains).toBe(undefined);
        }
    });

    test("a highlight package always attaches one of its highlights, which sets the match", () => {
        for (let roll = 0; roll < ROLLS; roll++) {
            const attributes = unlock(HIGHLIGHT_PACKAGE_ID);
            expect(stickerIdsOf(attributes.stickers)).toEqual([
                MAP_TEAMS[3]![0],
                MAP_TEAMS[1]![0],
                MAP_EVENT_STICKER_ID,
                OTHER_MAP_STICKER_ID
            ]);
            expect(attributes.keychains?.[0]).toMatchObject({ highlight: HIGHLIGHT_ID, id: HIGHLIGHT_KEYCHAIN_ID });
        }
    });

    test("a highlight package's charm sits inside the weapon's default charm location", () => {
        for (let roll = 0; roll < ROLLS; roll++) {
            const { x, y, z } = unlock(HIGHLIGHT_PACKAGE_ID).keychains?.[0] ?? {};
            expect(x).toBeGreaterThanOrEqual(1);
            expect(x).toBeLessThanOrEqual(1.2);
            expect(y).toBeGreaterThanOrEqual(0.5);
            expect(y).toBeLessThanOrEqual(0.6);
            expect(z).toBeGreaterThanOrEqual(2);
            expect(z).toBeLessThanOrEqual(2.4);
        }
    });

    test("a package the catalog has no souvenir data for still drops a souvenir", () => {
        const attributes = unlock(BARE_PACKAGE_ID);
        expect(attributes.souvenir).toBe(true);
        expect(attributes.statTrak).toBe(undefined);
        expect(attributes.stickers).toBe(undefined);
        expect(attributes.keychains).toBe(undefined);
    });

    test("a package places its stickers in distinct random slots of the weapon", () => {
        const eventSlots = new Set<number | undefined>();
        for (let roll = 0; roll < ROLLS; roll++) {
            const stickers = Object.values(unlock(HIGHLIGHT_PACKAGE_ID).stickers ?? {});
            const schemas = stickers.map(({ schema }) => schema);
            expect(new Set(schemas).size).toBe(stickers.length);
            expect(schemas.every((schema) => schema !== undefined && schema >= 0 && schema < 4)).toBe(true);
            eventSlots.add(stickers.find(({ id }) => id === MAP_EVENT_STICKER_ID)?.schema);
        }
        expect(eventSlots).toEqual(new Set([0, 1, 2, 3]));
        const lone = new Set<number | undefined>();
        for (let roll = 0; roll < ROLLS; roll++) {
            lone.add(unlock(LONE_PACKAGE_ID).stickers?.[0]?.schema);
        }
        expect(lone).toEqual(new Set([0, 1, 2, 3, 4]));
    });

    test("every roll is a valid souvenir", () => {
        for (const id of [LONE_PACKAGE_ID, AUTOGRAPH_PACKAGE_ID, MAP_PACKAGE_ID, HIGHLIGHT_PACKAGE_ID]) {
            const container = economy.getById(id);
            for (let roll = 0; roll < ROLLS; roll++) {
                const { stickers } = container.rollSouvenirAttachments(contentOf(id));
                expect(checkSouvenir({ souvenir: true, stickers }, contentOf(id))).toBe(true);
            }
        }
    });
});

describe("souvenir stickers", () => {
    const fits = (id: number, ...stickerIds: number[]) =>
        checkSouvenir({ souvenir: true, stickers: stickersOf(...stickerIds) }, economy.getById(id));

    test("a souvenir's stickers are some of the ones one of its sources gives", () => {
        expect(fits(SKIN_ID)).toBe(true);
        expect(fits(SKIN_ID, 20, 21, AUTOGRAPH_EVENT_STICKER_ID, 31)).toBe(true);
        expect(fits(SKIN_ID, 21, 31)).toBe(true);
        expect(fits(SKIN_ID, 34)).toBe(true);
        expect(fits(SKIN_ID, 23, 24, MAP_EVENT_STICKER_ID, MAP_STICKER_ID)).toBe(true);
        expect(fits(SKIN_ID, LONE_EVENT_STICKER_IDS[1]!)).toBe(true);
        expect(fits(HIGHLIGHT_SKIN_ID, 25, 23, MAP_EVENT_STICKER_ID, OTHER_MAP_STICKER_ID)).toBe(true);
    });

    test("a souvenir is from one match", () => {
        expect(fits(SKIN_ID, 20, 20)).toBe(false);
        expect(fits(SKIN_ID, 20, 21, 22)).toBe(false);
        expect(fits(SKIN_ID, 20, 21, 30, 32)).toBe(false);
        expect(fits(SKIN_ID, 20, 21, 34)).toBe(false);
        expect(fits(SKIN_ID, AUTOGRAPH_EVENT_STICKER_ID, AUTOGRAPH_EVENT_STICKER_ID)).toBe(false);
        expect(fits(SKIN_ID, ...LONE_EVENT_STICKER_IDS)).toBe(false);
        expect(fits(SKIN_ID, 20, 23)).toBe(false);
        expect(fits(SKIN_ID, MAP_STICKER_ID, OTHER_MAP_STICKER_ID)).toBe(false);
        expect(fits(SKIN_ID, UNRELATED_STICKER_ID)).toBe(false);
    });

    test("a package's map sticker is its own", () => {
        expect(fits(SKIN_ID, 23, 24, MAP_EVENT_STICKER_ID, OTHER_MAP_STICKER_ID)).toBe(false);
        expect(fits(HIGHLIGHT_SKIN_ID, 23, 24, MAP_EVENT_STICKER_ID, MAP_STICKER_ID)).toBe(false);
    });

    test("an event's packages are the only way to its souvenirs", () => {
        expect(fits(LOOSE_SKIN_ID, 20, 21, AUTOGRAPH_EVENT_STICKER_ID, 31)).toBe(false);
        expect(fits(LOOSE_SKIN_ID, 23, 24, MAP_EVENT_STICKER_ID, MAP_STICKER_ID)).toBe(false);
    });

    test("any weapon skin can be crafted into a souvenir of a crafted event", () => {
        for (const id of [SKIN_ID, LOOSE_SKIN_ID, HIGHLIGHT_SKIN_ID]) {
            expect(fits(id, 26, 27, 43, OTHER_MAP_STICKER_ID)).toBe(true);
            expect(fits(id, 28, 26, 45, MAP_STICKER_ID)).toBe(true);
            expect(fits(id, 26, 27, 44, MAP_STICKER_ID)).toBe(false);
            expect(fits(id, 26, 27, AUTOGRAPH_EVENT_STICKER_ID)).toBe(false);
        }
        expect(fits(KNIFE_SKIN_ID, 26, 27)).toBe(false);
    });

    test("checkInventoryItem holds a souvenir to its stickers", () => {
        expect(checkInventoryItem(economy, { id: SKIN_ID, souvenir: true, stickers: stickersOf(20, 21) })).toBe(true);
        expect(checkInventoryItem(economy, { id: SKIN_ID, souvenir: true, stickers: stickersOf(20, 23) })).toBe(false);
        expect(checkInventoryItem(economy, { id: SKIN_ID, stickers: stickersOf(20, 23) })).toBe(true);
    });
});

describe("souvenir inventory items", () => {
    test("unlocking a package adds the souvenir with its stickers and charm", () => {
        const inventory = new CS2Inventory({ economy });
        inventory.add({ id: HIGHLIGHT_PACKAGE_ID });
        const unlocked = economy.getById(HIGHLIGHT_PACKAGE_ID).unlockContainer();
        inventory.unlockContainer(unlocked, 0);
        const item = inventory.get(0);
        expect(item.id).toBe(HIGHLIGHT_SKIN_ID);
        expect(item.souvenir).toBe(true);
        expect(item.statTrak).toBe(undefined);
        expect(item.containerId).toBe(HIGHLIGHT_PACKAGE_ID);
        expect(item.allStickers().map(([, { id, schema }]) => [id, schema])).toEqual(
            Object.values(unlocked.attributes.stickers ?? {}).map(({ id, schema }) => [id, schema])
        );
        expect(item.getStickersCount()).toBe(4);
        expect(item.keychains?.get(0)).toEqual(unlocked.attributes.keychains?.[0]);
    });

    test("a souvenir can be added directly", () => {
        const inventory = new CS2Inventory({ economy });
        inventory.add({
            id: SKIN_ID,
            souvenir: true,
            ...economy.getById(AUTOGRAPH_PACKAGE_ID).rollSouvenirAttachments(economy.getById(SKIN_ID))
        });
        expect(inventory.get(0).souvenir).toBe(true);
        expect(inventory.get(0).getStickersCount()).toBe(4);
        expect(inventory.get(0).asBase().souvenir).toBe(true);
        expect(() => inventory.add({ id: SKIN_ID, souvenir: true, stickers: stickersOf(20, 23) })).toThrow();
        expect(inventory.size()).toBe(1);
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

    test("an edit keeps a souvenir's stickers to its sources", () => {
        const inventory = new CS2Inventory({ economy });
        inventory.add({ id: SKIN_ID, souvenir: true, stickers: stickersOf(20) });
        inventory.edit(0, { stickers: stickersOf(20, 21, AUTOGRAPH_EVENT_STICKER_ID, 30) });
        expect(inventory.get(0).getStickersCount()).toBe(4);
        expect(() => inventory.edit(0, { stickers: stickersOf(20, 23) })).toThrow();
        expect(inventory.get(0).getStickersCount()).toBe(4);
    });

    test("no sticker can be applied to a souvenir", () => {
        const inventory = new CS2Inventory({ economy });
        inventory.add({ id: SKIN_ID, souvenir: true, stickers: stickersOf(20) });
        inventory.add({ id: 21 });
        expect(() => inventory.applyItemSticker(0, 1)).toThrow();
        expect(inventory.get(0).getStickersCount()).toBe(1);
        inventory.add({ id: SKIN_ID });
        inventory.applyItemSticker(2, 1);
        expect(inventory.get(2).getStickersCount()).toBe(1);
    });

    test("a souvenir's stickers can be moved and adjusted, but not swapped", () => {
        const inventory = new CS2Inventory({ economy });
        inventory.add({ id: SKIN_ID, souvenir: true, stickers: stickersOf(20, 21) });
        inventory.moveItemSticker(0, 0, 1);
        inventory.editItemSticker(0, 0, { id: 21, wear: 0.5 });
        expect(
            inventory
                .get(0)
                .allStickers()
                .map(([, { id, wear }]) => [id, wear])
        ).toEqual([
            [21, 0.5],
            [20, undefined]
        ]);
        expect(() => inventory.editItemSticker(0, 0, { id: 22 })).toThrow();
        expect(
            inventory
                .get(0)
                .allStickers()
                .map(([, { id }]) => id)
        ).toEqual([21, 20]);
    });

    test("a souvenir keeps its quality when its stickers are scraped off", () => {
        const inventory = new CS2Inventory({ economy });
        inventory.add({ id: SKIN_ID, souvenir: true, stickers: stickersOf(AUTOGRAPH_EVENT_STICKER_ID) });
        inventory.removeItemSticker(0, 0);
        expect(inventory.get(0).getStickersCount()).toBe(0);
        expect(inventory.get(0).souvenir).toBe(true);
    });

    test("a souvenir survives a round trip", () => {
        const inventory = new CS2Inventory({ economy });
        inventory.add({ id: SKIN_ID, souvenir: true, wear: 0.1, stickers: stickersOf(26, 27, 40, MAP_STICKER_ID) });
        const loaded = CS2Inventory.load(inventory.stringify(), { economy });
        expect(loaded.get(0).souvenir).toBe(true);
        expect(loaded.get(0).getStickersCount()).toBe(4);
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

    test("repair drops a souvenir quality no source gives its stickers", () => {
        const item: CS2BaseInventoryItem = { id: SKIN_ID, souvenir: true, stickers: stickersOf(20, 23) };
        expect(repairInventoryItem(economy, item)).toBe(true);
        expect(item.souvenir).toBe(undefined);
        expect(stickerIdsOf(item.stickers)).toEqual([20, 23]);
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
