/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { format } from "util";
import { warning, write, writeJson } from "../../utils.ts";
import {
    ENGLISH_JSON_PATH,
    ITEM_IDS_JSON_PATH,
    ITEMS_JSON_PATH,
    ITEMS_TS_PATH,
    TRANSLATIONS_TS_PATH
} from "../config.ts";
import { createItemsModule, createTranslationModule } from "../output-templates.ts";
import { type ItemGeneratorContext } from "../types.ts";

export async function emitOutputs(ctx: ItemGeneratorContext): Promise<void> {
    const items = Array.from(ctx.items.values()).map((item) => ({
        ...item,
        className: undefined,
        descToken: undefined,
        nameToken: undefined
    }));

    await writeJson(ITEMS_JSON_PATH, items);
    await writeJson(ITEM_IDS_JSON_PATH, ctx.allIdentifiers);
    await write(ITEMS_TS_PATH, createItemsModule(items));

    for (const [language, translations] of Object.entries(ctx.itemTranslationByLanguage)) {
        const tsPath = format(TRANSLATIONS_TS_PATH, language);
        await write(tsPath, createTranslationModule(language, translations));
        warning(`Successfully generated '${tsPath}'.`);
        if (language === "english") {
            await writeJson(ENGLISH_JSON_PATH, translations);
        }
    }

    warning(`Successfully generated '${ITEMS_JSON_PATH}'.`);
    warning(`Successfully generated '${ITEM_IDS_JSON_PATH}'.`);
    warning(`Successfully generated '${ITEMS_TS_PATH}'.`);
}
