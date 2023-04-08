import { CS_Economy } from "./economy";
import { CS_TEAM_NONE, CS_Team } from "./teams";

export interface CS_InventoryItem {
    float?: number;
    id: number;
    locktime?: number;
    nametag?: string;
    seed?: number;
    stickers?: number[];
    team: CS_Team;
    unequipped?: boolean;
}

const CAN_EQUIP = ["glove", "melee", "musickit", "weapon"];
const HAS_FLOAT = ["glove", "melee", "weapon"];
const HAS_NAMETAG = ["melee", "weapon"];
const HAS_SEED = ["glove", "melee"];
const HAS_STICKERS = ["weapon"];

export const nametagRE =
    /^[A-Za-z0-9`!@#$%^&*-+=(){}\[\]\/\\,.?:;'_][A-Za-z0-9`!@#$%^&*-+=(){}\[\]\/\\,.?:;'_\s|]{0,19}$/;

export class CS_Inventory {
    static locktime: number = 0;
    items: CS_InventoryItem[] = [];

    static setLocktime(seconds: number) {
        CS_Inventory.locktime = 1000 * seconds;
    }

    static isWithinLocktime(ms?: number) {
        return ms !== undefined && Date.now() - ms < CS_Inventory.locktime;
    }

    constructor(items: CS_InventoryItem[]) {
        this.items = items;
    }

    equip({ float, id, nametag, seed, stickers, team }: CS_InventoryItem) {
        const item = CS_Economy.getById(id);
        if (item.teams === undefined) {
            team = CS_TEAM_NONE;
        }
        if (!CAN_EQUIP.includes(item.type)) {
            throw new Error("you cannot equip this item");
        }
        const relative = this.items.find((equipped) => {
            const other = CS_Economy.getById(equipped.id);
            return (
                other.type === item.type &&
                other.model === item.model &&
                equipped.team === team
            );
        });
        if (
            relative !== undefined &&
            CS_Inventory.isWithinLocktime(relative.locktime)
        ) {
            if (!item.free && item.id !== relative.id) {
                throw new Error("item is locked");
            }
            return new CS_Inventory(
                this.items.map((other) =>
                    other === relative
                        ? { ...other, unequipped: item.free ? true : undefined }
                        : other
                )
            );
        }
        const items = this.items.filter((other) => other !== relative);
        if (item.free) {
            return new CS_Inventory(items);
        }
        if (float !== undefined) {
            if (!HAS_FLOAT.includes(item.type)) {
                throw new Error("invalid float");
            }
            if (float < 0.000001 || float > 0.999999) {
                throw new Error("invalid float");
            }
        }
        if (seed !== undefined) {
            if (!HAS_SEED.includes(item.type)) {
                throw new Error("invalid seed");
            }
            if (seed < 1 || seed > 1000) {
                throw new Error("invalid seed");
            }
        }
        if (stickers !== undefined) {
            if (!HAS_STICKERS.includes(item.type)) {
                throw new Error("invalid stickers");
            }
            if (stickers.length > 4) {
                throw new Error("invalid stickers");
            }
            for (const sticker of stickers) {
                if (CS_Economy.getById(sticker).type !== "sticker") {
                    throw new Error("invalid stickers");
                }
            }
        }
        if (nametag !== undefined) {
            if (!HAS_NAMETAG.includes(item.type)) {
                throw new Error("invalid nametag");
            }
            if (!nametagRE.test(nametag)) {
                throw new Error("invalid nametag");
            }
        }
        return new CS_Inventory(
            items.concat({
                float,
                id: item.id,
                nametag,
                seed,
                stickers,
                team,
                locktime: CS_Inventory.locktime > 0 ? Date.now() : undefined
            })
        );
    }

    safeEquip(item: CS_InventoryItem) {
        try {
            return this.equip(item);
        } catch {
            return this;
        }
    }
}
