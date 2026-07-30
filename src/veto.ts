/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomBoolean } from "./economy-container.ts";
import { type CS2Map } from "./maps.ts";
import { type EnumValues, assert, ensure } from "./utils.ts";

export const CS2VetoAction = {
    Pick: 1,
    Ban: 2
} as const;

export type CS2VetoAction = EnumValues<typeof CS2VetoAction>;

export const CS2VetoType = {
    BO1: "bo1",
    BO2: "bo2",
    BO3: "bo3",
    BO5: "bo5",
    Custom: "custom"
} as const;

export type CS2VetoType = EnumValues<typeof CS2VetoType>;

export type CS2VetoTeam = 0 | 1;

export interface CS2VetoMap {
    action?: CS2VetoAction;
    mapname: string;
    team?: CS2VetoTeam;
}

export interface CS2VetoEvent {
    action?: CS2VetoAction;
    mapname: string;
    team?: CS2VetoTeam;
}

export class CS2Veto {
    private actions: CS2VetoAction[];
    private history: CS2VetoEvent[] = [];
    private maps: CS2VetoMap[];
    private startingTeam: CS2VetoTeam;

    constructor(type: CS2VetoType, maps: CS2Map[], actions?: CS2VetoAction[], startingTeam?: CS2VetoTeam) {
        assert(type !== "custom" || actions !== undefined);
        assert(maps.length === 7);
        assert(actions === undefined || actions.length === 6);
        this.maps = maps.map((map) => ({
            mapname: map.mapname
        }));
        this.startingTeam = startingTeam ?? (type === CS2VetoType.BO2 && randomBoolean() ? 1 : 0);
        switch (type) {
            case CS2VetoType.BO1:
                this.actions = [
                    CS2VetoAction.Ban,
                    CS2VetoAction.Ban,
                    CS2VetoAction.Ban,
                    CS2VetoAction.Ban,
                    CS2VetoAction.Ban,
                    CS2VetoAction.Ban
                ];
                break;
            case CS2VetoType.BO2:
                this.actions = [
                    CS2VetoAction.Ban,
                    CS2VetoAction.Ban,
                    CS2VetoAction.Ban,
                    CS2VetoAction.Ban,
                    CS2VetoAction.Ban
                ];
                break;
            case CS2VetoType.BO3:
                this.actions = [
                    CS2VetoAction.Ban,
                    CS2VetoAction.Ban,
                    CS2VetoAction.Pick,
                    CS2VetoAction.Pick,
                    CS2VetoAction.Ban,
                    CS2VetoAction.Ban
                ];
                break;
            case CS2VetoType.BO5:
                this.actions = [
                    CS2VetoAction.Ban,
                    CS2VetoAction.Ban,
                    CS2VetoAction.Pick,
                    CS2VetoAction.Pick,
                    CS2VetoAction.Pick,
                    CS2VetoAction.Pick
                ];
                break;
            case CS2VetoType.Custom:
                this.actions = ensure(actions);
                break;
        }
    }

    isDone(): boolean {
        return this.actions.length === 0;
    }

    private getAvailableMaps(): CS2VetoMap[] {
        return this.maps.filter((map) => map.action === undefined);
    }

    private getAvailableMapnames(): string[] {
        return this.getAvailableMaps().map((map) => map.mapname);
    }

    private getMap(mapname: string): CS2VetoMap | undefined {
        return this.maps.find((map) => map.mapname === mapname);
    }

    getCurrentAction(): CS2VetoAction | undefined {
        return this.actions[0];
    }

    getCurrentTeam(): CS2VetoTeam {
        const chosen = this.history.filter((event) => event.team !== undefined).length;
        return ((this.startingTeam + chosen) % 2) as CS2VetoTeam;
    }

    getHistory(): readonly CS2VetoEvent[] {
        return this.history;
    }

    getMaps(): CS2VetoMap[] {
        return this.maps;
    }

    getMatchMapnames(): string[] {
        return this.history.filter((event) => event.action !== CS2VetoAction.Ban).map((event) => event.mapname);
    }

    getRandomAvailableMapname(): string | undefined {
        const available = this.getAvailableMapnames();
        if (!available.length) {
            return undefined;
        }
        const index = Math.floor(Math.random() * available.length);
        return available[index];
    }

    choose(mapname: string): boolean {
        const action = this.getCurrentAction();
        if (action === undefined) {
            return false;
        }
        const map = this.getMap(mapname);
        if (map === undefined || map.action !== undefined) {
            return false;
        }
        const team = this.getCurrentTeam();
        this.actions.shift();
        map.action = action;
        map.team = team;
        this.history.push({ action, mapname, team });
        if (this.isDone()) {
            for (const leftover of this.getAvailableMapnames()) {
                this.history.push({ mapname: leftover });
            }
        }
        return true;
    }

    random(): boolean {
        const mapname = this.getRandomAvailableMapname();
        if (mapname === undefined) {
            return false;
        }
        return this.choose(mapname);
    }
}
