/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import {
    CS_Economy,
    CS_Item,
    CS_MAX_FLOAT,
    CS_MAX_SEED,
    CS_MIN_FLOAT,
    CS_MIN_SEED
} from "./economy.js";
import { CS_TEAM_NONE, CS_Team } from "./teams.js";

export interface CS_LoadoutItem {
    float?: number;
    id: number;
    locktime?: number;
    nametag?: string;
    seed?: number;
    stattrak?: boolean;
    stickers?: (number | null)[];
    team: CS_Team;
    unequipped?: boolean;
}

export const CS_EQUIPABLE_ITEMS = ["glove", "melee", "musickit", "weapon"];
export const CS_FLOATABLE_ITEMS = ["glove", "melee", "weapon"];
export const CS_NAMETAGGABLE_ITEMS = ["melee", "weapon"];
export const CS_SEEDABLE_ITEMS = ["glove", "melee"];
export const CS_STATTRAKABLE_ITEMS = ["melee", "weapon"];
export const CS_STICKERABLE_ITEMS = ["weapon"];

export const CS_nametagRE = /^[A-Za-z0-9|][A-Za-z0-9|\s]{0,19}$/;

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
            if (!CS_FLOATABLE_ITEMS.includes(item.type)) {
                throw new Error("invalid float");
            }
            if (float < CS_MIN_FLOAT || float > CS_MAX_FLOAT) {
                throw new Error("invalid float");
            }
        }
        if (seed !== undefined) {
            if (!CS_SEEDABLE_ITEMS.includes(item.type)) {
                throw new Error("invalid seed");
            }
            if (seed < CS_MIN_SEED || seed > CS_MAX_SEED) {
                throw new Error("invalid seed");
            }
        }
        if (stickers !== undefined) {
            if (!CS_STICKERABLE_ITEMS.includes(item.type)) {
                throw new Error("invalid stickers");
            }
            if (stickers.length > 4) {
                throw new Error("invalid stickers");
            }
            for (const sticker of stickers) {
                if (sticker === null) {
                    continue;
                }
                if (CS_Economy.getById(sticker).type !== "sticker") {
                    throw new Error("invalid stickers");
                }
            }
        }
        if (nametag !== undefined) {
            if (!CS_NAMETAGGABLE_ITEMS.includes(item.type)) {
                throw new Error("invalid nametag");
            }
            if (!CS_nametagRE.test(nametag)) {
                throw new Error("invalid nametag");
            }
        }
        if (stattrak === true) {
            if (!CS_STATTRAKABLE_ITEMS.includes(item.type)) {
                throw new Error("invalid stattrak");
            }
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

    getEquipped({ category, team }: { category: string; team: CS_Team }) {
        const type = this.getTypeFromCategory(category);
        if (type !== "weapon") {
            const item = this.get({
                item: { type },
                team
            });
            if (item !== undefined && !item.unequipped) {
                return [CS_Economy.getById(item.id)];
            }
            return [
                CS_Economy.find({
                    category,
                    free: true,
                    team,
                    type
                })
            ];
        }
        return CS_Economy.filter({ type, category, free: true, team }).map(
            (defaultItem) => {
                const item = this.get({
                    item: {
                        model: defaultItem.model,
                        type
                    },
                    team
                });
                if (item !== undefined && !item.unequipped) {
                    return CS_Economy.getById(item.id);
                }
                return defaultItem;
            }
        );
    }

    getEquippable({
        category,
        model,
        team
    }: {
        category: string;
        model?: string;
        team: CS_Team;
    }) {
        const type = this.getTypeFromCategory(category);
        const item = this.get({
            item: { type, model },
            team
        });
        const isGlove = type === "glove";
        if (item && CS_Loadout.isWithinLockTime(item.locktime)) {
            return [
                CS_Economy.find({
                    category,
                    free: true,
                    model,
                    team,
                    type
                }),
                CS_Economy.getById(item.id)
            ];
        }
        return CS_Economy.filter({
            base:
                model && !isGlove ? undefined : model && isGlove ? false : true,
            category,
            model,
            team,
            type
        });
    }
}
