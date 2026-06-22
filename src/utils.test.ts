/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, test } from "vitest";
import { clamp, countDecimals, isFactorPrecise, roundToFactor, truncateToFactor } from "./utils.ts";

describe("utils", () => {
    test("clamp keeps values within [min, max]", () => {
        expect(clamp(5, 0, 10)).toBe(5);
        expect(clamp(-1, 0, 10)).toBe(0);
        expect(clamp(11, 0, 10)).toBe(10);
        expect(clamp(0, 0, 10)).toBe(0);
        expect(clamp(10, 0, 10)).toBe(10);
        expect(clamp(-0.5, -0.4323, 0.4206)).toBe(-0.4323);
        expect(clamp(-0.1, -0.4323, 0.4206)).toBe(-0.1);
        expect(clamp(0.9, -0.4323, 0.4206)).toBe(0.4206);
    });

    test("countDecimals reads the canonical string, including exponential notation", () => {
        expect(countDecimals(0)).toBe(0);
        expect(countDecimals(1)).toBe(0);
        expect(countDecimals(123)).toBe(0);
        expect(countDecimals(0.1)).toBe(1);
        expect(countDecimals(0.0001)).toBe(4);
        expect(countDecimals(0.000001)).toBe(6);
        expect(countDecimals(-0.4323)).toBe(4);
        expect(countDecimals(123.4)).toBe(1);
        // Magnitudes below 1e-6 print as `e-` yet must still report their true precision.
        expect(countDecimals(1e-7)).toBe(7);
        expect(countDecimals(1.5e-7)).toBe(8);
        expect(countDecimals(5e-7)).toBe(7);
        // Huge integers print as `e+` and have no fractional part.
        expect(countDecimals(1e21)).toBe(0);
    });

    test("isFactorPrecise accepts on-grid finite values only", () => {
        expect(isFactorPrecise(0.5, 0.0001)).toBe(true);
        expect(isFactorPrecise(0.1234, 0.0001)).toBe(true);
        expect(isFactorPrecise(-0.4323, 0.0001)).toBe(true);
        expect(isFactorPrecise(0, 0.0001)).toBe(true);
        // Too many decimals for the grid.
        expect(isFactorPrecise(0.12345, 0.0001)).toBe(false);
        // Sub-grid magnitudes are over-precise, not zero.
        expect(isFactorPrecise(1e-7, 0.0001)).toBe(false);
        // Non-finite never passes.
        expect(isFactorPrecise(NaN, 0.0001)).toBe(false);
        expect(isFactorPrecise(Infinity, 0.0001)).toBe(false);
    });

    test("truncateToFactor truncates toward zero onto the grid without float noise", () => {
        expect(truncateToFactor(0.43235, 0.0001)).toBe(0.4323);
        expect(truncateToFactor(-0.43235, 0.0001)).toBe(-0.4323);
        expect(truncateToFactor(0.12345, 0.0001)).toBe(0.1234);
        // No float noise (the 0.29 * 1e4 = 2899.999… class) leaks in.
        expect(truncateToFactor(0.29, 0.0001)).toBe(0.29);
        // Already on grid / integers pass through.
        expect(truncateToFactor(0.1, 0.0001)).toBe(0.1);
        expect(truncateToFactor(1, 0.0001)).toBe(1);
        expect(truncateToFactor(0, 0.0001)).toBe(0);
        // Sub-grid magnitudes collapse to zero; huge integers pass through.
        expect(truncateToFactor(5e-7, 0.0001)).toBe(0);
        expect(truncateToFactor(1.5e-7, 0.0001)).toBe(0);
        expect(truncateToFactor(1e21, 0.0001)).toBe(1e21);
        // Honors the factor's own precision.
        expect(truncateToFactor(0.123456, 0.01)).toBe(0.12);
        expect(truncateToFactor(0.123456, 0.000001)).toBe(0.123456);
    });

    test("roundToFactor rounds to the nearest grid value, recovering float noise both ways", () => {
        expect(roundToFactor(0.156, 0.01)).toBe(0.16);
        expect(roundToFactor(0.154, 0.01)).toBe(0.15);
        expect(roundToFactor(-0.156, 0.01)).toBe(-0.16);
        // 0.06 + 0.01 lands at 0.06999999999999999; rounding recovers the step, truncation would not.
        expect(roundToFactor(0.06 + 0.01, 0.01)).toBe(0.07);
        expect(roundToFactor(0.09 + 0.01, 0.01)).toBe(0.1);
        expect(truncateToFactor(0.06 + 0.01, 0.01)).toBe(0.06);
        expect(roundToFactor(0.1234567, 0.000001)).toBe(0.123457);
    });

    test("truncateToFactor output always satisfies isFactorPrecise (heal ⊇ validate)", () => {
        for (const value of [0.43235, -0.43235, 0.12345, 5e-7, 1.5e-7, 0.29, 0.999999]) {
            expect(isFactorPrecise(truncateToFactor(value, 0.0001), 0.0001)).toBe(true);
        }
    });
});
