/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import fetch from "node-fetch";
import { basename } from "path";
import { writeJson } from "./util";

class DumpNewModelSkins {
    async run() {
        const url = "https://bitskins.com/blog/what-cs2-weapon-skins-have-new-models";
        console.log(`scraping ${url}...`);
        const contents = await (await fetch(url)).text();
        const groupRE = /<h3[^>]+>(.*?)<\/h3><ul>(.*?)<\/ul>/g;
        const anchorRE = /<a[^>]+>([^<]+)<\/a>/;
        const listItemRE = /<li>(.*?)<\/li>/g;
        const newModelSkins: Record<string, string[]> = {};
        let skinCount = 0;
        for (const [, weaponContents, paintsContents] of contents.matchAll(groupRE)) {
            const weapon = weaponContents.replace(anchorRE, "$1").trim();
            for (const [, paint] of paintsContents.matchAll(listItemRE)) {
                if (!newModelSkins[weapon]) {
                    newModelSkins[weapon] = [];
                }
                newModelSkins[weapon].push(paint.trim());
                skinCount++;
            }
        }

        console.log(`dumped ${Object.keys(newModelSkins).length} weapons, ${skinCount} skins.`);
        writeJson("assets/data/dump-new-model-skins.json", newModelSkins);
    }
}

if (basename(process.argv[1]) === "dump-new-model-skins.ts") {
    new DumpNewModelSkins().run();
}
