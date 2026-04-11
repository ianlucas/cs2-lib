/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { log } from "../utils.ts";

export function itemGeneratorLog(message: string) {
    log(`[item-generator] ${message}`);
}

export function formatCount(count: number, singular: string, plural = `${singular}s`) {
    return `${count} ${count === 1 ? singular : plural}`;
}

function formatDuration(start: number) {
    const elapsed = Date.now() - start;
    return elapsed < 1000 ? `${elapsed}ms` : `${(elapsed / 1000).toFixed(1)}s`;
}

export async function runItemGeneratorStep(
    name: string,
    callback: () => Promise<void>,
    getSummary?: () => string | undefined
) {
    const start = Date.now();
    itemGeneratorLog(`${name}...`);
    await callback();
    const summary = getSummary?.();
    itemGeneratorLog(`${name} done${summary !== undefined ? ` (${summary})` : ""} in ${formatDuration(start)}.`);
}
