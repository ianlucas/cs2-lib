/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CS_Map } from "./maps.js";

export const CS_VETO_AVAILABLE = 0;
export const CS_VETO_PICK = 1;
export const CS_VETO_BAN = 2;

export type CS_VetoValue = 0 | 1 | 2;
export type CS_VetoType = "bo1" | "bo3" | "bo5" | "custom";

export interface CS_VetoMap {
    mapname: string;
    value: CS_VetoValue;
    team?: number;
}

/**
 * Represents a veto process for Counter-Strike maps.
 * @class
 */
export class CS_Veto {
    private maps: CS_VetoMap[];
    private actions: CS_VetoValue[];
    private pickedMaps: string[] = [];

    /**
     * Create a CS_Veto instance.
     *
     * @param {CS_VetoType} type - The type of veto process ("bo1", "bo3", "bo5", or "custom").
     * @param {CS_Map[]} maps - An array of maps to veto (must provide 7 maps).
     * @param {CS_VetoValue[]} [actions] - An array of veto actions (optional, but required for "custom" type).
     * @throws {Error} Throws an error if the input is invalid.
     */
    constructor(type: CS_VetoType, maps: CS_Map[], actions?: CS_VetoValue[]) {
        if (type !== "custom" && actions !== undefined) {
            console.warn('stack provided, but the type is not "custom".');
        }
        if (type === "custom" && actions === undefined) {
            throw new Error("provide the stack for the custom type.");
        }
        if (maps.length !== 7) {
            throw new Error("you need to provide 7 maps to veto.");
        }
        if (actions !== undefined && actions.length !== 6) {
            throw new Error("you need to provide 6 actions to veto.");
        }
        this.maps = maps.map((map) => ({
            mapname: map.mapname,
            value: CS_VETO_AVAILABLE
        }));
        switch (type) {
            case "bo1":
                this.actions = [
                    CS_VETO_BAN,
                    CS_VETO_BAN,
                    CS_VETO_BAN,
                    CS_VETO_BAN,
                    CS_VETO_BAN,
                    CS_VETO_BAN
                ];
                break;
            case "bo3":
                this.actions = [
                    CS_VETO_BAN,
                    CS_VETO_BAN,
                    CS_VETO_PICK,
                    CS_VETO_PICK,
                    CS_VETO_BAN,
                    CS_VETO_BAN
                ];
                break;
            case "bo5":
                this.actions = [
                    CS_VETO_BAN,
                    CS_VETO_BAN,
                    CS_VETO_PICK,
                    CS_VETO_PICK,
                    CS_VETO_PICK,
                    CS_VETO_PICK
                ];
                break;
            case "custom":
                this.actions = actions!;
                break;
        }
    }

    private getAvailableMaps() {
        return this.maps.filter((map) => map.value === CS_VETO_AVAILABLE);
    }

    private getMap(mapname: string) {
        return this.maps.find((map) => map.mapname === mapname);
    }

    private getAvailableMapnames() {
        return this.getAvailableMaps().map((map) => map.mapname);
    }

    /**
     * Get the current team making a veto action.
     *
     * @returns {number} The current team (0 or 1).
     */
    getCurrentTeam() {
        return this.actions.length % 2;
    }

    /**
     * Choose a map for veto.
     *
     * @param {string} [mapname] - The name of the map to choose (optional for random selection).
     * @returns {boolean} Returns true if the map was successfully chosen, false otherwise.
     */
    choose(mapname?: string): boolean {
        if (this.actions.length === 0) {
            return false;
        }
        if (mapname === undefined) {
            return this.random();
        }
        const map = this.getMap(mapname);
        if (map === undefined || map.value !== CS_VETO_AVAILABLE) {
            return false;
        }
        const team = this.getCurrentTeam();
        const value = this.actions.shift();
        if (value === undefined) {
            return false;
        }
        if (value === CS_VETO_PICK) {
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

    /**
     * Choose a random available map for veto.
     *
     * @returns {boolean} Returns true if a map was successfully chosen, false if no maps are available.
     * @throws {Error} Throws an error if a random map cannot be chosen.
     */
    random(): boolean {
        const available = this.getAvailableMapnames();
        if (!available.length) {
            return false;
        }
        const index = Math.floor(Math.random() * available.length);
        const mapname = available[index];
        if (mapname === undefined) {
            throw new Error("unable to get random mapname.");
        }
        return this.choose(mapname);
    }

    /**
     * Get the current state of map vetoes.
     *
     * @returns {CS_VetoMap[]} An array of CS_VetoMap objects representing the current state of maps.
     */
    getState(): CS_VetoMap[] {
        return this.maps;
    }

    /**
     * Get the list of maps in the order they were picked.
     *
     * @returns {string[]} An array of map names in the order they were picked.
     */
    getMaps(): string[] {
        if (this.actions.length > 0) {
            return this.pickedMaps;
        }
        const available = this.getAvailableMapnames();
        return [...this.pickedMaps, ...available];
    }

    /**
     * Check if the veto process is done (no more actions remaining).
     *
     * @returns {boolean} Returns true if the veto process is done, false otherwise.
     */
    done(): boolean {
        return this.actions.length === 0;
    }
}
