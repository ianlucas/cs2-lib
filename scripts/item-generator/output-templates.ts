/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const banner = `/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/`;

export function createItemsModule(items: unknown) {
    return `${banner}

import type { CS2Item } from "./economy-types.ts";

// @generated
// @ts-ignore
export const CS2_ITEMS: CS2Item[] = ${JSON.stringify(items)};`;
}

export function createStickerMarkupModule(stickerMarkup: unknown) {
    return `${banner}

import type { CS2StickerMarkup } from "./economy-types.ts";

// @generated
// @ts-ignore
export const CS2_STICKER_MARKUP: CS2StickerMarkup = ${JSON.stringify(stickerMarkup)};`;
}

export function createTranslationModule(language: string, tokens: unknown) {
    return `${banner}

import type { CS2ItemTranslationMap } from "../economy-types.ts";

// @generated
// @ts-ignore
export const ${language}: CS2ItemTranslationMap = ${JSON.stringify(tokens)};`;
}
