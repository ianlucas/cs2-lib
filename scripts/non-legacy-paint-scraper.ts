/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { fetchText, shouldRun, writeJson } from "./utils.js";

export class NonLegacyPaintScraper {
    async run() {
        const url = "https://bitskins.com/blog/what-cs2-weapon-skins-have-new-models";
        const contents = await fetchText(url);
        const groupRE = /<h3[^>]+>(.*?)<\/h3><ul>(.*?)<\/ul>/g;
        const anchorRE = /<a[^>]+>([^<]+)<\/a>/;
        const listItemRE = /<li>(.*?)<\/li>/g;
        const nonLegacyPaints: Record<string, string[]> = {};
        let count = 0;
        for (const [, weaponHtml, paintsHtml] of contents.matchAll(groupRE)) {
            const weapon = weaponHtml.replace(anchorRE, "$1").trim();
            for (const [, paint] of paintsHtml.matchAll(listItemRE)) {
                if (!nonLegacyPaints[weapon]) {
                    nonLegacyPaints[weapon] = [];
                }
                nonLegacyPaints[weapon].push(paint.trim());
                count++;
            }
        }
        console.log(`Scraped ${Object.keys(nonLegacyPaints).length} weapons, ${count} skins.`);
        writeJson("scripts/data/non-legacy-paints.json", nonLegacyPaints);
    }
}

if (shouldRun(import.meta.url)) {
    new NonLegacyPaintScraper().run();
}
