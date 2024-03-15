/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { basename } from "path";
import { ItemGenerator } from "./item-generator.js";
import { writeJson } from "./util.js";

export class TintGraffitiNameGenerator {
    async run() {
        const generator = new ItemGenerator();
        generator.readCsgoLanguage(["english"]);
        generator.readItemsGame();
        const graffiti: string[] = [];

        for (const stickerProps of Object.values(generator.stickerKits)) {
            if (
                !stickerProps.sticker_material?.includes("default/") &&
                !stickerProps.sticker_material?.includes("default2019/") &&
                !stickerProps.sticker_material?.includes("default2020/")
            ) {
                continue;
            }
            graffiti.push(generator.requireTranslation(stickerProps.item_name));
        }

        writeJson("assets/data/tint-graffiti-names.json", graffiti);
    }
}

if (basename(process.argv[1]) === "tint-graffiti-name-generator.ts") {
    new TintGraffitiNameGenerator().run();
}
