/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CS_safeValidateNametag } from "./economy";

test("nametag validation", () => {
    expect(CS_safeValidateNametag(" fail")).toBeFalsy();
    expect(CS_safeValidateNametag("小島 秀夫")).toBeTruthy();
    expect(CS_safeValidateNametag("孔子")).toBeTruthy();
    expect(CS_safeValidateNametag("bo$$u")).toBeTruthy();
    expect(CS_safeValidateNametag("toolongnametagtoolongnametag")).toBeFalsy();
});
