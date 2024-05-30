/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    CS2InventoryData,
    CS2InventoryInstance,
    CS2InventorySpec,
    CS2_INVENTORY_VERSION
} from "./inventory-instance.js";

function parse(stringValue: string | null | undefined): CS2InventoryData | undefined {
    try {
        if (!stringValue) {
            return undefined;
        }
        let value = JSON.parse(stringValue);
        if (value.version !== CS2_INVENTORY_VERSION) {
            value = toV1(value);
        }
        return value;
    } catch {
        return undefined;
    }
}

function toV1(data: any) {
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
                                  value.map((stickerId: any, slot: number) => [
                                      slot,
                                      {
                                          id: stickerId,
                                          wear: v0.stickerswear?.[slot]
                                      }
                                  ])
                              )
                            : undefined;
                    break;
                case "stickerswear":
                    continue;
                case "storage":
                    value =
                        value !== undefined ? Object.fromEntries(value.map((v0) => [v0.uid, walkV0(v0)])) : undefined;
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
        items: Object.fromEntries(data.map((v0) => [v0.uid, walkV0(v0)])),
        version: 1
    };
}

export class CS2Inventory {
    static parse({
        data,
        ...params
    }: Omit<CS2InventorySpec, "data"> & {
        data: string | null | undefined;
    }) {
        return new CS2InventoryInstance({
            ...params,
            data: parse(data)
        });
    }
}
