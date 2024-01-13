/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { basename } from "path";
import { GenerateScript } from "./generate.js";
import { writeTxt } from "./util.js";

class DumpDefaultGraffiti {
    async run() {
        const generate = new GenerateScript();
        generate.readCsgoLanguageTXT();
        generate.readItemsGameTXT();
        const graffiti: string[] = [];

        for (const stickerProps of Object.values(generate.stickerKits)) {
            if (
                !stickerProps.sticker_material?.includes("default/") &&
                !stickerProps.sticker_material?.includes("default2019/") &&
                !stickerProps.sticker_material?.includes("default2020/")
            ) {
                continue;
            }
            graffiti.push(generate.requireTranslation(stickerProps.item_name));
        }

        writeTxt("assets/data/dump-default-graffiti.txt", graffiti.join("\n"));
    }
}

if (basename(process.argv[1]) === "dump-default-graffiti.ts") {
    new DumpDefaultGraffiti().run();
}
