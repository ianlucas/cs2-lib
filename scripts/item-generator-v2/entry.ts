/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { detectItemGeneratorV2Mode } from "./config.ts";
import { buildCatalog, createItemGeneratorV2Context, loadSourceData } from "./catalog/build.ts";
import { emitOutputs } from "./emit/write.ts";
import { prepareWorkspace, processAssets, uploadAssets } from "./assets/build.ts";
import { validateParity } from "./validation/parity.ts";

export async function runItemGeneratorV2() {
    const ctx = createItemGeneratorV2Context(detectItemGeneratorV2Mode());
    await prepareWorkspace(ctx);
    await loadSourceData(ctx);
    await buildCatalog(ctx);
    await processAssets(ctx);
    validateParity(ctx);
    await emitOutputs(ctx);
    await uploadAssets(ctx);
}
