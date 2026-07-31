/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CS2EconomyInstance } from "../economy.ts";
import type { CS2InventoryMigration } from "./index.ts";

export const migration: CS2InventoryMigration = {
    to: 1,
    describe: "array of items becomes a record keyed by uid",
    apply(data: any, economy: CS2EconomyInstance): any {
        function walkV0(v0: any) {
            const v1: any = {};
            for (let [key, value] of Object.entries<any>(v0)) {
                switch (key) {
                    case "caseid":
                        key = "containerId";
                        break;
                    case "equipped":
                    case "equippedCT":
                    case "equippedT":
                        if (economy.items.has(v0.id) && economy.getById(v0.id).isPatch()) {
                            value = undefined;
                        }
                        break;
                    case "nametag":
                        key = "nameTag";
                        break;
                    case "stattrak":
                        key = "statTrak";
                        break;
                    case "stickers":
                        value =
                            value !== undefined
                                ? Object.fromEntries(
                                      value
                                          .map((stickerId: number, slot: number) => [
                                              slot,
                                              {
                                                  id: stickerId,
                                                  wear: v0.stickerswear?.[slot] || undefined
                                              }
                                          ])
                                          .filter(([, { id }]: any) => id !== 0)
                                  )
                                : undefined;
                        break;
                    case "stickerswear":
                        continue;
                    case "storage":
                        value =
                            value !== undefined
                                ? Object.fromEntries(value.map((v0: any) => [v0.uid, walkV0(v0)]))
                                : undefined;
                        break;
                    case "uid":
                        continue;
                    case "updatedat":
                        key = "updatedAt";
                        break;
                }
                v1[key] = value;
            }
            return v1;
        }
        return {
            items: Object.fromEntries(data.map((v0: any) => [v0.uid, walkV0(v0)])),
            version: 1
        };
    }
};
