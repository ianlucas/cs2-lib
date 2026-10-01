/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Finishes a single GLB model in place: hands the Source-to-glTF conversion back to the scene's
 * root node (item-generator-unbake.ts explains why the published .glb contract puts it there), then
 * adds EXT_meshopt_compression. Invoked once per model by the C# item-generator
 * (AssetProcessor.OptimizeGlbsMeshopt) after textures are stubbed.
 *
 * An agent has already been through item-generator-agent-glb.ts by this point, so its conversion is
 * on the root node and the unbake below is the no-op it documents itself to be.
 *
 * Two optional flags narrow what a model ships, and both run before anything else:
 *
 * - `--keep-meshes=a,b` names the meshes a DefaultMeshGroupOnly model keeps, by leaf name; every
 *   other mesh is dropped. That is a static prop whose mesh groups are alternatives drawn in the
 *   same place (the chicken feed bag's three bag variants): each mesh is its own scene root, and
 *   the unbake needs exactly one.
 * - `--pose-sequences=a,b` marks a pet model and names its pose sequences (it may name none). A
 *   pet's animations are pruned of the channels that say nothing -- see pruneAnimations.
 *
 * The meshopt pass is purely a file-size optimization: the codec is fully reversible, so geometry
 * decodes bit-identically and every mesh/node/skin/accessor, float precision, and the embedded
 * EXT_texture_webp stubs are untouched. Constraints:
 *
 * - Do NOT switch to gltf-transform's `meshopt()` wrapper: it also quantizes and prunes, which is
 *   lossy and removes skins/accessors.
 * - Reversibility is a correctness requirement, not a quality preference: consumers ray the
 *   weapon's own triangles to place keychain charms (a moved vertex moves a stored placement), and
 *   the model's cloth collider (MetadataExtractor.ExtractClothCollider) describes the same surface
 *   these triangles do.
 */

import { type Animation, type Document, NodeIO, type Property } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTMeshoptCompression } from "@gltf-transform/extensions";
import { unbakeSourceConversion } from "./item-generator-unbake.js";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";

const glbPath = process.argv[2];
if (glbPath === undefined) {
    console.error("usage: tsx item-generator-glb.ts <glb> [--keep-meshes=a,b] [--pose-sequences=a,b]");
    process.exit(1);
}

/** A flag's comma-separated values, or undefined when the flag is absent. `--flag=` is an empty list. */
function listFlag(name: string): string[] | undefined {
    const prefix = `--${name}=`;
    const value = process.argv.slice(3).find((argument) => argument.startsWith(prefix));
    return value?.slice(prefix.length).split(",").filter(Boolean);
}

const keepMeshes = listFlag("keep-meshes");
const poseSequences = listFlag("pose-sequences");

/** Whether nothing but the document root still refers to this property. */
function isOrphan(property: Property): boolean {
    return property.listParents().every((parent) => parent.propertyType === "Root");
}

/**
 * Drops every mesh not named, and what only those meshes used. VRF names a glTF mesh
 * "<model resource path>.<leaf>", and the leaf is the name the model's mesh list uses.
 *
 * Order matters: a mesh releases its materials and accessors, and a material its textures, so each
 * list is swept after the one that refers to it. The textures here are the 4x4 stubs
 * StubModelTextures left; the real ones ship through the material pipeline.
 */
function keepOnlyMeshes(document: Document, keep: string[]): void {
    const wanted = new Set(keep);
    const root = document.getRoot();
    const kept = new Set<string>();
    for (const node of root.listNodes()) {
        const mesh = node.getMesh();
        if (mesh === null) continue;
        const name = mesh.getName();
        const leaf = name.slice(name.lastIndexOf(".") + 1);
        if (wanted.has(leaf)) {
            kept.add(leaf);
            continue;
        }
        node.dispose();
    }
    const missing = keep.filter((name) => !kept.has(name));
    if (missing.length > 0) {
        throw new Error(`keep-meshes: no mesh named ${missing.join(", ")}`);
    }
    // A primitive outlives its mesh unless it is disposed too, and would keep its material and
    // accessors alive with it.
    for (const mesh of root.listMeshes()) {
        if (!isOrphan(mesh)) continue;
        for (const primitive of mesh.listPrimitives()) primitive.dispose();
        mesh.dispose();
    }
    for (const material of root.listMaterials()) if (isOrphan(material)) material.dispose();
    for (const texture of root.listTextures()) if (isOrphan(texture)) texture.dispose();
    for (const accessor of root.listAccessors()) if (isOrphan(accessor)) accessor.dispose();
}

await MeshoptEncoder.ready;

const IDENTITY: Record<string, number[]> = {
    translation: [0, 0, 0],
    rotation: [0, 0, 0, 1],
    scale: [1, 1, 1]
};

/**
 * How close to the reference a channel has to stay to count as saying nothing. It is not float
 * noise alone: a clip's keys come out of a quantized stream, and a pose sequence's translations go
 * through the unbake's divide, so a bone that does not move still lands within about 1e-5 of where
 * it started. 1e-4 is a hundredth of the tolerance the game itself uses to decide a pose delta is
 * the identity (0.01 on position and scale, 0.02 on rotation), and in the model's own units it is
 * 2.5 micrometres.
 */
const EPSILON = 1e-4;

/** Whether every key of a track is `value`. A rotation also matches its negation, the same rotation. */
function isConstant(output: Float32Array, value: number[], isRotation: boolean): boolean {
    const size = value.length;
    for (let at = 0; at < output.length; at += size) {
        let same = true;
        let negated = isRotation;
        for (let k = 0; k < size; k++) {
            if (Math.abs(output[at + k]! - value[k]!) > EPSILON) same = false;
            if (Math.abs(output[at + k]! + value[k]!) > EPSILON) negated = false;
        }
        if (!same && !negated) return false;
    }
    return true;
}

/**
 * Drops the channels of a pet's animations that say nothing. VRF writes translation, rotation and
 * scale for every bone of every animation -- 351 channels each on the chicken skeleton -- and most
 * of them only restate what a consumer already assumes.
 *
 * Which value "says nothing" depends on the kind of animation:
 *
 * - A POSE SEQUENCE is a single frame of deltas, so a channel that is the identity transform is a
 *   bone the sequence leaves alone. A consumer reads a missing channel as identity.
 * - A CLIP is an ordinary animation, and glTF leaves an untargeted node at its rest transform, so a
 *   channel that holds the node's rest value on every key plays back the same when it is gone.
 *
 * Neither changes anything a consumer can observe (see EPSILON). It runs after the unbake because
 * that is when a delta's root rotation, which VRF bakes the axis conversion into, is the identity
 * again.
 */
function pruneAnimations(document: Document, sequences: string[]): void {
    const deltas = new Set(sequences);
    const root = document.getRoot();
    const prune = (animation: Animation): void => {
        const isDelta = deltas.has(animation.getName());
        for (const channel of animation.listChannels()) {
            const node = channel.getTargetNode();
            const path = channel.getTargetPath();
            const sampler = channel.getSampler();
            const output = sampler?.getOutput()?.getArray();
            if (node === null || path === null || path === "weights" || !(output instanceof Float32Array)) {
                continue;
            }
            const rest =
                path === "translation"
                    ? node.getTranslation()
                    : path === "rotation"
                      ? node.getRotation()
                      : node.getScale();
            if (isConstant(output, isDelta ? IDENTITY[path]! : rest, path === "rotation")) {
                channel.dispose();
            }
        }
        // A sampler is owned by its animation whether or not a channel still reads it.
        const used = new Set(animation.listChannels().map((channel) => channel.getSampler()));
        for (const sampler of animation.listSamplers()) if (!used.has(sampler)) sampler.dispose();
    };
    root.listAnimations().forEach(prune);
    for (const accessor of root.listAccessors()) if (isOrphan(accessor)) accessor.dispose();
}

const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ "meshopt.encoder": MeshoptEncoder, "meshopt.decoder": MeshoptDecoder });

const document = await io.read(glbPath);
if (keepMeshes !== undefined) keepOnlyMeshes(document, keepMeshes);
unbakeSourceConversion(document);
if (poseSequences !== undefined) pruneAnimations(document, poseSequences);
document
    .createExtension(EXTMeshoptCompression)
    .setRequired(true)
    .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
await io.write(glbPath, document);
