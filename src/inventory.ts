import {
    CS_Economy,
    CS_validateFloat,
    CS_validateNametag,
    CS_validateSeed,
    CS_validateStatTrak,
    CS_validateStickers
} from "./economy.js";
import { CS_TEAM_CT, CS_TEAM_T, CS_Team } from "./teams.js";

/**
 * Array of Counter-Strike inventory item types that can be equipped.
 */
export const CS_INVENTORY_EQUIPPABLE_ITEMS = [
    "weapon",
    "glove",
    "melee",
    "musickit",
    "agent",
    "patch",
    "pin"
];

/**
 * Represents a Counter-Strike inventory item.
 * @interface
 */
export interface CS_InventoryItem {
    /**
     * Indicates whether the item is equipped.
     */
    equipped?: boolean;
    /**
     * Indicates whether the item is equipped by the Counter-Terrorist team.
     */
    equippedCT?: boolean;
    /**
     * Indicates whether the item is equipped by the Counter-Terrorist team.
     */
    equippedT?: boolean;
    /**
     * The float value associated with the item.
     */
    float?: number;
    /**
     * The unique identifier of the item.
     */
    id: number;
    /**
     * The optional nametag associated with the item.
     */
    nametag?: string;
    /**
     * The seed value associated with the item.
     */

    seed?: number;
    /**
     * Indicates whether the item is a StatTrak item.
     */
    stattrak?: boolean;
    /**
     * An array of stickers applied to the item, with possible null values.
     */
    stickers?: (number | null)[];
    /**
     * An array of sticker float values associated with the item, with possible null values.
     */
    stickersfloat?: (number | null)[];
}

/**
 * Represents a Counter-Strike inventory.
 */
export class CS_Inventory {
    /**
     * An array containing Counter-Strike inventory items in the inventory.
     */
    private items: CS_InventoryItem[];
    /**
     * The maximum limit of items that the inventory can hold.
     */
    private limit: number;

    /**
     * Create a new Counter-Strike inventory.
     * @param {CS_InventoryItem[]} items - An array of Counter-Strike inventory items.
     * @param {number} limit - The maximum limit of items in the inventory (default is 256).
     */
    constructor(items: CS_InventoryItem[] = [], limit: number = 256) {
        this.items = items;
        this.limit = limit;
    }

    /**
     * Check if the inventory is full.
     * @returns {boolean} - `true` if the inventory is full, `false` otherwise.
     */
    full(): boolean {
        return this.items.length === this.limit;
    }

    /**
     * Add an item to the inventory.
     * @param {CS_InventoryItem} item - The item to add.
     * @returns {CS_Inventory} - A new inventory with the added item or the original inventory if it's full.
     */
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

    /**
     * Safely add an item to the inventory, catching and handling any exceptions.
     * @param {CS_InventoryItem} item - The item to add.
     * @returns {CS_Inventory} - A new inventory with the added item or the original inventory if an exception occurs.
     */
    safeAdd(item: CS_InventoryItem): CS_Inventory {
        try {
            return this.add(item);
        } catch {
            return this;
        }
    }

    /**
     * Remove an item from the inventory at a specified index.
     * @param {number} at - The index of the item to remove.
     * @returns {CS_Inventory} - A new inventory with the item removed or the original inventory if the index is out of bounds.
     */
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

    /**
     * Equip an item in the inventory at a specified index.
     * @param {number} at - The index of the item to equip.
     * @param {CS_Team} [team] - The team to which the item should be equipped (optional).
     * @returns {CS_Inventory} - A new inventory with the item equipped or the original inventory if the operation is not allowed.
     */
    equip(at: number, team?: CS_Team): CS_Inventory {
        const item = this.items[at];
        if (!item) {
            return this;
        }
        if (item.equipped) {
            return this;
        }
        if (team === CS_TEAM_CT && item.equippedCT) {
            return this;
        }
        if (team === CS_TEAM_T && item.equippedT) {
            return this;
        }
        const csItem = CS_Economy.getById(item.id);
        if (!CS_INVENTORY_EQUIPPABLE_ITEMS.includes(csItem.type)) {
            return this;
        }
        if (team === undefined && csItem.teams !== undefined) {
            return this;
        }
        if (team !== undefined && !csItem.teams?.includes(team)) {
            return this;
        }
        return new CS_Inventory(
            this.items.map((current, index) => {
                if (index === at) {
                    return {
                        ...current,
                        equipped: team === undefined ? true : undefined,
                        equippedCT:
                            team === CS_TEAM_CT ? true : current.equippedCT,
                        equippedT: team === CS_TEAM_T ? true : current.equippedT
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
                            team === undefined ? undefined : current.equipped,
                        equippedCT:
                            team === CS_TEAM_CT
                                ? undefined
                                : current.equippedCT,
                        equippedT:
                            team === CS_TEAM_T ? undefined : current.equippedT
                    };
                }
                return current;
            }),
            this.limit
        );
    }

    /**
     * Unequip an item in the inventory at a specified index.
     * @param {number} at - The index of the item to unequip.
     * @param {CS_Team} [team] - The team from which the item should be unequipped (optional).
     * @returns {CS_Inventory} - A new inventory with the item unequipped or the original inventory if the operation is not allowed.
     */
    unequip(at: number, team?: CS_Team): CS_Inventory {
        if (!this.items[at]) {
            return this;
        }
        return new CS_Inventory(
            this.items.map((item, index) => {
                if (at === index) {
                    return {
                        ...item,
                        equipped:
                            team === undefined ? undefined : item.equipped,
                        equippedCT:
                            team === CS_TEAM_CT ? undefined : item.equippedCT,
                        equippedT:
                            team === CS_TEAM_T ? undefined : item.equippedT
                    };
                }
                return item;
            }),
            this.limit
        );
    }

    /**
     * Get an array of all items in the inventory.
     * @returns {CS_InventoryItem[]} - An array of all items in the inventory.
     */
    getItems(): CS_InventoryItem[] {
        return this.items;
    }
}
