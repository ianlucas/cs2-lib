/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export function getItemsTsContents(items: unknown) {
    return `/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @generated
import { Cs2Item } from "./economy.js";
 
// @ts-ignore
export const CS_ITEMS: Cs2Item[] = ${JSON.stringify(items, null, 4)};`;
}
