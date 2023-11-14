/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CS_ACTIVE_MAP_POOL } from "./maps";
import { CS_VETO_BAN, CS_VETO_PICK, CS_Veto } from "./veto";

test("bo1", () => {
    const veto = new CS_Veto("bo1", CS_ACTIVE_MAP_POOL);
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
    expect(veto.choose("de_overpass")).toBe(true);
    expect(veto.choose("de_mirage")).toBe(false);
    expect(veto.getMaps()).toStrictEqual(["de_mirage"]);
});

test("bo3", () => {
    const veto = new CS_Veto("bo3", CS_ACTIVE_MAP_POOL);
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
    expect(veto.choose("de_overpass")).toBe(true);
    expect(veto.choose("de_mirage")).toBe(false);
    expect(veto.getMaps()).toStrictEqual(["de_ancient", "de_anubis", "de_mirage"]);
});

test("bo5", () => {
    const veto = new CS_Veto("bo5", CS_ACTIVE_MAP_POOL);
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
    expect(veto.choose("de_overpass")).toBe(true);
    expect(veto.choose("de_mirage")).toBe(false);
    expect(veto.getMaps()).toStrictEqual(["de_ancient", "de_anubis", "de_inferno", "de_overpass", "de_mirage"]);
});

test("custom", () => {
    const veto = new CS_Veto("custom", CS_ACTIVE_MAP_POOL, [
        CS_VETO_PICK,
        CS_VETO_PICK,
        CS_VETO_BAN,
        CS_VETO_BAN,
        CS_VETO_BAN,
        CS_VETO_BAN
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
    expect(veto.choose("de_overpass")).toBe(true);
    expect(veto.choose("de_mirage")).toBe(false);
    expect(veto.getMaps()).toStrictEqual(["de_nuke", "de_vertigo", "de_mirage"]);
});

test("random", () => {
    const veto = new CS_Veto("bo1", CS_ACTIVE_MAP_POOL);
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
