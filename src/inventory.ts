import { CS_Economy } from "./economy.js";
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

    constructor(items: CS_InventoryItem[] = [], limit = 256) {
        this.items = items;
        this.limit = limit;
    }

    canAddNewItem() {
        return this.items.length < this.limit;
    }

    add(item: CS_InventoryItem) {
        if (this.canAddNewItem()) {
            const csItem = CS_Economy.getById(item.id);
            if (item.float !== undefined) {
                CS_Economy.validateFloat(csItem, item.float);
            }
            if (item.seed !== undefined) {
                CS_Economy.validateSeed(csItem, item.seed);
            }
            if (item.stickers !== undefined) {
                CS_Economy.validateStickers(
                    csItem,
                    item.stickers,
                    item.stickersfloat
                );
            }
            if (item.nametag !== undefined) {
                CS_Economy.validateNametag(csItem, item.nametag);
            }
            if (item.stattrak !== undefined) {
                CS_Economy.validateStattrak(csItem, item.stattrak);
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
        return this;
    }

    remove(at: number) {
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

    equip(at: number, team?: CS_Team) {
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

    unequip(at: number, team?: CS_Team) {
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

    getAll() {
        return this.items.map((inventoryItem, index) => ({
            index,
            inventoryItem,
            csItem: CS_Economy.getById(inventoryItem.id)
        }));
    }

    getItems() {
        return this.items;
    }
}
