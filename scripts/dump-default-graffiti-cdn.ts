/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import fetch from "node-fetch";
import { basename } from "path";
import { readTxt, sleep, writeJson } from "./util.js";

class DumpDefaultGraffitiCdn {
    async run() {
        const min = 1;
        const max = 5;
        const graffiti = readTxt("dist/dump-default-graffiti.txt").split("\n");
        const anchorRE = /<a href="https:\/\/csgostash.com\/graffiti\/(\d+)\/([^"]+)">([^<]+)<\/a>/g;
        const imageRE = /src="([^"]+)" alt="([^"]+)"/g;
        const urls: string[] = [];
        const cdn: Record<string, string> = {};
        for (let page = min; page <= max; page++) {
            const url = `https://csgostash.com/graffiti?page=${page}`;
            console.log(`scraping ${url}...`);
            const contents = await (await fetch(url)).text();
            await sleep(1000);
            for (const [, id, slug, name] of contents.matchAll(anchorRE)) {
                if (graffiti.includes(name)) {
                    urls.push(`https://csgostash.com/graffiti/${id}`);
                }
            }
            for (const url of urls) {
                console.log(`scraping ${url}...`);
                const contents = await (await fetch(url)).text();
                for (const [, url, alt] of contents.matchAll(imageRE)) {
                    if (url.includes("https://steamcommunity-a.akamaihd.net")) {
                        cdn[alt.replace("Sealed Graffiti | ", "")] = url.replace("256fx256f", "256fx192f");
                    }
                }
                await sleep(1000);
            }
        }

        console.log(`dumped ${Object.keys(cdn).length} items.`);
        writeJson("dist/dump-default-graffiti-cdn.json", cdn);
    }
}

if (basename(process.argv[1]) === "dump-default-graffiti-cdn.ts") {
    new DumpDefaultGraffitiCdn().run();
}
