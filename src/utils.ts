/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type EnumValues<T> = T[keyof T];

// @see https://stackoverflow.com/a/69895725
export type Interface<T extends object> = {
    [key in T extends any ? { [K in keyof T]-?: {} extends Pick<T, K> ? never : K }[keyof T] : never]: T[key];
} & {
    [key in T extends any ? { [K in keyof T]-?: {} extends Pick<T, K> ? K : never }[keyof T] : never]-?:
        | T[key]
        | undefined;
};

export type MapValue<T> = T extends Map<any, infer I> ? I : never;

export type RecordValue<T> = T extends Record<any, infer I> ? I : never;

export function compare<T, U>(var1: T, var2: U): boolean {
    return var1 === undefined || var1 === (typeof var1 === "boolean" ? var2 || false : var2);
}

export function float(literal: number, fractionDigits: number = 2): number {
    return parseFloat(literal.toFixed(fractionDigits));
}

export function clamp(value: number, min: number, max: number): number {
    return value < min ? min : value > max ? max : value;
}

// Decimal places in a number's canonical shortest round-trip string. Reads `toString()` instead of
// doing float arithmetic, so no rounding noise can leak in; `e±` notation (magnitudes below 1e-6 or
// at/above 1e21) is decoded from the mantissa and exponent.
export function countDecimals(value: number): number {
    const text = value.toString();
    const exponent = text.indexOf("e");
    if (exponent !== -1) {
        const mantissaDecimals = text.slice(0, exponent).split(".")[1]?.length ?? 0;
        return Math.max(0, mantissaDecimals - Number(text.slice(exponent + 1)));
    }
    return text.split(".")[1]?.length ?? 0;
}

// A "factor" (e.g. 0.0001) defines a power-of-ten quantization grid; a value sits on that grid when
// it's finite and has no more decimals than the factor does.
export function isFactorPrecise(value: number, factor: number): boolean {
    return Number.isFinite(value) && countDecimals(value) <= countDecimals(factor);
}

// Truncates toward zero onto the factor's grid by slicing the decimal string (no float arithmetic,
// so noise like 0.29 * 1e4 never leaks in). Sub-grid magnitudes print as `1e-7` and collapse to 0;
// huge `1e+21`-style integers have no fractional part and pass through for range checks to reject.
export function truncateToFactor(value: number, factor: number): number {
    const text = value.toString();
    if (text.includes("e")) {
        return text.includes("e-") ? 0 : value;
    }
    const dot = text.indexOf(".");
    return dot === -1 ? value : Number(text.slice(0, dot + 1 + countDecimals(factor)));
}

// Rounds to the nearest value on the factor's grid; recovers the exact grid value from float noise
// in either direction (e.g. 0.06 + 0.01 = 0.06999… -> 0.07), which truncation cannot.
export function roundToFactor(value: number, factor: number): number {
    return float(value, countDecimals(factor));
}

export function ensure<T>(value: T, message?: string): NonNullable<T> & {} {
    assert(value !== undefined && value !== null, message);
    return value;
}

export function safe<T>(fn: () => T): false | T {
    try {
        return fn();
    } catch {
        return false;
    }
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

export function isNotUndefined<T>(value: T): value is NonNullable<T> {
    return value !== undefined;
}
