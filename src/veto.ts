/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CS2Map } from "./maps.js";
import { EnumValues, assert, fail } from "./utils.js";

export const CS2VetoAction = {
    Available: 0,
    Pick: 1,
    Ban: 2
} as const;

export type CS2VetoActionValues = EnumValues<typeof CS2VetoAction>;

export type CS2VetoType = "bo1" | "bo3" | "bo5" | "custom";

export interface CS2VetoMap {
    mapname: string;
    value: CS2VetoActionValues;
    team?: number;
}

export class CS2Veto {
    private maps: CS2VetoMap[];
    private actions: CS2VetoActionValues[];
    private pickedMaps: string[] = [];

    constructor(type: CS2VetoType, maps: CS2Map[], actions?: CS2VetoActionValues[]) {
        if (type !== "custom" && actions !== undefined) {
            console.warn('stack provided, but the type is not "custom".');
        }
        if (type === "custom" && actions === undefined) {
            fail("provide the stack for the custom type.");
        }
        if (maps.length !== 7) {
            fail("you need to provide 7 maps to veto.");
        }
        if (actions !== undefined && actions.length !== 6) {
            fail("you need to provide 6 actions to veto.");
        }
        this.maps = maps.map((map) => ({
            mapname: map.mapname,
            value: CS2VetoAction.Available
        }));
        switch (type) {
            case "bo1":
                this.actions = [
                    CS2VetoAction.Ban,
                    CS2VetoAction.Ban,
                    CS2VetoAction.Ban,
                    CS2VetoAction.Ban,
                    CS2VetoAction.Ban,
                    CS2VetoAction.Ban
                ];
                break;
            case "bo3":
                this.actions = [
                    CS2VetoAction.Ban,
                    CS2VetoAction.Ban,
                    CS2VetoAction.Pick,
                    CS2VetoAction.Pick,
                    CS2VetoAction.Ban,
                    CS2VetoAction.Ban
                ];
                break;
            case "bo5":
                this.actions = [
                    CS2VetoAction.Ban,
                    CS2VetoAction.Ban,
                    CS2VetoAction.Pick,
                    CS2VetoAction.Pick,
                    CS2VetoAction.Pick,
                    CS2VetoAction.Pick
                ];
                break;
            case "custom":
                this.actions = actions!;
                break;
        }
    }

    private getAvailableMaps() {
        return this.maps.filter((map) => map.value === CS2VetoAction.Available);
    }

    private getMap(mapname: string) {
        return this.maps.find((map) => map.mapname === mapname);
    }

    private getAvailableMapnames() {
        return this.getAvailableMaps().map((map) => map.mapname);
    }

    getCurrentTeam() {
        return this.actions.length % 2;
    }

    choose(mapname?: string): boolean {
        if (this.actions.length === 0) {
            return false;
        }
        if (mapname === undefined) {
            return this.random();
        }
        const map = this.getMap(mapname);
        if (map === undefined || map.value !== CS2VetoAction.Available) {
            return false;
        }
        const team = this.getCurrentTeam();
        const value = this.actions.shift();
        if (value === undefined) {
            return false;
        }
        if (value === CS2VetoAction.Pick) {
            this.pickedMaps.push(mapname);
        }
        this.maps = this.maps.map((map) => {
            if (map.mapname !== mapname) {
                return map;
            }
            return {
                ...map,
                value,
                team
            };
        });
        return true;
    }

    random(): boolean {
        const available = this.getAvailableMapnames();
        if (!available.length) {
            return false;
        }
        const index = Math.floor(Math.random() * available.length);
        const mapname = available[index];
        assert(mapname, "Unable to get random mapname.");
        return this.choose(mapname);
    }

    getState(): CS2VetoMap[] {
        return this.maps;
    }

    getMaps(): string[] {
        if (this.actions.length > 0) {
            return this.pickedMaps;
        }
        const available = this.getAvailableMapnames();
        return [...this.pickedMaps, ...available];
    }

    done(): boolean {
        return this.actions.length === 0;
    }
}
