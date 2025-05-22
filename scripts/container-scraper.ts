/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cheerio from "cheerio";
import { CS2ItemType, CS2ItemTypeValues } from "../src/economy-types.js";
import { ensure } from "../src/utils.js";
import { CS2ExtendedItem } from "./item-generator-types.js";
import { dedupe, fetchText, readJson, shouldRun, sleep, writeJson } from "./utils.js";

const MELEE_OR_GLOVES_TYPES: CS2ItemTypeValues[] = [CS2ItemType.Melee, CS2ItemType.Gloves];
export class ContainerScraper {
    private specialsData = readJson<Record<string, string[]>>("scripts/data/container-specials.json", {});
    private specials: Record<string, number[] | undefined> = {};

    async run() {
        const containerUrlRE = /"(https:\/\/csgostash\.com\/case\/\d+\/[^"]+)"/g;
        const url = "https://csgostash.com";
        const contents = await fetchText(url);
        const containerSpecials: Record<string, string[]> = {};
        const containerContents: Record<string, string[]> = {};
        const containerUrls = dedupe(Array.from(contents.matchAll(containerUrlRE)).map(([, url]) => url)).filter(
            (url) => !url.includes("?")
        );
        for (const containerUrl of containerUrls) {
            const contents = await fetchText(containerUrl);
            const specialsUrl = this.getSpecialsUrl(containerUrl, contents);
            const $ = cheerio.load(contents);
            const containerName = $("h1").text().trim();
            containerContents[containerName] = this.getNames($);
            await sleep(1000);

            if (specialsUrl) {
                const $ = cheerio.load(await fetchText(specialsUrl));
                containerSpecials[containerName] = this.getNames($);
                await sleep(1000);
            }
        }
        writeJson("scripts/data/container-contents.json", containerContents);
        writeJson("scripts/data/container-specials.json", containerSpecials);
    }

    private getSpecialsUrl(containerUrl: string, contents: string) {
        if (contents.includes("?Knives=1")) {
            return containerUrl + "?Knives=1";
        }
        if (contents.includes("?Gloves=1")) {
            return containerUrl + "?Gloves=1";
        }
        return undefined;
    }

    private getNames($: cheerio.CheerioAPI) {
        const items: string[] = [];
        $("h3").each((_, element) => {
            if (element.parent) {
                if ($(".price", element.parent).length > 0) {
                    items.push($(element).text().trim());
                }
            }
        });
        return items;
    }

    populate(items: (readonly [string, CS2ExtendedItem])[]) {
        const lookup: Record<string, number> = {};
        for (const [name, item] of items) {
            if (MELEE_OR_GLOVES_TYPES.includes(item.type)) {
                lookup[item.base ? `${name} | ★ (Vanilla)` : name] = item.id;
            }
        }
        for (const [containerName, specials] of Object.entries(this.specialsData)) {
            this.specials[containerName] = specials.map((name) => ensure(lookup[name]));
        }
    }

    getSpecials(containerName: string) {
        return this.specials[containerName];
    }
}

if (shouldRun(import.meta.url)) {
    new ContainerScraper().run();
}
