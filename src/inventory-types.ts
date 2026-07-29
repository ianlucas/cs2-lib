/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CS2EconomyInstance } from "./economy.ts";

export interface CS2BaseInventoryItem {
    charges?: number;
    containerId?: number;
    equipped?: boolean;
    equippedCT?: boolean;
    equippedT?: boolean;
    id: number;
    keychains?: Record<
        string,
        {
            id: number;
            seed?: number;
            x?: number;
            y?: number;
            z?: number;
        }
    >;
    nameTag?: string;
    patches?: Record<string, number>;
    seed?: number;
    statTrak?: number;
    stickers?: Record<
        string,
        {
            id: number;
            rotation?: number;
            schema?: number;
            wear?: number;
            x?: number;
            y?: number;
        }
    >;
    storage?: Record<number, CS2BaseInventoryItem>;
    updatedAt?: number;
    wear?: number;
}

export interface CS2InventoryData {
    items: Record<number, CS2BaseInventoryItem>;
    version: number;
}

export interface CS2InventoryOptions {
    /**
     * Drop items the game hands out for free that carry nothing worth storing. The rule lives here
     * so there is one implementation, tested and reported; the decision to apply it stays with the
     * consumer, since an inventory losing items it did not ask to lose is a surprise otherwise.
     */
    dropEmptyDefaultItems?: boolean;
    maxItems: number;
    storageUnitMaxItems: number;
}

export interface CS2InventorySpec extends CS2InventoryOptions {
    economy: CS2EconomyInstance;
    data: CS2InventoryData;
}
