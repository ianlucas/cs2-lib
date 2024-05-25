/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Cs2Map } from "./maps.js";
import { assert, fail } from "./utils.js";

export const VETO_AVAILABLE = 0;
export const VETO_PICK = 1;
export const VETO_BAN = 2;

export type VetoValue = 0 | 1 | 2;
export type VetoType = "bo1" | "bo3" | "bo5" | "custom";

export interface VetoMap {
    mapname: string;
    value: VetoValue;
    team?: number;
}

export class Veto {
    private maps: VetoMap[];
    private actions: VetoValue[];
    private pickedMaps: string[] = [];

    constructor(type: VetoType, maps: Cs2Map[], actions?: VetoValue[]) {
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
            value: VETO_AVAILABLE
        }));
        switch (type) {
            case "bo1":
                this.actions = [VETO_BAN, VETO_BAN, VETO_BAN, VETO_BAN, VETO_BAN, VETO_BAN];
                break;
            case "bo3":
                this.actions = [VETO_BAN, VETO_BAN, VETO_PICK, VETO_PICK, VETO_BAN, VETO_BAN];
                break;
            case "bo5":
                this.actions = [VETO_BAN, VETO_BAN, VETO_PICK, VETO_PICK, VETO_PICK, VETO_PICK];
                break;
            case "custom":
                this.actions = actions!;
                break;
        }
    }

    private getAvailableMaps() {
        return this.maps.filter((map) => map.value === VETO_AVAILABLE);
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
        if (map === undefined || map.value !== VETO_AVAILABLE) {
            return false;
        }
        const team = this.getCurrentTeam();
        const value = this.actions.shift();
        if (value === undefined) {
            return false;
        }
        if (value === VETO_PICK) {
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

    getState(): VetoMap[] {
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
