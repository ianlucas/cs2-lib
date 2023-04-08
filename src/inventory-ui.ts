import { CS_Economy } from "./economy";
import { CS_Inventory } from "./inventory";
import { CS_Team } from "./teams";

export class CS_InventoryUI extends CS_Inventory {
    private getTypeFromCategory(category: string) {
        const type = CS_Economy.items.find(
            (item) => item.category === category
        )?.type;
        if (type === undefined) {
            throw new Error("type not found");
        }
        return type;
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
                    free: true,
                    team,
                    type
                })
            ];
        }
        return CS_Economy.filter({ type, free: true }).map((defaultItem) => {
            const item = this.get({
                item: { model: defaultItem.model, type },
                team
            });
            if (item !== undefined && !item.unequipped) {
                return CS_Economy.getById(item.id);
            }
            return defaultItem;
        });
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
        if (item && CS_Inventory.isWithinLocktime(item.locktime)) {
            return [
                CS_Economy.find({
                    free: true,
                    team,
                    type
                }),
                CS_Economy.getById(item.id)
            ];
        }
        return CS_Economy.filter({
            base: true,
            model,
            team,
            type
        });
    }
}
