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
    /** The slot the item sat in inside its unit when `storageUid` is set, otherwise its own uid. */
    uid: number;
    id: number;
    reason: CS2InventoryDropReason;
    /** The storage unit the item came out of, absent for an item that was not inside one. */
    storageUid?: number;
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
    // An array is an object too, which is as much as can be said before the version stamp is read.
    if (typeof value !== "object" || value === null) {
        throw new CS2InventoryDecodeError("inventory is not an object");
    }
    const version: number = value.version ?? 0;
    if (!Number.isInteger(version) || version < CS2_MIN_INVENTORY_VERSION || version > CS2_INVENTORY_VERSION) {
        throw new CS2InventoryVersionError(
            `inventory version ${version} is outside the readable range ${CS2_MIN_INVENTORY_VERSION}-${CS2_INVENTORY_VERSION}`
        );
    }
    // A document has to be the shape its own stamp implies before a rung is allowed to touch it.
    // Otherwise any object at all reads as an unstamped version 0, reaches the rung that expects an
    // array, and comes back as a migration that failed — when what it is is bytes that were never an
    // inventory, which is a caller's problem to fix rather than this package's.
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
