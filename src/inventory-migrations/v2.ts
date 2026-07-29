/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CS2_MAX_STICKER_ROTATION, CS2_STICKER_ROTATION_STEP } from "../economy-constants.ts";
import type { CS2InventoryMigration } from "./index.ts";

// Spelled out rather than borrowed from `inventory-rules.ts`: a rung reproduces one historical
// conversion forever, so it must not move when the rule it fed does.
function wrapRotation(rotation: number): number {
    const snapped = Math.round(rotation / CS2_STICKER_ROTATION_STEP) * CS2_STICKER_ROTATION_STEP;
    return snapped > CS2_MAX_STICKER_ROTATION ? snapped - 360 : snapped;
}

export const migration: CS2InventoryMigration = {
    to: 2,
    describe: "sticker rotation moves from 0-359 to -180-180",
    apply(data: any): any {
        function walk(items: any) {
            for (const item of Object.values<any>(items ?? {})) {
                for (const sticker of Object.values<any>(item.stickers ?? {})) {
                    if (sticker.rotation !== undefined) {
                        sticker.rotation = wrapRotation(sticker.rotation);
                    }
                }
                // A storage unit's contents are stored items like any other, and their rotation was
                // written in the same encoding.
                walk(item.storage);
            }
        }
        walk(data.items);
        return { ...data, version: 2 };
    }
};
