/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Turns one agent's raw VRF export into the published .glb. Invoked per agent model by the C#
 * item-generator (AssetProcessor.FinalizeAgentModel), before item-generator-glb.ts adds meshopt.
 *
 * AN AGENT'S .GLB IS SELF-CONTAINED, which is the one way it differs from every other model this
 * repo publishes. A weapon ships 4x4 texture stubs and its real textures as separate
 * content-addressed WebP files, because a paint kit is composited at runtime and those textures have
 * to be swappable. An agent has no paint kit: its textures are fixed, so they are embedded here as
 * EXT_texture_webp and no agent material or texture is published separately at all. See
 * docs/patches.md.
 *
 * Four passes, in this order and for these reasons:
 *
 *   1. KEEP MESHES. Drops the first-person arm meshes, which no inventory viewer shows. The list is
 *      computed from the model's mesh group masks in C# (MetadataExtractor.ResolveMeshGroups), not
 *      guessed from names here.
 *   2. UNBAKE. Hands the Source-to-glTF conversion back to the root node, the same contract every
 *      other published model follows.
 *   3. POSE. Writes the agent's inventory pose into the joint nodes. It runs AFTER the unbake
 *      because the pose clip is authored in raw model space (inches, Z-up) -- with the unbake done
 *      first, its values drop in verbatim and there is exactly one place where inches meet metres,
 *      the root node. The inverse bind matrices are deliberately untouched: rebinding would freeze
 *      the pose into the skin, whereas moving only the joints leaves the model re-posable.
 *   4. TEXTURES. Replaces each image with the WebP the shared encoder produced
 *      (item-generator-webp.ts, tiers from CharacterTextureOptimization), and stubs the patch
 *      placeholder artwork to 4x4 -- the game always replaces `g_tPatchN` with the applied patch, so
 *      shipping Valve's teamstitch placeholder would be ~99 KB of bytes that never render. The
 *      BACKING beside it is real and stays real: it is the cloth the patch sits on. VRF never
 *      exports a backing (glTF has no slot for one), so the C# side decompiles each one a patch
 *      slot draws and this pass ADDS it, as an image no material references. The eye mask and
 *      iris of a head that draws eyeballs (F_EYEBALLS) are added the same way.
 */

import { Document, NodeIO, type Material, type Property, type Texture } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTTextureWebP } from "@gltf-transform/extensions";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { unbakeSourceConversion } from "./item-generator-unbake.js";

interface AgentGlbSpec {
    /** The .glb to rewrite in place. */
    glb: string;
    /** Leaf mesh names to keep, e.g. "thirdperson_body". */
    keepMeshes: string[];
    /** Bone name -> local transform, in raw model space. */
    pose: Record<string, { translation: [number, number, number]; rotation: [number, number, number, number] }>;
    /**
     * glTF image name (the `.vtex` stem) -> path of the encoded WebP to embed. A name the document
     * has no image for (a patch backing, an eye texture) is added as a new, unreferenced image.
     */
    textures: Record<string, string>;
    /** glTF image names to replace with a 4x4 placeholder instead of embedding. */
    stubTextures: string[];
}

/**
 * VRF names a glTF mesh "<model resource path>.vmdl_c.<leaf>", and the leaf is the name the model's
 * mesh group masks are expressed against.
 */
function leafName(name: string): string {
    const at = name.lastIndexOf(".");
    return at === -1 ? name : name.slice(at + 1);
}

/** Whether nothing but the document root still refers to this property. */
function isOrphan(property: Property): boolean {
    return property.listParents().every((parent) => parent.propertyType === "Root");
}

/** The `.vtex` stem a vmat binding names, which is what VRF names the matching image. */
function stemOf(resource: string): string {
    return resource.replace(/\\/g, "/").split("/").pop()!;
}

/**
 * The images a material binds, read from the vmat VRF preserved in its extras, by `.vtex` stem.
 *
 * This is NOT the same set as the textures the material references through glTF's PBR slots. A
 * csgo_character.vfx material binds ~11 textures and glTF has a slot for four of them (base colour,
 * normal, occlusion, metallic-roughness), so an image bound only through the vmat is a shader input
 * an agent viewer needs, and pruning on glTF references alone would delete it. VRF itself exports
 * none of those -- it writes only what a glTF slot points at -- so the ones a consumer needs (patch
 * backings, eye masks and irises) are added after pruning, in embedTextures.
 */
function boundTextureNames(material: Material): string[] {
    const extras = material.getExtras() as { vmat?: { TextureParams?: Record<string, string> } } | undefined;
    return Object.values(extras?.vmat?.TextureParams ?? {}).map(stemOf);
}

/**
 * Drops what the mesh cull left behind. gltf-transform keeps a disposed mesh's materials, textures
 * and accessors alive in the root lists, and an orphaned first-person glove normal map would
 * otherwise be embedded in step 4 for a mesh that is no longer there.
 *
 * A texture survives when a SURVIVING material binds it — by a PBR slot or anywhere in its vmat.
 * Order matters: materials release textures and primitives release accessors, so each list is swept
 * after the one that refers to it.
 */
function pruneOrphans(document: Document): void {
    const root = document.getRoot();
    for (const material of root.listMaterials()) if (isOrphan(material)) material.dispose();

    const bound = new Set(root.listMaterials().flatMap(boundTextureNames));
    for (const texture of root.listTextures()) {
        if (bound.has(texture.getName())) continue;
        if (isOrphan(texture)) texture.dispose();
    }

    for (const skin of root.listSkins()) if (isOrphan(skin)) skin.dispose();
    for (const accessor of root.listAccessors()) if (isOrphan(accessor)) accessor.dispose();
}

function keepOnlyMeshes(document: Document, keep: string[]): void {
    const wanted = new Set(keep);
    const root = document.getRoot();
    for (const node of root.listNodes()) {
        const mesh = node.getMesh();
        if (mesh === null) continue;
        if (wanted.has(leafName(mesh.getName()))) continue;
        node.dispose();
    }
    for (const mesh of root.listMeshes()) if (isOrphan(mesh)) mesh.dispose();
    pruneOrphans(document);
}

/**
 * Drops the animation the export carried in. The exporter has to run with animations enabled at all
 * — that is the only way VRF emits a skeleton — so it is asked for a single sentinel clip, and once
 * the pose is written into the joints that clip is noise. See AssetProcessor.FinalizeAgentModel.
 */
function dropAnimations(document: Document): void {
    for (const animation of document.getRoot().listAnimations()) animation.dispose();
    pruneOrphans(document);
}

function applyPose(document: Document, pose: AgentGlbSpec["pose"]): void {
    const root = document.getRoot();
    // Only joints are posed. A mesh node can legitimately share a bone's name, and moving one would
    // translate the whole mesh rather than the bone it is skinned to.
    const joints = new Set(root.listSkins().flatMap((skin) => skin.listJoints()));
    for (const node of joints) {
        const bone = pose[node.getName()];
        if (bone === undefined) continue;
        node.setTranslation(bone.translation);
        node.setRotation(bone.rotation);
    }
}

async function embedTextures(document: Document, spec: AgentGlbSpec): Promise<void> {
    const stub = new Set(spec.stubTextures);
    // A 4x4 opaque WebP, the same placeholder shape StubModelTextures writes for every other model.
    const stubBytes = new Uint8Array(
        await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 0, g: 0, b: 0 } } })
            .webp({ quality: 1 })
            .toBuffer()
    );

    document.createExtension(EXTTextureWebP).setRequired(true);

    const missing: string[] = [];
    for (const texture of document.getRoot().listTextures()) {
        const name = texture.getName();
        if (stub.has(name)) {
            setWebp(texture, stubBytes);
            continue;
        }
        const encoded = spec.textures[name];
        if (encoded === undefined) {
            missing.push(name);
            continue;
        }
        setWebp(texture, new Uint8Array(await readFile(encoded)));
    }

    // Images VRF never exported. Nothing references them, so they must be added AFTER the last
    // pruneOrphans; consumers find them by name.
    const present = new Set(
        document
            .getRoot()
            .listTextures()
            .map((texture) => texture.getName())
    );
    for (const [name, encoded] of Object.entries(spec.textures)) {
        if (present.has(name)) continue;
        setWebp(document.createTexture(name), new Uint8Array(await readFile(encoded)));
    }

    // Every surviving image must have been encoded. A miss would silently publish a raw PNG inside a
    // .glb that claims EXT_texture_webp, so it fails the build instead.
    if (missing.length > 0) {
        throw new Error(`agent-glb: no encoded WebP for embedded texture(s): ${missing.join(", ")}`);
    }
}

function setWebp(texture: Texture, bytes: Uint8Array): void {
    texture.setImage(bytes);
    texture.setMimeType("image/webp");
    texture.setURI("");
}

const specPath = process.argv[2];
if (specPath === undefined) {
    console.error("usage: tsx item-generator-agent-glb.ts <spec.json>");
    process.exit(1);
}

const spec: AgentGlbSpec = JSON.parse(await readFile(specPath, "utf8"));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const document = await io.read(spec.glb);

keepOnlyMeshes(document, spec.keepMeshes);
unbakeSourceConversion(document);
applyPose(document, spec.pose);
dropAnimations(document);
await embedTextures(document, spec);

await io.write(spec.glb, document);
