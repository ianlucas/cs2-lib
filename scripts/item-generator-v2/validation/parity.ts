/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { PARITY_IGNORED_FIELDS } from "../config.ts";
import { ItemGeneratorV2Context } from "../types.ts";

function normalize(value: unknown) {
    return JSON.stringify(value);
}

export function validateParity(ctx: ItemGeneratorV2Context) {
    const nextIds = new Set(ctx.items.keys());
    const previousIds = new Set(ctx.existingItemsById.keys());

    for (const id of previousIds) {
        if (!nextIds.has(id)) {
            ctx.report.missingItems.push(id);
        }
    }

    for (const id of nextIds) {
        const nextItem = ctx.items.get(id);
        const previousItem = ctx.existingItemsById.get(id);
        if (nextItem === undefined) {
            continue;
        }
        if (previousItem === undefined) {
            ctx.report.newItems.push(id);
            continue;
        }
        let assetOnly = false;
        for (const field of new Set([...Object.keys(previousItem), ...Object.keys(nextItem)])) {
            const left = (previousItem as unknown as Record<string, unknown>)[field];
            const right = (nextItem as unknown as Record<string, unknown>)[field];
            if (normalize(left) === normalize(right)) {
                continue;
            }
            if (PARITY_IGNORED_FIELDS.has(field)) {
                assetOnly = true;
                continue;
            }
            ctx.report.nonAssetDiffs.push({ id, field, left, right });
        }
        if (assetOnly && !ctx.report.nonAssetDiffs.some((diff) => diff.id === id)) {
            ctx.report.assetOnlyDiffs.push(id);
        }
    }

    ctx.report.assetOnlyDiffs.sort((left, right) => left - right);
    ctx.report.missingItems.sort((left, right) => left - right);
    ctx.report.newItems.sort((left, right) => left - right);
    ctx.report.nonAssetDiffs.sort((left, right) => left.id - right.id || left.field.localeCompare(right.field));
    ctx.report.missingLimitedModeFallbacks.sort((left, right) => left.id - right.id);
    ctx.report.ok =
        ctx.report.missingItems.length === 0 &&
        ctx.report.nonAssetDiffs.length === 0 &&
        ctx.report.missingLimitedModeFallbacks.length === 0;
}
