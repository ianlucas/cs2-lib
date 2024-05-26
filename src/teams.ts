/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EnumValues } from "./utils.js";

export const Cs2Team = {
    None: 0,
    T: 2,
    CT: 3
} as const;

export type Cs2TeamValues = EnumValues<typeof Cs2Team>;

export function CS2_toggleTeam(team: Cs2TeamValues): Cs2TeamValues {
    return team === Cs2Team.CT ? Cs2Team.T : Cs2Team.CT;
}
