/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CS2Economy, type CS2EconomyInstance } from "./economy.ts";
import { CS2_INVENTORY_VERSION, CS2_MIN_INVENTORY_VERSION, migrations } from "./inventory-migrations/index.ts";
import type { CS2InventoryData } from "./inventory-types.ts";

/** Every way a stored document can be refused, so a caller can catch the family or a single case. */
export class CS2InventoryError extends Error {}

/** The bytes are not JSON, or they are JSON that is not an inventory document. */
export class CS2InventoryDecodeError extends CS2InventoryError {}

/** The document is stamped above the ladder's top rung, or below the oldest version still read. */
export class CS2InventoryVersionError extends CS2InventoryError {}

/** A rung threw while converting the document. */
export class CS2InventoryMigrationError extends CS2InventoryError {}

export interface CS2InventoryDecoded {
    data: CS2InventoryData;
    /** The version the document arrived at, or `undefined` when no rung had anything to do. */
    migratedFrom: number | undefined;
}

/**
 * What a load had to change to make the document usable. Asymmetric on purpose: a drop loses data,
 * so it carries enough detail to answer a support question, while a repair is a coercion the item
 * survives, so the uid is all there is to say. It holds ids and nothing resolved from them, which
 * keeps it cheap, serializable and safe to log.
 */
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
}

/**
 * Reads unvetted bytes into a document at the current version. It refuses rather than returning
 * `undefined`: swallowing a decode failure is how a readable inventory turns into an empty one, so
 * a caller that wants tolerance asks for it explicitly with `safe()`.
 */
export function decodeInventoryData(raw: string, economy: CS2EconomyInstance = CS2Economy): CS2InventoryDecoded {
    let value: any;
    try {
        value = JSON.parse(raw);
    } catch (cause) {
        throw new CS2InventoryDecodeError("inventory is not valid JSON", { cause });
    }
    // Version 0 is a bare array, so the only shape the ladder's input has to have is "an object".
    if (typeof value !== "object" || value === null) {
        throw new CS2InventoryDecodeError("inventory is not an object");
    }
    const version: number = value.version ?? 0;
    if (!Number.isInteger(version) || version < CS2_MIN_INVENTORY_VERSION || version > CS2_INVENTORY_VERSION) {
        throw new CS2InventoryVersionError(
            `inventory version ${version} is outside the readable range ${CS2_MIN_INVENTORY_VERSION}-${CS2_INVENTORY_VERSION}`
        );
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
    if (typeof value.items !== "object" || value.items === null) {
        throw new CS2InventoryDecodeError("inventory has no items");
    }
    return { data: value, migratedFrom: migrated ? version : undefined };
}
