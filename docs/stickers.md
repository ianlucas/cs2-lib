# Stickers

Stickers are the most intricate part of the inventory model, because two different indices are in play at once.

## Slot vs. schema

```typescript
stickers?: Record<
    string,
    { id: number; rotation?: number; schema?: number; wear?: number; x?: number; y?: number }
>;
```

- The **record key** is the slot: the 0-based position in the stack, i.e. draw order. Keys are always contiguous, `0` to `n-1`, with at most `CS2_MAX_STICKERS` (5) entries.
- **`schema`** is the physical anchor: an index into the model's `StickerMarkup`, valid in `[0, item.getStickerSchemaCount())`. It decides _where on the weapon_ the sticker sits.

These are independent, and the stack can outnumber the anchors. The AK-47's HD body, for example, publishes 4 anchors while the stack always holds up to 5 — so **two stickers may legitimately share an anchor**. Conversely, reordering the stack does not move any sticker on the model; it only changes draw order.

`getStickerSchemaCount()` reads `stickerSchemaCount` (or `legacyStickerSchemaCount` when `isLegacyModel` is set) off `parent ?? this`, falling back to `CS2_MAX_STICKERS` when the model publishes no count.

## Materialization

Two static helpers on `CS2InventoryItem` convert between the stored record and an ordered array. Everything that mutates the stack goes through the array form.

`stickersToArray(stickers, schemaCount?)`:

1. sorts entries by their numeric key,
2. caps the result at `CS2_MAX_STICKERS`,
3. materializes each missing `schema` from the entry's key,
4. and, **when `schemaCount` is supplied**, repairs any schema that is not an integer in `[0, schemaCount)` by assigning the next free anchor.

Step 3 is what makes legacy data work: inventories written before `schema` existed keyed their stickers by the in-game markup slot, so the key _is_ the anchor. Step 4 is why `schemaCount` is passed on the heal and construction paths but not on the editing paths — materializing a schema from a key can produce an out-of-range anchor (key 4 on a 4-anchor model), and without the repair the materializer would emit data its own validator rejects.

`stickersFromArray(array)` serializes back: contiguous 0-based keys, `schema` always written (defaulting to the index), and default values dropped — `wear`, `rotation`, `x` and `y` are omitted when falsy, so a rotation of exactly `0` is not stored.

The round trip is what reflows the stack. Removing the sticker at index 1 of three leaves keys `{0, 1}`, and the survivor from index 2 keeps its `schema` while its key drops to 1.

## Applying and editing

| Method                                            | Behavior                                          |
| ------------------------------------------------- | ------------------------------------------------- |
| `applyItemSticker(targetUid, stickerUid, attrs?)` | appends to the stack, consuming the sticker item  |
| `addWithSticker(stickerUid, id, attrs?)`          | creates a new item carrying the sticker in slot 0 |
| `editItemSticker(targetUid, index, patch)`        | merges a patch into one sticker                   |
| `removeItemSticker(targetUid, index)`             | removes and reflows                               |
| `moveItemSticker(targetUid, from, to)`            | reorders draw order; each `schema` rides along    |
| `scrapeItemSticker(targetUid, index, wear?)`      | scrapes — see below                               |

`attrs` accepts `schema`, `x`, `y`, `rotation` and `wear`. When `schema` is omitted on apply, `getNextStickerSchema` picks the first unused anchor in `[0, schemaCount)`, falling back to `0` once every anchor is taken.

All of these validate the whole resulting stack against the target _before_ mutating anything, so an invalid attribute throws without consuming the sticker item and without disturbing the existing stack.

## Offsets

`x` and `y` are **deltas from the anchor's default position** in the markup, not absolute coordinates. (Keychains work the other way round — see [Keychains](keychains.md).)

They sit on the `CS2_STICKER_OFFSET_FACTOR` grid (`0.0001`, four decimals) and must fall inside the model's published envelope, read via `getMinimumStickerOffsetX()` / `getMaximumStickerOffsetX()` / the `Y` pair. Either bound can be `undefined`, meaning unbounded on that side; validation skips a bound it does not have.

The envelope is per-model and per-mesh. The legacy AWP, for instance, allows X `[-0.4323, 0.4206]` and Y `[-0.0921, 0.1415]` — small numbers, because they are deltas.

`healStickerOffset(value, min, max)` normalizes a stored offset: non-finite values are dropped, then the value is truncated onto the grid, then clamped into `[min, max]`. Truncation comes first so that clamping cannot reintroduce precision the grid does not allow.

## Rotation

`rotation` is in degrees on the `CS2_STICKER_ROTATION_STEP` half-degree grid (`…, -0.5, 0, 0.5, 1, …`), within `[CS2_MIN_STICKER_ROTATION, CS2_MAX_STICKER_ROTATION]` = `[-180, 180]`. `undefined` means unrotated and is always valid.

- `validateStickerRotation(rotation?)` — `true` when it is on the grid and in range.
- `snapStickerRotation(rotation)` — rounds to the nearest half degree (`2.4` and `2.7` both become `2.5`). Half-degree values are exactly representable in binary, so this introduces no float noise. It does **not** range-wrap.

Healing a stored rotation runs in a specific order, and the order is load-bearing:

1. **snap** to the half-degree grid, so `2.7` heals to `2.5` instead of being thrown away;
2. **wrap** anything still above 180 by subtracting 360. Inventories written against the old 0–359 convention become the equivalent negative angle (`270` → `-90`), preserving the visual rotation;
3. **validate**, and drop the value if it still does not fit.

Snapping before wrapping is what lets an off-grid legacy angle like `270.7` heal all the way to `-89.5` rather than being discarded.

Step 3 catches genuinely unrecoverable input — `NaN`, `Infinity`, `1000`, `-300` — by clearing just that sticker's rotation. The sticker itself, and its neighbors, survive.

## Wear and scraping

Sticker wear is a float in `[CS2_MIN_STICKER_WEAR, CS2_MAX_STICKER_WEAR]` = `[0, 1]` on the `CS2_STICKER_WEAR_FACTOR` grid (`0.01`). Unset means pristine; `getStickerWear(slot)` returns `0` for a sticker with no stored wear.

`scrapeItemSticker` has two modes, and they differ in one comparison:

- **Default** (`wear` omitted) is a scrape click: wear steps up by `CS2_STICKER_SCRAPE_FACTOR` (`0.1`), so a pristine sticker takes about ten clicks. Removal happens when the next step goes **strictly past** 1 — the 10th click leaves wear resting at exactly 1 with the sticker still on the weapon, and the 11th clears it. This mirrors CS2 and CS:GO.
- **Explicit** (`wear` supplied) is a slider: the value must be finite and strictly greater than the current wear, and is rounded onto the wear grid. Removal happens when it **reaches** 1.

Both use `roundToFactor` rather than truncation, so accumulated float noise (`0.06 + 0.01 = 0.06999…`) lands back on the grid.

Removing the last sticker sets `stickers` to `undefined` rather than leaving an empty map.

## Reading a stack

- `getStickersCount()` — number of stickers.
- `allStickers()` — `[index, sticker]` pairs.
- `someStickers()` — identical to `allStickers()`. The stack is contiguous, so there are no gaps to filter; it exists for symmetry with `somePatches()`/`someKeychains()`, which do have fixed slots.
