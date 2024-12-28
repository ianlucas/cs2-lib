/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export function useItemsTemplate(items: unknown) {
    return `/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CS2Item } from "./economy-types.js";

// @generated
// @ts-ignore
export const CS2_ITEMS: CS2Item[] = ${JSON.stringify(items)};`;
}
