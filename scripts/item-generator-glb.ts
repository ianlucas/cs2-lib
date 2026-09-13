/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Finishes a single GLB model in place: hands the Source-to-glTF conversion back to the scene's
 * root node (see "Unbaking the Source-to-glTF conversion" below for why the published .glb
 * contract puts it there), then adds EXT_meshopt_compression. Invoked once per model by the C#
 * item-generator (AssetProcessor.OptimizeGlbsMeshopt) after textures are stubbed.
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

import { NodeIO, type Accessor, type Document, type Node } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTMeshoptCompression } from "@gltf-transform/extensions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";

// ---------------------------------------------------------------------------------------------
// Unbaking the Source-to-glTF conversion
//
// Moves the conversion back out of the geometry and onto the exported scene's root node, undoing
// what ValveResourceFormat bakes in.
//
// VRF bakes the conversion (Z-up inches to Y-up metres) into mesh POSITION/NORMAL/TANGENT, bone
// rest poses and animation tracks, and leaves the root node at identity, so the armature is
// identity-scaled and the bind matrices are clean inverses (GltfModelExporter.Conversion.cs:
// BakePositions / BakeDirections / BakeTangents / BakeConversion). World space is the same either
// way, which is why the bake is invisible to ordinary rendering.
//
// It is not invisible to anything reading OBJECT space, and this repo emits a model's metadata in
// raw model space on the explicit contract that the consumer's root node applies the conversion:
// MetadataExtractor's attachment anchors ("no axis-swap/scale"), ExtractClothCollider's distances
// in inches, and the keychainPosition ranges in items.ts. Consumers read object space directly too
// -- csgo_simple_liquid.vfx computes a charm's fill from rest-pose `position` against
// g_flLiquidCenterOffset, and mounts StatTrak/name-tag modules at inch-valued offsets under a bone.
// Baked, that metadata describes a space ~39x smaller and axis-permuted from the vertices it
// annotates.
//
// Unbaking keeps the generator on current VRF while leaving the published .glb contract as the
// consumer contract describes it. Every operation below is the arithmetic inverse of the named VRF
// function, and the conversion's rotation is an exact signed axis permutation (its quaternion
// components are all +/-0.5), so the only inexact step in the whole round trip is the single divide
// by 0.0254 that the root node immediately multiplies back.
// ---------------------------------------------------------------------------------------------

/** VRF's SourceToGltfScale: inches to metres. */
const SCALE = 0.0254;

/**
 * VRF's SourceToGltfRotation, Quaternion.CreateFromYawPitchRoll(0, -PI/2, -PI/2) as [x, y, z, w].
 * Its matrix is the exact permutation (x, y, z) -> (y, z, x).
 */
const ROTATION: [number, number, number, number] = [-0.5, -0.5, -0.5, 0.5];

/** Undoes that permutation in place: (x, y, z) -> (z, x, y). Exact, no rounding. */
function unrotate(v: number[], at = 0): void {
    const x = v[at]!;
    const y = v[at + 1]!;
    const z = v[at + 2]!;
    v[at] = z;
    v[at + 1] = x;
    v[at + 2] = y;
}

/** Undoes the scale in place. */
function unscale(v: number[], at = 0): void {
    v[at] = v[at]! / SCALE;
    v[at + 1] = v[at + 1]! / SCALE;
    v[at + 2] = v[at + 2]! / SCALE;
}

/**
 * Strips the conversion's rotation off a baked rotation.
 *
 * BakeConversion premultiplies a skeleton root's rest rotation by SourceToGltfRotation, so the
 * inverse is a premultiply by its conjugate. Every component of the conjugate is exactly 0.5.
 */
function unrotateQuaternion(q: number[]): [number, number, number, number] {
    const [x, y, z, w] = q as [number, number, number, number];
    return [0.5 * (w + x - y + z), 0.5 * (w + x + y - z), 0.5 * (w - x + y + z), 0.5 * (w - x - y - z)];
}

/** Reads a float accessor's backing array, refusing anything the in-place rewrite would corrupt. */
function floatArray(accessor: Accessor, what: string): Float32Array {
    const array = accessor.getArray();
    if (!(array instanceof Float32Array) || accessor.getNormalized()) {
        throw new Error(`unbake: expected a plain float32 ${what} accessor`);
    }
    return array;
}

/**
 * What an accessor holds, and so which inverse it needs.
 *
 * Accessors are shared: VRF emits one POSITION for a model's several primitives, and both a
 * world- and a view-model mesh can point at the same vertex data. Every rewrite below is in place,
 * so the pass has to resolve each accessor's role BEFORE touching anything and then visit it once
 * -- applying the inverse twice silently scales a model by 1/0.0254 again.
 */
type Role = "position" | "direction" | "tangent" | "matrix" | "translation" | "rootTranslation" | "rootRotation";

/** Element stride in floats, by role. */
const STRIDE: Record<Role, number> = {
    position: 3,
    direction: 3,
    tangent: 4,
    matrix: 16,
    translation: 3,
    rootTranslation: 3,
    rootRotation: 4
};

function unbakeAccessor(accessor: Accessor, role: Role): void {
    const array = floatArray(accessor, role);
    const stride = STRIDE[role];
    const values = array as unknown as number[];
    for (let i = 0; i < array.length; i += stride) {
        switch (role) {
            case "position":
                unrotate(values, i);
                unscale(values, i);
                break;
            case "direction":
            case "tangent":
                // Tangent's w is the handedness sign, which the rotation does not touch.
                unrotate(values, i);
                break;
            case "translation":
                unscale(values, i);
                break;
            case "rootTranslation":
                unrotate(values, i);
                unscale(values, i);
                break;
            case "rootRotation": {
                const unbaked = unrotateQuaternion(array.subarray(i, i + 4) as unknown as number[]);
                for (let k = 0; k < 4; k++) array[i + k] = unbaked[k]!;
                break;
            }
            case "matrix":
                unbakeInverseBindMatrix(array, i);
                break;
        }
    }
}

/**
 * Undoes BakeConversion on a node's rest transform. `isRoot` marks a skeleton root, the only place
 * VRF also folds in the axis rotation -- its descendants inherit that through the hierarchy, so they
 * carry the scale alone. Scale is untouched either way: a bone has no rest scale.
 */
function unbakeNode(node: Node, isRoot: boolean): void {
    const translation = [...node.getTranslation()];
    if (isRoot) unrotate(translation);
    unscale(translation);
    node.setTranslation(translation as [number, number, number]);
    if (isRoot) node.setRotation(unrotateQuaternion(node.getRotation()));
}

/**
 * Undoes the conversion baked into one inverse bind matrix.
 *
 * A baked bone's world matrix is `T * B * S^-1` (T the conversion, B the source-space bind, S its
 * uniform scale alone), so the stored inverse is `S * B^-1 * T^-1`. Inverting that back to `B^-1`
 * leaves the linear part right-multiplied by the conversion's rotation, which for glTF's
 * column-major storage is just a cycle of the three basis columns, and the translation divided by
 * the scale.
 */
function unbakeInverseBindMatrix(array: Float32Array, at: number): void {
    const element = array.slice(at, at + 16);
    for (let row = 0; row < 4; row++) {
        array[at + row] = element[8 + row]!;
        array[at + 4 + row] = element[row]!;
        array[at + 8 + row] = element[4 + row]!;
    }
    unscale(array as unknown as number[], at + 12);
}

/**
 * Hands the Source-to-glTF conversion back to the scene's root node.
 *
 * Returns false when the document already carries it, so the pass is idempotent and safe to re-run
 * over an output tree.
 */
function unbakeSourceConversion(document: Document): boolean {
    const root = document.getRoot();
    const scenes = root.listScenes();

    // VRF parents the skeleton (or, for an unskinned model, the mesh) under the node that carries
    // the conversion, and leaves each skinned mesh as an identity sibling of it -- glTF ignores a
    // skinned mesh node's own transform, so those are already right and only their vertex data
    // needs undoing. Exactly one scene child is therefore unskinned, and that one is the conversion
    // node.
    const candidates = scenes.flatMap((scene) => scene.listChildren().filter((child) => child.getSkin() === null));
    if (candidates.length !== 1) {
        throw new Error(`unbake: expected exactly one unskinned scene root, found ${candidates.length}`);
    }
    const conversionNode = candidates[0]!;
    if (Math.abs(conversionNode.getScale()[0]! - SCALE) < 1e-9) return false;

    const roles = new Map<Accessor, Role>();
    const claim = (accessor: Accessor | null | undefined, role: Role): void => {
        if (accessor == null) return;
        const existing = roles.get(accessor);
        if (existing !== undefined && existing !== role) {
            throw new Error(`unbake: an accessor is used as both ${existing} and ${role}`);
        }
        roles.set(accessor, role);
    };

    for (const mesh of root.listMeshes()) {
        for (const primitive of mesh.listPrimitives()) {
            for (const source of [primitive, ...primitive.listTargets()]) {
                claim(source.getAttribute("POSITION"), "position");
                claim(source.getAttribute("NORMAL"), "direction");
                claim(source.getAttribute("TANGENT"), "tangent");
            }
        }
    }

    for (const skin of root.listSkins()) {
        claim(skin.getInverseBindMatrices(), "matrix");
    }

    // The conversion node's children are the skeleton roots -- the only place VRF folds in the axis
    // rotation. Everything below them inherits it through the hierarchy and carries the scale alone.
    const skeletonRoots = new Set(conversionNode.listChildren());

    // Animation tracks are baked by the same rule, against the same notion of a root.
    for (const animation of root.listAnimations()) {
        for (const channel of animation.listChannels()) {
            const target = channel.getTargetNode();
            const output = channel.getSampler()?.getOutput();
            if (target === null || output == null) continue;
            const isRoot = skeletonRoots.has(target);
            if (channel.getTargetPath() === "translation") {
                claim(output, isRoot ? "rootTranslation" : "translation");
            } else if (channel.getTargetPath() === "rotation" && isRoot) {
                claim(output, "rootRotation");
            }
        }
    }

    for (const [accessor, role] of roles) unbakeAccessor(accessor, role);

    const walk = (node: Node): void => {
        unbakeNode(node, skeletonRoots.has(node));
        node.listChildren().forEach(walk);
    };
    conversionNode.listChildren().forEach(walk);

    conversionNode.setTranslation([0, 0, 0]);
    conversionNode.setRotation(ROTATION);
    conversionNode.setScale([SCALE, SCALE, SCALE]);
    return true;
}

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
