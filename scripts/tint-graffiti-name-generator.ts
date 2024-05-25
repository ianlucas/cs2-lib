/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ItemGenerator } from "./item-generator.js";
import { isNotUndefined, shouldRun, writeJson } from "./utils.js";

export class TintGraffitiNameGenerator {
    async run() {
        const generator = new ItemGenerator();
        generator.readCsgoLanguageFiles(["english"]);
        generator.readItemsGameFile();
        writeJson(
            "assets/data/tint-graffiti-names.json",
            Object.values(generator.gameItems.sticker_kits)
                .map(({ item_name, sticker_material }) =>
                    !sticker_material?.includes("default/") &&
                    !sticker_material?.includes("default2019/") &&
                    !sticker_material?.includes("default2020/")
                        ? undefined
                        : generator.requireTranslation(item_name)
                )
                .filter(isNotUndefined)
        );
    }
}

if (shouldRun(import.meta.url)) {
    new TintGraffitiNameGenerator().run();
}
