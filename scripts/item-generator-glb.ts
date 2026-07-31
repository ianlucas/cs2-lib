/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Adds EXT_meshopt_compression to a single GLB model in place. Invoked once per model by the C#
// item-generator (AssetProcessor.OptimizeGlbsMeshopt) after textures are stubbed. Purely a
// file-size optimization: the meshopt codec is fully reversible, so geometry decodes
// bit-identically and every mesh/node/skin/accessor, float precision, and the embedded
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
document
    .createExtension(EXTMeshoptCompression)
    .setRequired(true)
    .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
await io.write(glbPath, document);
