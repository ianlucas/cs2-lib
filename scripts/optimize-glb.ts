// Adds EXT_meshopt_compression to a single GLB model in place. Invoked once per model by the C#
// item-generator (AssetProcessor.OptimizeGlbsMeshopt) after textures are stubbed. This is purely
// a file-size optimization: the meshopt codec is fully reversible, so geometry decodes
// bit-identically and every mesh/node/skin/accessor, float precision, and the embedded
// EXT_texture_webp stubs are left untouched. We deliberately do NOT quantize or prune (the
// gltf-transform `meshopt()` wrapper does both, which is lossy and removes skins/accessors).
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTMeshoptCompression } from "@gltf-transform/extensions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";

const glbPath = process.argv[2];
if (glbPath === undefined) {
    console.error("usage: tsx optimize-glb.ts <glb>");
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
