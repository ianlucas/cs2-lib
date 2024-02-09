import * as cheerio from "cheerio";
import { basename } from "path";
import { sleep, writeJson } from "./util.js";

class DumpCaseContents {
    async run() {
        const caseUrlRE = /"(https:\/\/csgostash\.com\/case\/\d+\/[^"]+)"/g;
        const url = "https://csgostash.com";
        console.log(`scraping ${url}...`);
        const contents = await (await fetch(url)).text();
        const caseSpecialContents: Record<string, string[]> = {};
        for (const [, caseUrl] of contents.matchAll(caseUrlRE)) {
            if (caseUrl.includes("?")) {
                continue;
            }
            console.log(`scraping ${caseUrl}...`);
            const contents = await (await fetch(caseUrl)).text();
            const specialContentsUrl = this.getSpecialContentsUrl(caseUrl, contents);
            const $ = cheerio.load(contents);
            const caseName = $("h1").text().trim();
            await sleep(1000);

            if (specialContentsUrl) {
                console.log(`scraping ${specialContentsUrl}...`);
                const contents = await (await fetch(specialContentsUrl)).text();
                const $ = cheerio.load(contents);
                caseSpecialContents[caseName] = this.getItemNames($);
                await sleep(1000);
            }
        }

        console.log(`dumped ${Object.keys(caseSpecialContents).length} items.`);
        writeJson("assets/data/dump-case-special-contents.json", caseSpecialContents);
    }

    getSpecialContentsUrl(caseUrl: string, contents: string) {
        if (contents.includes("?Knives=1")) {
            return caseUrl + "?Knives=1";
        }
        if (contents.includes("?Gloves=1")) {
            return caseUrl + "?Gloves=1";
        }
        return undefined;
    }

    getItemNames($: cheerio.CheerioAPI) {
        const items: string[] = [];
        $("h3").each((index, element) => {
            if (element.parent) {
                if ($(".price", element.parent).length > 0) {
                    items.push($(element).text().trim());
                }
            }
        });
        return items;
    }
}

if (basename(process.argv[1]) === "dump-case-contents.ts") {
    new DumpCaseContents().run();
}
