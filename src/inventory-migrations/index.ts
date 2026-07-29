/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CS2EconomyInstance } from "../economy.ts";
import { assert, ensure } from "../utils.ts";
import { migration as v1 } from "./v1.ts";
import { migration as v2 } from "./v2.ts";

export interface CS2InventoryMigration {
    to: number;
    describe: string;
    apply(data: any, economy: CS2EconomyInstance): any;
}

export const migrations: CS2InventoryMigration[] = [v1, v2];

migrations.forEach((migration, index) => {
    assert(
        migration.to === index + 1,
        `migration at index ${index} produces version ${migration.to}, expected ${index + 1}`
    );
});

export const CS2_INVENTORY_VERSION: number = ensure(migrations.at(-1)).to;

export const CS2_MIN_INVENTORY_VERSION = 0;
