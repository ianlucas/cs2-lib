# Keychains

```typescript
keychains?: Record<string, { id: number; seed?: number; x?: number; y?: number; z?: number }>;
```

`CS2_MAX_KEYCHAINS` is 1, so the record has exactly one valid key: `0`. It is still a record rather than a single field because the game data leaves room for more, and because it keeps the shape symmetric with `stickers` and `patches`.

Only weapons can hold a keychain (`hasKeychains()`: keychainable types minus the C4).

## Setting one

There is no dedicated apply/remove pair. A keychain is set through `add`, `edit`, or:

```typescript
inventory.addWithKeychain(keychainUid, AK47_ID, { seed: 1234, x: 40, y: 1.3, z: 11 });
```

which consumes the keychain item and creates the new weapon carrying it in slot 0. Everything is validated against the new item before any mutation, so an invalid attribute throws without consuming the keychain.

## Position

`x`, `y` and `z` are **absolute coordinates in the model's markup space** — not deltas from a default position, which is how sticker offsets work. That is why the numbers are large: the legacy AWP's envelope is X `[-10.13, 41.29]`, Y `[-0.02, 1.37]`, Z `[2.64, 11.76]`, where a sticker offset on the same weapon lives inside ±0.5.

Bounds come from `getMinimumKeychainOffsetX()` / `getMaximumKeychainOffsetX()` and the `Y` and `Z` pairs, resolved off `parent ?? this` with the `legacy*` fields preferred for a legacy item (see [legacy meshes](economy.md#legacy-meshes)). Any bound may be `undefined`, meaning unbounded on that side.

Values must be finite and sit on the `CS2_KEYCHAIN_OFFSET_FACTOR` grid (`0.0001`, four decimals). Validation checks finiteness explicitly, so `NaN` on any axis — `z` included — is rejected rather than silently accepted.

`healKeychainOffset(value, min, max)` normalizes a stored coordinate: non-finite values are dropped, the value is truncated onto the grid, then clamped into `[min, max]`. Raw coordinates read out of the game carry more precision than the grid allows, so truncating (rather than rejecting) is deliberate — `0.123456789` heals to `0.1234`.

## Seed

A keychain's `seed` is an integer in `[CS2_MIN_KEYCHAIN_SEED, CS2_MAX_KEYCHAIN_SEED]` = `[1, 100000]`. It drives the dangle physics pose, not a paint pattern, which is why the range is so much wider than the `[1, 1000]` used by weapon and glove seeds.

The range is selected per item by `getMinimumSeed()`/`getMaximumSeed()`, keyed on `isKeychain()`. A consequence worth knowing: a keychain-sized seed on a weapon is rejected, and it is a mistake that was easy to make before those accessors existed.

Two different seeds are in play and they are stored in different places:

- the seed of a keychain _item sitting loose in the inventory_ is the item's own `seed` field,
- the seed of a keychain _attached to a weapon_ is the `seed` inside that weapon's `keychains[0]`.

`getKeychainSeed(slot)` reads the attached one and returns `CS2_MIN_KEYCHAIN_SEED` when it is unset.

## Reading

- `allKeychains()` — every slot, including empty ones, as `[slot, keychain | undefined]`. Use it to render a fixed grid.
- `someKeychains()` — only the filled slots.
- `getKeychainsCount()` — number attached.

## Models and materials

Keychains carry their own `playerModel` and `paintMaterial` when they have one, and otherwise inherit from `parent`. The sticker display case is the case that motivates this: the "slab" item holds the shared model and material, and each per-sticker display-case keychain carries neither, resolving both through `baseId`. `getModelData()` derives the `.json` path from whichever `.glb` won. See [Base and skin inheritance](economy.md#base-and-skin-inheritance).
