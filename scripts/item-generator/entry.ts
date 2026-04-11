/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { detectItemGeneratorMode } from "./config.ts";
import { buildCatalog, createItemGeneratorContext, loadSourceData } from "./catalog/build.ts";
import { emitOutputs } from "./emit/write.ts";
import { prepareWorkspace, processAssets, uploadAssets } from "./assets/build.ts";

export async function runItemGenerator() {
    const ctx = createItemGeneratorContext(detectItemGeneratorMode());
    await prepareWorkspace(ctx);
    await loadSourceData(ctx);
    await buildCatalog(ctx);
    await processAssets(ctx);
    await emitOutputs(ctx);
    await uploadAssets(ctx);
}
