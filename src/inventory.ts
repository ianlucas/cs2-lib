import { CS_Economy } from "./economy";
import { CS_TEAM_NONE, CS_Team } from "./teams";

export interface CS_InventoryItem {
    float?: number;
    id: number;
    nametag?: string;
    seed?: number;
    stickers?: number[];
    team: CS_Team;
}

const CAN_EQUIP = ["glove", "melee", "musickit", "weapon"];
const HAS_FLOAT = ["glove", "melee", "weapon"];
const HAS_NAMETAG = ["melee", "weapon"];
const HAS_SEED = ["glove", "melee"];
const HAS_STICKERS = ["weapon"];

export class CS_Inventory {
    items: CS_InventoryItem[] = [];

    constructor(items: CS_InventoryItem[]) {
        this.items = items;
    }

    equip({
        float,
        id,
        nametag,
        seed,
        stickers,
        team
    }: {
        float?: number;
        id: number;
        nametag?: string;
        seed?: number;
        stickers?: number[];
        team: CS_Team;
    }) {
        const item = CS_Economy.getById(id);
        if (item.teams === undefined) {
            team = CS_TEAM_NONE;
        }
        if (item.base && item.free) {
            return new CS_Inventory(
                this.items.filter((equipped) => {
                    const other = CS_Economy.getById(equipped.id);
                    return (
                        other.type === item.type &&
                        other.model === item.model &&
                        equipped.team === team
                    );
                })
            );
        }
        return this.items.concat({
            float,
            id: item.id,
            nametag,
            seed,
            stickers,
            team
        });
    }
}
