/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import invariant from "tiny-invariant";

export function compare<T, U>(var1: T, var2: U): boolean {
    return var1 === undefined || var1 === (typeof var1 === "boolean" ? var2 || false : var2);
}

export function safe<T extends (...args: any[]) => any>(fn: T): (...args: Parameters<T>) => ReturnType<T> | false {
    return function safe(...args: Parameters<T>): ReturnType<T> | false {
        try {
            return fn(...args);
        } catch {
            return false;
        }
    };
}

export function float(literal: number, fractionDigits: number = 2) {
    return parseFloat(literal.toFixed(fractionDigits));
}

export const assert: typeof invariant = invariant;
