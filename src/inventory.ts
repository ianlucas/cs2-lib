/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    CS_Economy,
    CS_validateFloat,
    CS_validateNametag,
    CS_validateSeed,
    CS_validateStatTrak,
    CS_validateStickers
} from "./economy.js";
import { CS_TEAM_CT, CS_TEAM_T, CS_Team } from "./teams.js";

export const CS_INVENTORY_EQUIPPABLE_ITEMS = [
    "weapon",
    "glove",
    "melee",
    "musickit",
    "agent",
    "patch",
    "pin"
];

export interface CS_InventoryItem {
    equipped?: boolean;
    equippedCT?: boolean;
    equippedT?: boolean;
    float?: number;
    id: number;
    nametag?: string;
    seed?: number;
    stattrak?: boolean;
    stickers?: (number | null)[];
    stickersfloat?: (number | null)[];
}

export class CS_Inventory {
    private items: CS_InventoryItem[];
    private limit: number;

    constructor(items: CS_InventoryItem[] = [], limit: number = 256) {
        this.items = items;
        this.limit = limit;
    }

    full(): boolean {
        return this.items.length === this.limit;
    }

    add(item: CS_InventoryItem): CS_Inventory {
        if (this.full()) {
            return this;
        }
        const csItem = CS_Economy.getById(item.id);
        if (item.float !== undefined) {
            CS_validateFloat(item.float, csItem);
        }
        if (item.seed !== undefined) {
            CS_validateSeed(item.seed, csItem);
        }
        if (item.stickers !== undefined) {
            CS_validateStickers(csItem, item.stickers, item.stickersfloat);
        }
        if (item.nametag !== undefined) {
            CS_validateNametag(item.nametag, csItem);
        }
        if (item.stattrak !== undefined) {
            CS_validateStatTrak(item.stattrak, csItem);
        }
        return new CS_Inventory(
            [
                {
                    ...item,
                    equipped: undefined,
                    equippedCT: undefined,
                    equippedT: undefined
                },
                ...this.items
            ],
            this.limit
        );
    }

    safeAdd(item: CS_InventoryItem): CS_Inventory {
        try {
            return this.add(item);
        } catch {
            return this;
        }
    }

    remove(at: number): CS_Inventory {
        if (!this.items[at]) {
            return this;
        }
        return new CS_Inventory(
            this.items.filter((_, index) => {
                return at !== index;
            }),
            this.limit
        );
    }

    equip(at: number, csTeam?: CS_Team): CS_Inventory {
        const item = this.items[at];
        if (!item) {
            return this;
        }
        if (item.equipped) {
            return this;
        }
        if (csTeam === CS_TEAM_CT && item.equippedCT) {
            return this;
        }
        if (csTeam === CS_TEAM_T && item.equippedT) {
            return this;
        }
        const csItem = CS_Economy.getById(item.id);
        if (!CS_INVENTORY_EQUIPPABLE_ITEMS.includes(csItem.type)) {
            return this;
        }
        if (csTeam === undefined && csItem.teams !== undefined) {
            return this;
        }
        if (csTeam !== undefined && !csItem.teams?.includes(csTeam)) {
            return this;
        }
        return new CS_Inventory(
            this.items.map((current, index) => {
                if (index === at) {
                    return {
                        ...current,
                        equipped: csTeam === undefined ? true : undefined,
                        equippedCT:
                            csTeam === CS_TEAM_CT ? true : current.equippedCT,
                        equippedT:
                            csTeam === CS_TEAM_T ? true : current.equippedT
                    };
                }
                const currentCsItem = CS_Economy.getById(current.id);
                if (
                    currentCsItem.type === csItem.type &&
                    (csItem.type !== "weapon" ||
                        currentCsItem.model === csItem.model)
                ) {
                    return {
                        ...current,
                        equipped:
                            csTeam === undefined ? undefined : current.equipped,
                        equippedCT:
                            csTeam === CS_TEAM_CT
                                ? undefined
                                : current.equippedCT,
                        equippedT:
                            csTeam === CS_TEAM_T ? undefined : current.equippedT
                    };
                }
                return current;
            }),
            this.limit
        );
    }

    unequip(at: number, csTeam?: CS_Team): CS_Inventory {
        if (!this.items[at]) {
            return this;
        }
        return new CS_Inventory(
            this.items.map((item, index) => {
                if (at === index) {
                    return {
                        ...item,
                        equipped:
                            csTeam === undefined ? undefined : item.equipped,
                        equippedCT:
                            csTeam === CS_TEAM_CT ? undefined : item.equippedCT,
                        equippedT:
                            csTeam === CS_TEAM_T ? undefined : item.equippedT
                    };
                }
                return item;
            }),
            this.limit
        );
    }

    getItems(): CS_InventoryItem[] {
        return this.items;
    }
}

export class CS_MutableInventory {
    private items: CS_InventoryItem[];
    private limit: number;

    constructor(items: CS_InventoryItem[] = [], limit: number = 256) {
        this.items = items;
        this.limit = limit;
    }

    full(): boolean {
        return this.items.length === this.limit;
    }

    add(item: CS_InventoryItem): boolean {
        if (this.full()) {
            return false;
        }
        const csItem = CS_Economy.getById(item.id);
        if (item.float !== undefined) {
            CS_validateFloat(item.float, csItem);
        }
        if (item.seed !== undefined) {
            CS_validateSeed(item.seed, csItem);
        }
        if (item.stickers !== undefined) {
            CS_validateStickers(csItem, item.stickers, item.stickersfloat);
        }
        if (item.nametag !== undefined) {
            CS_validateNametag(item.nametag, csItem);
        }
        if (item.stattrak !== undefined) {
            CS_validateStatTrak(item.stattrak, csItem);
        }
        this.items.unshift({
            ...item,
            equipped: undefined,
            equippedCT: undefined,
            equippedT: undefined
        });
        return true;
    }

    safeAdd(item: CS_InventoryItem): boolean {
        try {
            return this.add(item);
        } catch {
            return false;
        }
    }

    remove(at: number): boolean {
        if (!this.items[at]) {
            return false;
        }
        this.items.splice(at, 1);
        return true;
    }

    equip(at: number, csTeam?: CS_Team): boolean {
        const item = this.items[at];
        if (!item) {
            return false;
        }
        if (item.equipped) {
            return false;
        }
        if (csTeam === CS_TEAM_CT && item.equippedCT) {
            return false;
        }
        if (csTeam === CS_TEAM_T && item.equippedT) {
            return false;
        }
        const csItem = CS_Economy.getById(item.id);
        if (!CS_INVENTORY_EQUIPPABLE_ITEMS.includes(csItem.type)) {
            return false;
        }
        if (csTeam === undefined && csItem.teams !== undefined) {
            return false;
        }
        if (csTeam !== undefined && !csItem.teams?.includes(csTeam)) {
            return false;
        }
        for (const [index, current] of this.items.entries()) {
            if (index === at) {
                current.equipped = csTeam === undefined ? true : undefined;
                current.equippedCT =
                    csTeam === CS_TEAM_CT ? true : current.equippedCT;
                current.equippedT =
                    csTeam === CS_TEAM_T ? true : current.equippedT;
            }
            const currentCsItem = CS_Economy.getById(current.id);
            if (
                currentCsItem.type === csItem.type &&
                (csItem.type !== "weapon" ||
                    currentCsItem.model === csItem.model)
            ) {
                current.equipped =
                    csTeam === undefined ? undefined : current.equipped;
                current.equippedCT =
                    csTeam === CS_TEAM_CT ? undefined : current.equippedCT;
                current.equippedT =
                    csTeam === CS_TEAM_T ? undefined : current.equippedT;
            }
        }
        return true;
    }

    unequip(at: number, csTeam?: CS_Team): boolean {
        if (!this.items[at]) {
            return false;
        }
        const item = this.items[at];
        item.equipped = csTeam === undefined ? undefined : item.equipped;
        item.equippedCT = csTeam === CS_TEAM_CT ? undefined : item.equippedCT;
        item.equippedT = csTeam === CS_TEAM_T ? undefined : item.equippedT;
        return true;
    }

    getItems(): CS_InventoryItem[] {
        return this.items;
    }
}
