/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Writes a pose into a model's joint nodes, so the published .glb stands in it with no clip.
 *
 * Shared by the two finishing passes: item-generator-agent-glb.ts (an agent's inventory pose, see
 * InventoryPose) and item-generator-glb.ts (a pet's idle's first frame, see
 * PetModelData.GetPoseClip). Both run it AFTER unbakeSourceConversion: a pose is authored in raw
 * model space (inches, Z-up), and with the unbake done first its values drop in verbatim.
 *
 * The inverse bind matrices are deliberately untouched: rebinding would freeze the pose into the
 * skin, whereas moving only the joints leaves the model re-posable.
 */

import type { Document } from "@gltf-transform/core";

/** Bone name -> local transform, in raw model space. */
export type Pose = Record<
    string,
    { translation: [number, number, number]; rotation: [number, number, number, number] }
>;

/**
 * Moves every joint the pose names to its transform; a joint it doesn't name keeps its rest
 * transform. Bones are matched BY NAME: a pose is authored against a shared skeleton, which a model
 * need not match bone for bone.
 *
 * @returns How many joints were posed.
 */
export function applyPose(document: Document, pose: Pose): number {
    const root = document.getRoot();
    // Only joints are posed. A mesh node can legitimately share a bone's name, and moving one would
    // translate the whole mesh rather than the bone it is skinned to.
    const joints = new Set(root.listSkins().flatMap((skin) => skin.listJoints()));
    let posed = 0;
    for (const node of joints) {
        const bone = pose[node.getName()];
        if (bone === undefined) continue;
        node.setTranslation(bone.translation);
        node.setRotation(bone.rotation);
        posed++;
    }
    return posed;
}
