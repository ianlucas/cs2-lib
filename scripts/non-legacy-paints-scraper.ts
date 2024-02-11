/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { basename } from "path";
import { fetchText, writeJson } from "./util.js";

export class NonLegacyPaintsScraper {
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

        console.log(`scraped ${Object.keys(nonLegacyPaints).length} weapons, ${count} skins.`);
        writeJson("assets/data/non-legacy-paints.json", nonLegacyPaints);
    }
}

if (basename(process.argv[1]) === "non-legacy-paints-scraper.ts") {
    new NonLegacyPaintsScraper().run();
}
