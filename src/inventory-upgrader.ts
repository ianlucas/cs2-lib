/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CS2InventoryData, CS2_INVENTORY_VERSION } from "./inventory.js";

const upgrades: Record<
    number,
    (data: any) => {
        items: {
            [k: string]: any;
        };
        version: number;
    }
> = {
    1: (data: any) => {
        function walkV0(v0: any) {
            const v1: any = {};
            for (let [key, value] of Object.entries<any>(v0)) {
                switch (key) {
                    case "caseid":
                        key = "containerId";
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
                                          .filter((stickerId: number) => stickerId !== 0)
                                          .map((stickerId: number, slot: number) => [
                                              slot,
                                              {
                                                  id: stickerId,
                                                  wear: v0.stickerswear?.[slot] || undefined
                                              }
                                          ])
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

export function resolveInventoryData(stringValue: string | null | undefined): CS2InventoryData | undefined {
    try {
        if (!stringValue) {
            return undefined;
        }
        let value = JSON.parse(stringValue);
        const currentVersion = value.version ?? 0;
        for (let i = currentVersion + 1; i <= CS2_INVENTORY_VERSION; i++) {
            if (upgrades[i]) {
                value = upgrades[i](value);
            }
        }
        return value;
    } catch {
        return undefined;
    }
}
