/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { basename } from "path";
import { fetchText, readJson, sleep, writeJson } from "./util.js";

export class TintGraffitiImagesScraper {
    async run() {
        const min = 1;
        const max = 5;
        const graffiti = readJson<string[]>("assets/data/tint-graffiti-names.json");
        const anchorRE = /<a href="https:\/\/csgostash.com\/graffiti\/(\d+)\/([^"]+)">([^<]+)<\/a>/g;
        const imageRE = /src="([^"]+)" alt="([^"]+)"/g;
        const urls: string[] = [];
        const images: Record<string, string> = {};

        for (let page = min; page <= max; page++) {
            const url = `https://csgostash.com/graffiti?page=${page}`;
            const contents = await fetchText(url);
            await sleep(1000);
            for (const [, id, slug, name] of contents.matchAll(anchorRE)) {
                if (graffiti.includes(name)) {
                    urls.push(`https://csgostash.com/graffiti/${id}`);
                }
            }
            for (const url of urls) {
                const contents = await fetchText(url);
                for (const [, url, alt] of contents.matchAll(imageRE)) {
                    if (url.includes("https://steamcommunity-a.akamaihd.net")) {
                        images[alt.replace("Sealed Graffiti | ", "")] = url.replace("256fx256f", "256fx192f");
                    }
                }
                await sleep(1000);
            }
        }

        console.log(`scraped ${Object.keys(images).length} items.`);
        writeJson("assets/data/tint-graffiti-images.json", images);
    }
}

if (basename(process.argv[1]) === "tint-graffiti-images-scraper.ts") {
    new TintGraffitiImagesScraper().run();
}
