/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { stripHtml } from "string-strip-html";
import { type CS2ItemTranslation } from "../../../src/economy-types.ts";
import { assert, ensure } from "../../../src/utils.ts";
import { FORMATTED_STRING_RE } from "../config.ts";
import { type ItemGeneratorContext } from "../types.ts";

function resolveToken(token?: string) {
    return (token?.charAt(0) === "#" ? token.substring(1) : token)?.toLowerCase();
}

function isTranslationKey(ctx: ItemGeneratorContext, token?: string) {
    if (token === undefined || token.length === 0) {
        return false;
    }
    const resolved = resolveToken(token);
    return resolved !== undefined && ensure(ctx.csgoTranslationByLanguage.english)[resolved] !== undefined;
}

export function findTranslation(ctx: ItemGeneratorContext, token?: string, language = "english"): string | undefined {
    token = resolveToken(token);
    if (token === undefined) {
        return undefined;
    }
    const value = ensure(ctx.csgoTranslationByLanguage[language])[token];
    return value !== undefined ? stripHtml(value).result : undefined;
}

export function requireTranslation(ctx: ItemGeneratorContext, token?: string, language = "english"): string {
    return ensure(findTranslation(ctx, token, language), `Failed to find translation for '${token}' (${language}).`);
}

export function hasTranslation(ctx: ItemGeneratorContext, token?: string): boolean {
    token = resolveToken(token);
    return token !== undefined && ensure(ctx.csgoTranslationByLanguage.english)[token] !== undefined;
}

export function addTranslation(
    ctx: ItemGeneratorContext,
    id: number,
    property: keyof CS2ItemTranslation,
    ...tokens: (string | undefined)[]
): void {
    for (const [language, items] of Object.entries(ctx.itemTranslationByLanguage)) {
        const itemLanguage = (items[id] ??= {} as CS2ItemTranslation);
        const value = tokens
            .map((token) => {
                assert(token !== undefined);
                return isTranslationKey(ctx, token)
                    ? (findTranslation(ctx, token, language) ?? requireTranslation(ctx, token))
                    : token;
            })
            .join("")
            .trim();
        if (property === "name" && language === "english" && value.length > 0) {
            ctx.itemNames.set(id, value);
        }
        if (value.length > 0) {
            itemLanguage[property] = value;
        }
    }
}

export function tryAddTranslation(
    ctx: ItemGeneratorContext,
    id: number,
    property: keyof CS2ItemTranslation,
    token: string | undefined
): void {
    if (isTranslationKey(ctx, token)) {
        addTranslation(ctx, id, property, token);
    }
}

export function addFormattedTranslation(
    ctx: ItemGeneratorContext,
    id: number,
    property: keyof CS2ItemTranslation,
    key?: string,
    ...values: string[]
): void {
    for (const [language, items] of Object.entries(ctx.itemTranslationByLanguage)) {
        (items[id] ??= {} as CS2ItemTranslation)[property] = (
            findTranslation(ctx, key, language) ?? requireTranslation(ctx, key, "english")
        ).replace(FORMATTED_STRING_RE, (_, index) => {
            const valueKey = values[parseInt(index, 10) - 1];
            return findTranslation(ctx, valueKey, language) ?? requireTranslation(ctx, valueKey, "english");
        });
    }
}
