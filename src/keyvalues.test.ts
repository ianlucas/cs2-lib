/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CS_parseValveKeyValue } from "./keyvalues";

test("key value pair", () => {
    expect(CS_parseValveKeyValue(`"hello" "world!"`)).toStrictEqual({
        hello: "world!"
    });
});

test("nested key value pairs", () => {
    expect(CS_parseValveKeyValue(`"parent" { "key" "value" }`)).toStrictEqual({
        parent: { key: "value" }
    });
});

test("deeply nested key value pairs", () => {
    expect(CS_parseValveKeyValue(`"parent" { "innerParent" { "key" "value" } } "other" "pair"`)).toStrictEqual({
        parent: {
            innerParent: {
                key: "value"
            }
        },
        other: "pair"
    });
});

test("comments", () => {
    expect(CS_parseValveKeyValue('"hello" "world" // some comment here!')).toStrictEqual({
        hello: "world"
    });
});

test("multi-line comments", () => {
    expect(
        CS_parseValveKeyValue('"key1" "value1" // there is some comment.\n// another comment here.\n"key2" "value2"')
    ).toStrictEqual({
        key1: "value1",
        key2: "value2"
    });
});

test("empty braces value", () => {
    expect(CS_parseValveKeyValue('"key1" { }')).toStrictEqual({
        key1: {
            "": ""
        }
    });
});

test("read as object", () => {
    expect(
        CS_parseValveKeyValue(
            '"key1" "value1" "key2" { "key3" "value3" "key4" "value4" "key5" { "key6" "value6" } } "key7" "value7"'
        )
    ).toStrictEqual({
        key1: "value1",
        key2: {
            key3: "value3",
            key4: "value4",
            key5: {
                key6: "value6"
            }
        },
        key7: "value7"
    });
});

test("read as object handles duplicate keys", () => {
    expect(
        CS_parseValveKeyValue(
            '"key1" "value1" "key1" "value1" "key2" { "key3" "value3" "key3" { "key4" "value4" } "key3" { "key5" "value5" "key6" "value6" } }'
        )
    ).toStrictEqual({
        key1: ["value1", "value1"],
        key2: {
            key3: ["value3", { key4: "value4" }, { key5: "value5", key6: "value6" }]
        }
    });
});

test("handles string escaping", () => {
    expect(CS_parseValveKeyValue('"message" "click on \\"confirm to proceed\\""')).toStrictEqual({
        message: 'click on "confirm to proceed"'
    });
});

test("handles string escaping", () => {
    expect(
        CS_parseValveKeyValue(
            '"Cstrike_TitlesTXT_Alias_Not_Avail"  "\\"%s1\\"\\nnão está disponível para compra pela sua equipe."'
        )
    ).toStrictEqual({
        Cstrike_TitlesTXT_Alias_Not_Avail: '"%s1"\nnão está disponível para compra pela sua equipe.'
    });
});

test("ignore platform token", () => {
    expect(CS_parseValveKeyValue('"key1" "value1" [!$X360] "key2" "value2" [$X360||$OSX]')).toStrictEqual({
        key1: "value1",
        key2: "value2"
    });
});
