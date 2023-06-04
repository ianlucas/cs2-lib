/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { CS_Economy, CS_Item } from "./economy.js";
import { CS_TEAM_NONE, CS_Team } from "./teams.js";

export interface CS_LoadoutItem {
    float?: number;
    id: number;
    locktime?: number;
    nametag?: string;
    seed?: number;
    stattrak?: boolean;
    stickers?: (number | null)[];
    stickerswear?: (number | null)[];
    team: CS_Team;
    unequipped?: boolean;
}

export interface CS_LoadoutQueryItems {
    csItem: CS_Item;
    loadoutItem?: CS_LoadoutItem;
}

export interface CS_LoadoutQuery {
    equippable: boolean;
    items: CS_LoadoutQueryItems[];
    locked?: boolean;
}

export const CS_EQUIPABLE_ITEMS = ["glove", "melee", "musickit", "weapon"];

export class CS_Loadout {
    static locktime: number = 0;
    items: CS_LoadoutItem[] = [];

    static setLockTime(seconds: number) {
        CS_Loadout.locktime = 1000 * seconds;
    }

    static isWithinLockTime(ms?: number) {
        return ms !== undefined && Date.now() - ms < CS_Loadout.locktime;
    }

    constructor(items: CS_LoadoutItem[] = []) {
        this.items = items;
    }

    private getTypeFromCategory(category: string) {
        const type = CS_Economy.items.find(
            (item) => item.category === category
        )?.type;
        if (type === undefined) {
            throw new Error("type not found");
        }
        return type;
    }

    get({ item, team }: { item: Partial<CS_Item>; team: CS_Team }) {
        return this.items.find((equipped) => {
            const other = CS_Economy.getById(equipped.id);
            return (
                other.type === item.type &&
                (item.type !== "weapon" || other.model === item.model) &&
                (equipped.team === team || other.teams === undefined)
            );
        });
    }

    equip({
        float,
        id,
        nametag,
        seed,
        stattrak,
        stickers,
        team
    }: CS_LoadoutItem) {
        const item = CS_Economy.getById(id);
        if (item.teams === undefined) {
            team = CS_TEAM_NONE;
        }
        if (!CS_EQUIPABLE_ITEMS.includes(item.type)) {
            throw new Error("you cannot equip this item");
        }
        const equipped = this.get({ item, team });
        if (
            equipped !== undefined &&
            CS_Loadout.isWithinLockTime(equipped.locktime)
        ) {
            if (!item.free && item.id !== equipped.id) {
                throw new Error("item is locked");
            }
            return new CS_Loadout(
                this.items.map((other) =>
                    other === equipped
                        ? { ...other, unequipped: item.free ? true : undefined }
                        : other
                )
            );
        }
        const items = this.items.filter(
            (other) =>
                other !== equipped &&
                (CS_Loadout.isWithinLockTime(other.locktime) ||
                    !other.unequipped)
        );
        if (item.free) {
            return new CS_Loadout(items);
        }
        if (float !== undefined) {
            CS_Economy.validateFloat(item, float);
        }
        if (seed !== undefined) {
            CS_Economy.validateSeed(item, seed);
        }
        if (stickers !== undefined) {
            CS_Economy.validateStickers(item, stickers);
        }
        if (nametag !== undefined) {
            CS_Economy.validateNametag(item, nametag);
        }
        if (stattrak !== undefined) {
            CS_Economy.validateStattrak(item, stattrak);
        }
        return new CS_Loadout(
            items.concat({
                float,
                id: item.id,
                locktime: CS_Loadout.locktime > 0 ? Date.now() : undefined,
                nametag,
                seed,
                stattrak,
                stickers,
                team
            })
        );
    }

    safeEquip(item: CS_LoadoutItem) {
        try {
            return this.equip(item);
        } catch {
            return this;
        }
    }

    getEquipped({
        category,
        team
    }: {
        category: string;
        team: CS_Team;
    }): CS_LoadoutQuery {
        const type = this.getTypeFromCategory(category);
        if (type !== "weapon") {
            const item = this.get({
                item: { type },
                team
            });
            if (item !== undefined && !item.unequipped) {
                return {
                    equippable: false,
                    items: [
                        {
                            csItem: CS_Economy.getById(item.id),
                            loadoutItem: item
                        }
                    ]
                };
            }
            return {
                equippable: false,
                items: [
                    {
                        csItem: CS_Economy.find({
                            category,
                            free: true,
                            team,
                            type
                        }),
                        loadoutItem: undefined
                    }
                ]
            };
        }
        return {
            equippable: false,
            items: CS_Economy.filter({
                type,
                category,
                free: true,
                team
            }).map((defaultItem) => {
                const item = this.get({
                    item: {
                        model: defaultItem.model,
                        type
                    },
                    team
                });
                if (item !== undefined && !item.unequipped) {
                    return {
                        csItem: CS_Economy.getById(item.id),
                        loadoutItem: item
                    };
                }
                return {
                    csItem: defaultItem,
                    loadoutItem: undefined
                };
            })
        };
    }

    getEquippable({
        category,
        model,
        team
    }: {
        category: string;
        model?: string;
        team: CS_Team;
    }): CS_LoadoutQuery {
        const type = this.getTypeFromCategory(category);
        const item = this.get({
            item: { type, model },
            team
        });
        const isGlove = type === "glove";
        const isMusicKit = type === "musickit";
        if (item && CS_Loadout.isWithinLockTime(item.locktime)) {
            return {
                equippable: true,
                items: [
                    {
                        csItem: CS_Economy.find({
                            category,
                            free: true,
                            model,
                            team,
                            type
                        })
                    },
                    {
                        csItem: CS_Economy.getById(item.id),
                        loadoutItem: item
                    }
                ],
                locked: true
            };
        }
        return {
            equippable: model !== undefined || isMusicKit,
            items: CS_Economy.filter({
                base:
                    model && !isGlove
                        ? undefined
                        : model && isGlove
                        ? false
                        : true,
                category,
                model,
                team,
                type
            }).map((item) => ({
                csItem: item
            })),
            locked: false
        };
    }
}
