/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { log } from "../utils.ts";
import { prepareWorkspace, processAssets, uploadAssets } from "./assets/build.ts";
import { buildCatalog, createItemGeneratorContext, loadSourceData } from "./catalog/build.ts";
import { detectItemGeneratorMode } from "./config.ts";
import { emitOutputs } from "./emit/write.ts";
import { runStep } from "./logging.ts";

export async function runItemGenerator() {
    const ctx = createItemGeneratorContext(detectItemGeneratorMode());
    log(`Starting item generator in ${ctx.mode} mode.`);
    await runStep(
        "Preparing workspace",
        () => prepareWorkspace(ctx),
        () => `${Object.keys(ctx.staticAssets).length} static images, ${ctx.existingImages.size} reusable images`
    );
    await runStep(
        "Loading CS2 source data",
        () => loadSourceData(ctx),
        () =>
            `${Object.keys(ctx.csgoTranslationByLanguage).length} languages, ${ctx.paintKits.length} paint kits, ${ctx.graffitiTints.length} graffiti tints`
    );
    await runStep(
        "Building item catalog",
        () => buildCatalog(ctx),
        () =>
            `${ctx.items.size} items, ${ctx.neededVpkPaths.size} VPK assets, ${ctx.imagesToProcess.size} image tasks, ${ctx.modelsToProcess.size} model tasks`
    );
    await runStep("Processing assets", () => processAssets(ctx));
    await runStep(
        "Emitting outputs",
        () => emitOutputs(ctx),
        () => `${ctx.items.size} items, ${Object.keys(ctx.itemTranslationByLanguage).length} translation files`
    );
    await runStep("Uploading assets", () => uploadAssets(ctx));
    log("Finished.");
}
