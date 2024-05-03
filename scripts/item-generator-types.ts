/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ian Lucas. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface CS_ItemsGameTXT {
    items_game: {
        alternate_icons2: {
            weapon_icons: {
                [weaponIconKey: string]: {
                    icon_path: string;
                };
            };
        };
        item_sets: {
            [itemSetKey: string]: {
                name?: string;
                set_description?: string;
                items: {
                    [itemId: string]: string;
                };
            };
        }[];
        client_loot_lists: {
            [clientLootListKey: string]: {
                [itemOrLootListKey: string]: string;
            };
        }[];
        colors: {
            [colorKey: string]: {
                hex_color: string;
            };
        };
        graffiti_tints: {
            [graffitiTintKey: string]: {
                id: string;
                hex_color: string;
            };
        };
        items: {
            [itemIndex: string]: {
                associated_items?: {
                    [itemIndex: string]: string;
                };
                attributes?: {
                    ["set supply crate series"]?: {
                        attribute_class?: string;
                        value?: string;
                    };
                    ["pedestal display model"]?: string;
                };
                baseitem: string;
                flexible_loadout_slot?: string;
                image_inventory?: string;
                image_unusual_item?: string;
                item_description?: string;
                item_name?: string;
                item_rarity: string;
                loot_list_name?: string;
                model_player?: string;
                name: string;
                prefab: string;
                tags?: {
                    ItemSet?: {
                        tag_value?: string;
                    };
                    StickerCapsule?: {
                        [tagKey: string]: string;
                    };
                };
                tool?: {
                    type?: string;
                    use_string?: string;
                };
                used_by_classes?: Record<string, string>;
                vo_prefix?: string;
            };
        }[];
        music_definitions: {
            [musicIndex: string]: {
                image_inventory: string;
                loc_description: string;
                loc_name: string;
                name: string;
            };
        }[];
        paint_kits: {
            [paintKitKey: string]: {
                description_string?: string;
                description_tag?: string;
                name: string;
                wear_remap_max?: string;
                wear_remap_min?: string;
            };
        }[];
        paint_kits_rarity: {
            [paintKitKey: string]: string;
        }[];
        prefabs: {
            [prefabKey: string]: {
                image_inventory?: string;
                item_class: string;
                item_description?: string;
                item_name: string;
                item_rarity: string;
                prefab: string;
                used_by_classes: Record<string, string>;
                visuals: {
                    weapon_type: string;
                };
            };
        }[];
        rarities: {
            [rarityKey: string]: {
                color: string;
            };
        };
        revolving_loot_lists: {
            [revolvingLootListKey: string]: string;
        }[];
        sticker_kits: {
            [stickerIndex: string]: {
                description_string?: string;
                item_name: string;
                item_rarity: string;
                name: string;
                patch_material?: string;
                sticker_material: string;
                tournament_event_id: string;
            };
        }[];
    };
}

export interface CS_CsgoLanguageTXT {
    lang: {
        Tokens: { [key: string]: string };
    };
}

export type LanguagesRecord = Record<string, Record<string, string>> & {
    english: Record<string, string>;
};

export type PrefabProps = CS_ItemsGameTXT["items_game"]["prefabs"][number][string];
export type PrefabsRecord = Record<string, PrefabProps | undefined>;
export type ItemProps = CS_ItemsGameTXT["items_game"]["items"][number][string];
export type ItemsRecord = Record<string, ItemProps>;
export type PaintKitsProps = {
    className: string;
    customDesc: string;
    customDescToken: string;
    index: number;
    name: string;
    nameToken: string;
    rarityColorHex: string;
    wearmax: number;
    wearmin: number;
};
export type SafeRaritiesRecord = Record<string, string | undefined>;
export type UnsafeRaritiesRecord = Record<string, string>;
export type StickerKitsProps = CS_ItemsGameTXT["items_game"]["sticker_kits"][number][string];
export type StickerKitsRecord = Record<string, StickerKitsProps>;
export type ClientLootListItems = CS_ItemsGameTXT["items_game"]["client_loot_lists"][number][string];
export type ClientLootListRecord = Record<string, ClientLootListItems>;
export type RevolvingLootListRecord = Record<string, string>;
export type ItemSetProps = CS_ItemsGameTXT["items_game"]["item_sets"][number][string];
export type ItemSetsRecord = Record<string, ItemSetProps>;
