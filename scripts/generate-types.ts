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
                image_inventory: string;
                image_unusual_item?: string;
                item_name?: string;
                item_rarity: string;
                loot_list_name?: string;
                /**
                 * The classname of the item.
                 */
                name: string;
                prefab: string;
                used_by_classes: Record<string, string>;
                tool?: {
                    type?: string;
                    use_string?: string;
                };
                tags?: {
                    ItemSet?: {
                        tag_value?: string;
                    };
                    StickerCapsule?: {
                        [tagKey: string]: string;
                    };
                };
            };
        }[];
        music_definitions: {
            [musicIndex: string]: {
                name: string;
                loc_name: string;
                image_inventory: string;
            };
        }[];
        paint_kits: {
            [paintKitKey: string]: {
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
                prefab: string;
                item_class: string;
                item_name: string;
                item_rarity: string;
                image_inventory: string;
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
export type PrefabsRecord = Record<string, PrefabProps>;
export type ItemProps = CS_ItemsGameTXT["items_game"]["items"][number][string];
export type ItemsRecord = Record<string, ItemProps>;
export type PaintKitsProps = {
    className: string;
    itemid: number;
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
