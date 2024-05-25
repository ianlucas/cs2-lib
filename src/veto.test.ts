/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ACTIVE_MAP_POOL } from "./maps";
import { Cs2Veto, Cs2VetoAction } from "./veto";

test("bo1", () => {
    const veto = new Cs2Veto("bo1", ACTIVE_MAP_POOL);
    expect(veto.getCurrentTeam()).toBe(0);
    expect(veto.choose("de_nuke")).toBe(true);
    expect(veto.getCurrentTeam()).toBe(1);
    expect(veto.choose("de_vertigo")).toBe(true);
    expect(veto.getCurrentTeam()).toBe(0);
    expect(veto.choose("de_ancient")).toBe(true);
    expect(veto.getCurrentTeam()).toBe(1);
    expect(veto.choose("de_anubis")).toBe(true);
    expect(veto.getCurrentTeam()).toBe(0);
    expect(veto.choose("de_inferno")).toBe(true);
    expect(veto.getCurrentTeam()).toBe(1);
    expect(veto.choose("de_dust2")).toBe(true);
    expect(veto.choose("de_mirage")).toBe(false);
    expect(veto.getMaps()).toStrictEqual(["de_mirage"]);
});

test("bo3", () => {
    const veto = new Cs2Veto("bo3", ACTIVE_MAP_POOL);
    expect(veto.getCurrentTeam()).toBe(0);
    expect(veto.choose("de_nuke")).toBe(true);
    expect(veto.getCurrentTeam()).toBe(1);
    expect(veto.choose("de_vertigo")).toBe(true);
    expect(veto.getCurrentTeam()).toBe(0);
    expect(veto.choose("de_ancient")).toBe(true);
    expect(veto.getCurrentTeam()).toBe(1);
    expect(veto.choose("de_anubis")).toBe(true);
    expect(veto.getCurrentTeam()).toBe(0);
    expect(veto.choose("de_inferno")).toBe(true);
    expect(veto.getCurrentTeam()).toBe(1);
    expect(veto.choose("de_dust2")).toBe(true);
    expect(veto.choose("de_mirage")).toBe(false);
    expect(veto.getMaps()).toStrictEqual(["de_ancient", "de_anubis", "de_mirage"]);
});

test("bo5", () => {
    const veto = new Cs2Veto("bo5", ACTIVE_MAP_POOL);
    expect(veto.getCurrentTeam()).toBe(0);
    expect(veto.choose("de_nuke")).toBe(true);
    expect(veto.getCurrentTeam()).toBe(1);
    expect(veto.choose("de_vertigo")).toBe(true);
    expect(veto.getCurrentTeam()).toBe(0);
    expect(veto.choose("de_ancient")).toBe(true);
    expect(veto.getCurrentTeam()).toBe(1);
    expect(veto.choose("de_anubis")).toBe(true);
    expect(veto.getCurrentTeam()).toBe(0);
    expect(veto.choose("de_inferno")).toBe(true);
    expect(veto.getCurrentTeam()).toBe(1);
    expect(veto.choose("de_dust2")).toBe(true);
    expect(veto.choose("de_mirage")).toBe(false);
    expect(veto.getMaps()).toStrictEqual(["de_ancient", "de_anubis", "de_inferno", "de_dust2", "de_mirage"]);
});

test("custom", () => {
    const veto = new Cs2Veto("custom", ACTIVE_MAP_POOL, [
        Cs2VetoAction.Pick,
        Cs2VetoAction.Pick,
        Cs2VetoAction.Ban,
        Cs2VetoAction.Ban,
        Cs2VetoAction.Ban,
        Cs2VetoAction.Ban
    ]);
    expect(veto.getCurrentTeam()).toBe(0);
    expect(veto.choose("de_nuke")).toBe(true);
    expect(veto.getCurrentTeam()).toBe(1);
    expect(veto.choose("de_vertigo")).toBe(true);
    expect(veto.getCurrentTeam()).toBe(0);
    expect(veto.choose("de_ancient")).toBe(true);
    expect(veto.getCurrentTeam()).toBe(1);
    expect(veto.choose("de_anubis")).toBe(true);
    expect(veto.getCurrentTeam()).toBe(0);
    expect(veto.choose("de_inferno")).toBe(true);
    expect(veto.getCurrentTeam()).toBe(1);
    expect(veto.choose("de_dust2")).toBe(true);
    expect(veto.choose("de_mirage")).toBe(false);
    expect(veto.getMaps()).toStrictEqual(["de_nuke", "de_vertigo", "de_mirage"]);
});

test("random", () => {
    const veto = new Cs2Veto("bo1", ACTIVE_MAP_POOL);
    expect(veto.getCurrentTeam()).toBe(0);
    expect(veto.choose()).toBe(true);
    expect(veto.getCurrentTeam()).toBe(1);
    expect(veto.choose()).toBe(true);
    expect(veto.getCurrentTeam()).toBe(0);
    expect(veto.choose()).toBe(true);
    expect(veto.getCurrentTeam()).toBe(1);
    expect(veto.choose()).toBe(true);
    expect(veto.getCurrentTeam()).toBe(0);
    expect(veto.choose()).toBe(true);
    expect(veto.getCurrentTeam()).toBe(1);
    expect(veto.choose()).toBe(true);
    expect(veto.choose()).toBe(false);
    expect(veto.getMaps().length).toBe(1);
});
