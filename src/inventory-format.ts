/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CS2Economy, type CS2EconomyInstance } from "./economy.ts";
import { CS2_INVENTORY_VERSION, CS2_MIN_INVENTORY_VERSION, migrations } from "./inventory-migrations/index.ts";
import type { CS2InventoryData } from "./inventory-types.ts";

export class CS2InventoryError extends Error {}

export class CS2InventoryDecodeError extends CS2InventoryError {}

export class CS2InventoryVersionError extends CS2InventoryError {}

export class CS2InventoryMigrationError extends CS2InventoryError {}

export interface CS2InventoryDecoded {
    data: CS2InventoryData;
    migratedFrom: number | undefined;
}

export interface CS2InventoryLoadReport {
    migratedFrom: number | undefined;
    dropped: CS2InventoryDrop[];
    repairedUids: number[];
}

export type CS2InventoryDropReason = "unknown-item" | "unrepairable" | "policy";

export interface CS2InventoryDrop {
    uid: number;
    id: number;
    reason: CS2InventoryDropReason;
    storageUid?: number;
}

export function decodeInventoryData(raw: string, economy: CS2EconomyInstance = CS2Economy): CS2InventoryDecoded {
    let value: any;
    try {
        value = JSON.parse(raw);
    } catch (cause) {
        throw new CS2InventoryDecodeError("inventory is not valid JSON", { cause });
    }
    if (typeof value !== "object" || value === null) {
        throw new CS2InventoryDecodeError("inventory is not an object");
    }
    const version: number = value.version ?? 0;
    if (!Number.isInteger(version) || version < CS2_MIN_INVENTORY_VERSION || version > CS2_INVENTORY_VERSION) {
        throw new CS2InventoryVersionError(
            `inventory version ${version} is outside the readable range ${CS2_MIN_INVENTORY_VERSION}-${CS2_INVENTORY_VERSION}`
        );
    }
    if (version === 0) {
        if (!Array.isArray(value)) {
            throw new CS2InventoryDecodeError("inventory is not an array of items");
        }
    } else if (typeof value.items !== "object" || value.items === null) {
        throw new CS2InventoryDecodeError("inventory has no items");
    }
    let migrated = false;
    for (const migration of migrations) {
        if (migration.to > version) {
            try {
                value = migration.apply(value, economy);
            } catch (cause) {
                throw new CS2InventoryMigrationError(
                    `inventory migration to version ${migration.to} failed: ${migration.describe}`,
                    { cause }
                );
            }
            migrated = true;
        }
    }
    return { data: value, migratedFrom: migrated ? version : undefined };
}
