/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

export function compare<T, U>(var1: T, var2: U) {
    return (
        var1 === undefined ||
        var1 === (typeof var1 === "boolean" ? var2 || false : var2)
    );
}
