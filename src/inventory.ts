/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CS_roll } from "./economy-case.js";
import {
    CS_Economy,
    CS_validateWear,
    CS_validateNametag,
    CS_validateSeed,
    CS_validateStatTrak,
    CS_validateStickers
} from "./economy.js";
import { CS_TEAM_CT, CS_TEAM_T, CS_Team } from "./teams.js";

export const CS_INVENTORY_EQUIPPABLE_ITEMS = [
    "agent",
    "glove",
    "graffiti",
    "melee",
    "musickit",
    "patch",
    "pin",
    "weapon"
];

export interface CS_InventoryItem {
    equipped?: boolean;
    equippedCT?: boolean;
    equippedT?: boolean;
    id: number;
    nametag?: string;
    seed?: number;
    stattrak?: number;
    stickers?: (number | null)[];
    stickerswear?: (number | null)[];
    wear?: number;
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
        if (item.wear !== undefined) {
            CS_validateWear(item.wear, csItem);
        }
        if (item.seed !== undefined) {
            CS_validateSeed(item.seed, csItem);
        }
        if (item.stickers !== undefined) {
            CS_validateStickers(csItem, item.stickers, item.stickerswear);
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
                        equippedCT: csTeam === CS_TEAM_CT ? true : current.equippedCT,
                        equippedT: csTeam === CS_TEAM_T ? true : current.equippedT
                    };
                }
                const currentCsItem = CS_Economy.getById(current.id);
                if (
                    currentCsItem.type === csItem.type &&
                    (csItem.type !== "weapon" || currentCsItem.model === csItem.model)
                ) {
                    return {
                        ...current,
                        equipped: csTeam === undefined ? undefined : current.equipped,
                        equippedCT: csTeam === CS_TEAM_CT ? undefined : current.equippedCT,
                        equippedT: csTeam === CS_TEAM_T ? undefined : current.equippedT
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
                        equipped: csTeam === undefined ? undefined : item.equipped,
                        equippedCT: csTeam === CS_TEAM_CT ? undefined : item.equippedCT,
                        equippedT: csTeam === CS_TEAM_T ? undefined : item.equippedT
                    };
                }
                return item;
            }),
            this.limit
        );
    }

    unlockCase(
        caseIndex: number,
        keyIndex?: number,
        rolledItem?: ReturnType<typeof CS_roll>
    ): {
        state: CS_Inventory;
        rolledItem: ReturnType<typeof CS_roll>;
    } {
        if (!this.items[caseIndex] || (keyIndex !== undefined && !this.items[keyIndex])) {
            throw new Error("invalid inventory item(s).");
        }
        const caseItem = CS_Economy.getById(this.items[caseIndex].id);
        if (caseItem.type !== "case") {
            throw new Error("item is not a case.");
        }
        const keyItem = keyIndex !== undefined ? CS_Economy.getById(this.items[keyIndex].id) : undefined;
        if (keyItem !== undefined && keyItem.type !== "key") {
            throw new Error("item is not a key.");
        }
        if (caseItem.keys !== undefined && (keyItem === undefined || !caseItem.keys.includes(keyItem.id))) {
            throw new Error("case needs a valid key to be open.");
        }
        if (caseItem.keys === undefined && keyItem !== undefined) {
            throw new Error("case does not need a key.");
        }
        rolledItem = rolledItem !== undefined ? rolledItem : CS_roll(caseItem);
        return {
            state: new CS_Inventory(
                [
                    {
                        id: rolledItem.csItem.id,
                        ...rolledItem.attributes
                    },
                    ...this.items.filter((_, index) => index !== caseIndex && index !== keyIndex)
                ],
                this.limit
            ),
            rolledItem
        };
    }

    getItem(index: number): CS_InventoryItem | undefined {
        return this.items[index];
    }

    getItems(): CS_InventoryItem[] {
        return this.items;
    }

    size() {
        return this.items.length;
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

    add(item: CS_InventoryItem) {
        if (this.full()) {
            return this;
        }
        const csItem = CS_Economy.getById(item.id);
        if (item.wear !== undefined) {
            CS_validateWear(item.wear, csItem);
        }
        if (item.seed !== undefined) {
            CS_validateSeed(item.seed, csItem);
        }
        if (item.stickers !== undefined) {
            CS_validateStickers(csItem, item.stickers, item.stickerswear);
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
        return this;
    }

    safeAdd(item: CS_InventoryItem) {
        try {
            return this.add(item);
        } catch {
            return this;
        }
    }

    remove(at: number) {
        if (!this.items[at]) {
            return this;
        }
        this.items.splice(at, 1);
        return this;
    }

    equip(at: number, csTeam?: CS_Team) {
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
        for (let index = 0; index < this.items.length; index++) {
            const current = this.items[index];
            if (at === index) {
                current.equipped = csTeam === undefined ? true : undefined;
                current.equippedCT = csTeam === CS_TEAM_CT ? true : current.equippedCT;
                current.equippedT = csTeam === CS_TEAM_T ? true : current.equippedT;
            } else {
                const currentCsItem = CS_Economy.getById(current.id);
                if (
                    currentCsItem.type === csItem.type &&
                    (csItem.type !== "weapon" || currentCsItem.model === csItem.model)
                ) {
                    current.equipped = csTeam === undefined ? undefined : current.equipped;
                    current.equippedCT = csTeam === CS_TEAM_CT ? undefined : current.equippedCT;
                    current.equippedT = csTeam === CS_TEAM_T ? undefined : current.equippedT;
                }
            }
        }
        return this;
    }

    unequip(at: number, csTeam?: CS_Team) {
        if (!this.items[at]) {
            return this;
        }
        const item = this.items[at];
        item.equipped = csTeam === undefined ? undefined : item.equipped;
        item.equippedCT = csTeam === CS_TEAM_CT ? undefined : item.equippedCT;
        item.equippedT = csTeam === CS_TEAM_T ? undefined : item.equippedT;
        return this;
    }

    unlockCase(
        caseIndex: number,
        keyIndex?: number,
        rolledItem?: ReturnType<typeof CS_roll>
    ): {
        state: CS_MutableInventory;
        rolledItem: ReturnType<typeof CS_roll>;
    } {
        if (!this.items[caseIndex] || (keyIndex !== undefined && !this.items[keyIndex])) {
            throw new Error("invalid inventory item(s).");
        }
        const caseItem = CS_Economy.getById(this.items[caseIndex].id);
        if (caseItem.type !== "case") {
            throw new Error("item is not a case.");
        }
        const keyItem = keyIndex !== undefined ? CS_Economy.getById(this.items[keyIndex].id) : undefined;
        if (keyItem !== undefined && keyItem.type !== "key") {
            throw new Error("item is not a key.");
        }
        if (caseItem.keys !== undefined && (keyItem === undefined || !caseItem.keys.includes(keyItem.id))) {
            throw new Error("case needs a valid key to be open.");
        }
        if (caseItem.keys === undefined && keyItem !== undefined) {
            throw new Error("case does not need a key.");
        }
        rolledItem = rolledItem !== undefined ? rolledItem : CS_roll(caseItem);
        keyIndex = keyIndex !== undefined ? (keyIndex > caseIndex ? keyIndex - 1 : keyIndex) : undefined;
        this.items.splice(caseIndex, 1);
        if (keyIndex !== undefined) {
            this.items.splice(keyIndex, 1);
        }
        this.items.unshift({
            id: rolledItem.csItem.id,
            ...rolledItem.attributes
        });
        return {
            state: this,
            rolledItem
        };
    }

    getItem(index: number): CS_InventoryItem | undefined {
        return this.items[index];
    }

    getItems(): CS_InventoryItem[] {
        return this.items;
    }

    size() {
        return this.items.length;
    }
}
