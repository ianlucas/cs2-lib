/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mkdir, writeFile } from "fs/promises";
import { format } from "util";
import {
    ENGLISH_JSON_PATH,
    ITEM_IDS_JSON_PATH,
    ITEMS_JSON_PATH,
    ITEMS_TS_PATH,
    STICKER_MARKUP_TS_PATH,
    TRANSLATIONS_TS_PATH,
    V2_REPORTS_DIR,
    V2_STATE_DIR
} from "../config.ts";
import { useItemsTemplate, useStickerMarkupTemplate, useTranslationTemplate } from "../../item-generator-templates.ts";
import { ItemGeneratorV2Context } from "../types.ts";
import { warning, write, writeJson } from "../../utils.ts";

export async function emitOutputs(ctx: ItemGeneratorV2Context) {
    const items = Array.from(ctx.items.values()).map((item) => ({
        ...item,
        className: undefined,
        descToken: undefined,
        nameToken: undefined
    }));

    await writeJson(ITEMS_JSON_PATH, items);
    await writeJson(ITEM_IDS_JSON_PATH, ctx.allIdentifiers);
    await write(ITEMS_TS_PATH, useItemsTemplate(items));

    for (const [language, translations] of Object.entries(ctx.itemTranslationByLanguage)) {
        const tsPath = format(TRANSLATIONS_TS_PATH, language);
        await write(tsPath, useTranslationTemplate(language, translations));
        if (language === "english") {
            await writeJson(ENGLISH_JSON_PATH, translations);
        }
    }

    if (Object.keys(ctx.stickerMarkup).length > 0) {
        await write(STICKER_MARKUP_TS_PATH, useStickerMarkupTemplate(ctx.stickerMarkup));
    }

    await mkdir(V2_STATE_DIR, { recursive: true });
    await mkdir(V2_REPORTS_DIR, { recursive: true });
    await writeFile(
        `${V2_STATE_DIR}/catalog.json`,
        JSON.stringify(items),
        "utf-8"
    );
    await writeFile(
        `${V2_STATE_DIR}/translations.json`,
        JSON.stringify(ctx.itemTranslationByLanguage),
        "utf-8"
    );
    await writeFile(`${V2_REPORTS_DIR}/parity.json`, JSON.stringify(ctx.report), "utf-8");

    warning(`Successfully generated '${ITEMS_JSON_PATH}'.`);
    warning(`Successfully generated '${ITEM_IDS_JSON_PATH}'.`);
    warning(`Successfully generated '${ITEMS_TS_PATH}'.`);
    warning(`Successfully generated '${V2_REPORTS_DIR}/parity.json'.`);
}
