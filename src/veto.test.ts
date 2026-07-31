/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, test } from "vitest";
import {
    CS2_ANCIENT_MAP,
    CS2_ANUBIS_MAP,
    CS2_DUST2_MAP,
    CS2_INFERNO_MAP,
    CS2_MIRAGE_MAP,
    CS2_NUKE_MAP,
    CS2_TRAIN_MAP
} from "./maps.ts";
import { CS2Veto, CS2VetoAction } from "./veto.ts";

const MAP_POOL = [
    CS2_ANCIENT_MAP,
    CS2_ANUBIS_MAP,
    CS2_DUST2_MAP,
    CS2_INFERNO_MAP,
    CS2_MIRAGE_MAP,
    CS2_NUKE_MAP,
    CS2_TRAIN_MAP
];

test("bo1", () => {
    const veto = new CS2Veto("bo1", MAP_POOL);
    expect(veto.getCurrentTeam()).toBe(0);
    expect(veto.choose("de_nuke")).toBe(true);
    expect(veto.getCurrentTeam()).toBe(1);
    expect(veto.choose("de_train")).toBe(true);
    expect(veto.getCurrentTeam()).toBe(0);
    expect(veto.choose("de_ancient")).toBe(true);
    expect(veto.getCurrentTeam()).toBe(1);
    expect(veto.choose("de_anubis")).toBe(true);
    expect(veto.getCurrentTeam()).toBe(0);
    expect(veto.choose("de_inferno")).toBe(true);
    expect(veto.getCurrentTeam()).toBe(1);
    expect(veto.choose("de_dust2")).toBe(true);
    expect(veto.isDone()).toBe(true);
    expect(veto.choose("de_mirage")).toBe(false);
    expect(veto.getMatchMapnames()).toStrictEqual(["de_mirage"]);
    expect(veto.getHistory()).toStrictEqual([
        { action: CS2VetoAction.Ban, mapname: "de_nuke", team: 0 },
        { action: CS2VetoAction.Ban, mapname: "de_train", team: 1 },
        { action: CS2VetoAction.Ban, mapname: "de_ancient", team: 0 },
        { action: CS2VetoAction.Ban, mapname: "de_anubis", team: 1 },
        { action: CS2VetoAction.Ban, mapname: "de_inferno", team: 0 },
        { action: CS2VetoAction.Ban, mapname: "de_dust2", team: 1 },
        { mapname: "de_mirage" }
    ]);
});

test("bo2-a", () => {
    const veto = new CS2Veto("bo2", MAP_POOL, undefined, 0);
    expect(veto.getCurrentTeam()).toBe(0);
    expect(veto.getCurrentAction()).toBe(CS2VetoAction.Ban);
    expect(veto.choose("de_nuke")).toBe(true);
    expect(veto.getCurrentTeam()).toBe(1);
    expect(veto.getCurrentAction()).toBe(CS2VetoAction.Ban);
    expect(veto.choose("de_train")).toBe(true);
    expect(veto.getCurrentTeam()).toBe(0);
    expect(veto.getCurrentAction()).toBe(CS2VetoAction.Ban);
    expect(veto.choose("de_ancient")).toBe(true);
    expect(veto.getCurrentTeam()).toBe(1);
    expect(veto.getCurrentAction()).toBe(CS2VetoAction.Ban);
    expect(veto.choose("de_anubis")).toBe(true);
    expect(veto.getCurrentTeam()).toBe(0);
    expect(veto.getCurrentAction()).toBe(CS2VetoAction.Ban);
    expect(veto.choose("de_inferno")).toBe(true);
    expect(veto.getCurrentAction()).toBe(undefined);
    expect(veto.isDone()).toBe(true);
    expect(veto.choose("de_dust2")).toBe(false);
    expect(veto.choose("de_mirage")).toBe(false);
    expect(veto.getMatchMapnames()).toStrictEqual(["de_dust2", "de_mirage"]);
});

test("bo2-b", () => {
    const veto = new CS2Veto("bo2", MAP_POOL, undefined, 1);
    expect(veto.getCurrentTeam()).toBe(1);
    expect(veto.choose("de_nuke")).toBe(true);
    expect(veto.getCurrentTeam()).toBe(0);
    expect(veto.choose("de_train")).toBe(true);
    expect(veto.getCurrentTeam()).toBe(1);
    expect(veto.choose("de_ancient")).toBe(true);
    expect(veto.getCurrentTeam()).toBe(0);
    expect(veto.choose("de_anubis")).toBe(true);
    expect(veto.getCurrentTeam()).toBe(1);
    expect(veto.choose("de_inferno")).toBe(true);
    expect(veto.choose("de_dust2")).toBe(false);
    expect(veto.choose("de_mirage")).toBe(false);
    expect(veto.getMatchMapnames()).toStrictEqual(["de_dust2", "de_mirage"]);
});

test("bo3", () => {
    const veto = new CS2Veto("bo3", MAP_POOL);
    expect(veto.getCurrentTeam()).toBe(0);
    expect(veto.getCurrentAction()).toBe(CS2VetoAction.Ban);
    expect(veto.choose("de_nuke")).toBe(true);
    expect(veto.getCurrentTeam()).toBe(1);
    expect(veto.getCurrentAction()).toBe(CS2VetoAction.Ban);
    expect(veto.choose("de_train")).toBe(true);
    expect(veto.getCurrentTeam()).toBe(0);
    expect(veto.getCurrentAction()).toBe(CS2VetoAction.Pick);
    expect(veto.choose("de_ancient")).toBe(true);
    expect(veto.getCurrentTeam()).toBe(1);
    expect(veto.getCurrentAction()).toBe(CS2VetoAction.Pick);
    expect(veto.choose("de_anubis")).toBe(true);
    expect(veto.getCurrentTeam()).toBe(0);
    expect(veto.getCurrentAction()).toBe(CS2VetoAction.Ban);
    expect(veto.choose("de_inferno")).toBe(true);
    expect(veto.getCurrentTeam()).toBe(1);
    expect(veto.getCurrentAction()).toBe(CS2VetoAction.Ban);
    expect(veto.choose("de_dust2")).toBe(true);
    expect(veto.choose("de_mirage")).toBe(false);
    expect(veto.getMatchMapnames()).toStrictEqual(["de_ancient", "de_anubis", "de_mirage"]);
    expect(veto.getHistory()).toStrictEqual([
        { action: CS2VetoAction.Ban, mapname: "de_nuke", team: 0 },
        { action: CS2VetoAction.Ban, mapname: "de_train", team: 1 },
        { action: CS2VetoAction.Pick, mapname: "de_ancient", team: 0 },
        { action: CS2VetoAction.Pick, mapname: "de_anubis", team: 1 },
        { action: CS2VetoAction.Ban, mapname: "de_inferno", team: 0 },
        { action: CS2VetoAction.Ban, mapname: "de_dust2", team: 1 },
        { mapname: "de_mirage" }
    ]);
    expect(veto.getMaps().find((map) => map.mapname === "de_ancient")).toStrictEqual({
        action: CS2VetoAction.Pick,
        mapname: "de_ancient",
        team: 0
    });
    expect(veto.getMaps().find((map) => map.mapname === "de_mirage")).toStrictEqual({
        mapname: "de_mirage"
    });
});

test("bo5", () => {
    const veto = new CS2Veto("bo5", MAP_POOL);
    expect(veto.getCurrentTeam()).toBe(0);
    expect(veto.choose("de_nuke")).toBe(true);
    expect(veto.getCurrentTeam()).toBe(1);
    expect(veto.choose("de_train")).toBe(true);
    expect(veto.getCurrentTeam()).toBe(0);
    expect(veto.choose("de_ancient")).toBe(true);
    expect(veto.getCurrentTeam()).toBe(1);
    expect(veto.choose("de_anubis")).toBe(true);
    expect(veto.getCurrentTeam()).toBe(0);
    expect(veto.choose("de_inferno")).toBe(true);
    expect(veto.getCurrentTeam()).toBe(1);
    expect(veto.choose("de_dust2")).toBe(true);
    expect(veto.choose("de_mirage")).toBe(false);
    expect(veto.getMatchMapnames()).toStrictEqual(["de_ancient", "de_anubis", "de_inferno", "de_dust2", "de_mirage"]);
});

test("custom", () => {
    const veto = new CS2Veto("custom", MAP_POOL, [
        CS2VetoAction.Pick,
        CS2VetoAction.Pick,
        CS2VetoAction.Ban,
        CS2VetoAction.Ban,
        CS2VetoAction.Ban,
        CS2VetoAction.Ban
    ]);
    expect(veto.getCurrentTeam()).toBe(0);
    expect(veto.choose("de_nuke")).toBe(true);
    expect(veto.getCurrentTeam()).toBe(1);
    expect(veto.choose("de_train")).toBe(true);
    expect(veto.getCurrentTeam()).toBe(0);
    expect(veto.choose("de_ancient")).toBe(true);
    expect(veto.getCurrentTeam()).toBe(1);
    expect(veto.choose("de_anubis")).toBe(true);
    expect(veto.getCurrentTeam()).toBe(0);
    expect(veto.choose("de_inferno")).toBe(true);
    expect(veto.getCurrentTeam()).toBe(1);
    expect(veto.choose("de_dust2")).toBe(true);
    expect(veto.choose("de_mirage")).toBe(false);
    expect(veto.getMatchMapnames()).toStrictEqual(["de_nuke", "de_train", "de_mirage"]);
});

test("random", () => {
    const veto = new CS2Veto("bo1", MAP_POOL);
    expect(veto.getCurrentTeam()).toBe(0);
    expect(veto.random()).toBe(true);
    expect(veto.getCurrentTeam()).toBe(1);
    expect(veto.random()).toBe(true);
    expect(veto.getCurrentTeam()).toBe(0);
    expect(veto.random()).toBe(true);
    expect(veto.getCurrentTeam()).toBe(1);
    expect(veto.random()).toBe(true);
    expect(veto.getCurrentTeam()).toBe(0);
    expect(veto.random()).toBe(true);
    expect(veto.getCurrentTeam()).toBe(1);
    expect(veto.random()).toBe(true);
    expect(veto.random()).toBe(false);
    expect(veto.isDone()).toBe(true);
    expect(veto.getMatchMapnames().length).toBe(1);
    expect(veto.getHistory().length).toBe(7);
    expect(veto.getHistory().map((event) => event.team)).toStrictEqual([0, 1, 0, 1, 0, 1, undefined]);
});
