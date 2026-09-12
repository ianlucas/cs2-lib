/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Finishes a single GLB model in place: hands the Source-to-glTF conversion back to the scene's
// root node (see item-generator-glb-unbake.ts, which explains why the published .glb contract puts
// it there), then adds EXT_meshopt_compression. Invoked once per model by the C# item-generator
// (AssetProcessor.OptimizeGlbsMeshopt) after textures are stubbed.
//
// The meshopt pass is purely a file-size optimization: the codec is fully reversible, so geometry
// decodes bit-identically and every mesh/node/skin/accessor, float precision, and the embedded
// EXT_texture_webp stubs are untouched. Constraints:
// - Do NOT switch to gltf-transform's `meshopt()` wrapper: it also quantizes and prunes, which
//   is lossy and removes skins/accessors.
// - Reversibility is a correctness requirement, not a quality preference: consumers ray the
//   weapon's own triangles to place keychain charms (a moved vertex moves a stored placement),
//   and the model's cloth collider (MetadataExtractor.ExtractClothCollider) describes the same
//   surface these triangles do.

import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTMeshoptCompression } from "@gltf-transform/extensions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import { unbakeSourceConversion } from "./item-generator-glb-unbake.ts";

const glbPath = process.argv[2];
if (glbPath === undefined) {
    console.error("usage: tsx item-generator-glb.ts <glb>");
    process.exit(1);
}

await MeshoptEncoder.ready;

const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ "meshopt.encoder": MeshoptEncoder, "meshopt.decoder": MeshoptDecoder });

const document = await io.read(glbPath);
unbakeSourceConversion(document);
document
    .createExtension(EXTMeshoptCompression)
    .setRequired(true)
    .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
await io.write(glbPath, document);
