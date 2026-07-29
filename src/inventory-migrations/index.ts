/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CS2Economy, type CS2EconomyInstance } from "../economy.ts";
import type { CS2InventoryData } from "../inventory-types.ts";
import { assert, ensure } from "../utils.ts";
import { migration as v1 } from "./v1.ts";

/**
 * One rung of the ladder: the shape change that takes an inventory to version `to`. A rung exists
 * only for changes that cannot be re-derived from the catalog on every load — anything that can be
 * is a rule in `inventory-rules.ts` instead.
 */
export interface CS2InventoryMigration {
    to: number;
    /** One line of prose for the migration log, and for reading the format's history in source. */
    describe: string;
    apply(data: any, economy: CS2EconomyInstance): any;
}

export const migrations: CS2InventoryMigration[] = [v1];

// A gap in the ladder would let a document skip a rung and arrive half-migrated with nothing
// raised, so refuse to load at all rather than run an incomplete ladder.
migrations.forEach((migration, index) => {
    assert(
        migration.to === index + 1,
        `migration at index ${index} produces version ${migration.to}, expected ${index + 1}`
    );
});

/**
 * Derived from the ladder rather than written down, so the version a document is stamped with
 * cannot drift from the rungs that produce it.
 */
export const CS2_INVENTORY_VERSION: number = ensure(migrations.at(-1)).to;

/**
 * The oldest version still readable. A rung may only be deleted once a backfill has proven no
 * stored document sits below the floor; until then every version down to 0 stays supported.
 */
export const CS2_MIN_INVENTORY_VERSION = 0;

export function resolveInventoryData(
    stringValue?: string,
    economy: CS2EconomyInstance = CS2Economy
): CS2InventoryData | undefined {
    try {
        if (!stringValue) {
            return undefined;
        }
        let value = JSON.parse(stringValue);
        const version = value.version ?? 0;
        for (const migration of migrations) {
            if (migration.to > version) {
                value = migration.apply(value, economy);
            }
        }
        return value;
    } catch {
        return undefined;
    }
}
