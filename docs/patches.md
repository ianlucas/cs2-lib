# Patches

```typescript
patches?: Record<string, number>;
```

A patch goes on an agent, and nothing else. `hasPatches()` is `CS2_PATCHABLE_ITEMS.includes(type)`, which is agents only - and every agent in the catalog is patchable, because `ParseAgents` admits only `prefab customplayertradable` items and that prefab is where the schema sets `can_patch 1`.

The record key is the **slot**, `0` to `CS2_MAX_PATCHES - 1`, and the value is the patch item's id. Unlike stickers there is no second index: a patch has no `schema`, no wear, no rotation and no offset. The slot _is_ the anchor.

## Three slots

`CS2_MAX_PATCHES` is **3**, and that comes from the game rather than from symmetry with `CS2_MAX_STICKERS`:

- `items_game.txt`'s `game_info.max_num_patches` is `3`.
- `csgo_character.vfx` declares exactly three slots - `g_tPatch0`, `g_tPatch1`, `g_tPatch2`.
- Every patchable agent model publishes exactly three entries in `patch_camera_preset_list`.

The constant was 5 for a while, which meant the library accepted inventory states the game cannot represent. Tightening it needs no migration, because `repairInventoryItem` already runs a repair over the stack - but that repair is not the one stickers get.

## Applying and removing

```typescript
inventory.applyItemPatch(targetUid, patchUid, slot);
inventory.removeItemPatch(targetUid, slot);
```

`applyItemPatch` asserts the slot is in range and that it is empty, then consumes the patch item. `removeItemPatch` asserts the slot is occupied, and clears `patches` entirely once the last one goes. Neither reflows: unlike stickers there is no draw order to keep contiguous, so a stack of `{ 0, 2 }` is a perfectly ordinary agent with an empty chest slot.
