/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export function compare<T, U>(var1: T, var2: U): boolean {
    return var1 === undefined || var1 === (typeof var1 === "boolean" ? var2 || false : var2);
}

export function float(literal: number, fractionDigits: number = 2) {
    return parseFloat(literal.toFixed(fractionDigits));
}

export function assert(condition: any, message?: string): asserts condition {
    if (condition) {
        return;
    }
    throw new Error(message);
}

export function fail(message?: string): never {
    throw new Error(message);
}
