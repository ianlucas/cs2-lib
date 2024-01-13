# cslib

> A TypeScript library for manipulating Counter-Strike-related data.

## Install

```sh
npm install @ianlucas/cslib
```

## Usage

For any module that deals with economy items, you need to setup the available items (`CS_ITEMS` contains all items from the game):

```typescript
import { CS_Economy, CS_ITEMS } from "cslib";

CS_Economy.initialize(CS_ITEMS);

const item = CS_Economy.getById(307);

item.name;
//=> "AWP | Dragon Lore"
```

## Feature Overview

-   **Economy items:** Weapon/Knife/Glove Skins, Weapon Stickers, Agents, Agent Patches, Graffiti, Pins, Music Kits, Cases, Case Keys, and Tools provided in `CS_ITEMS` and `assets/data/items.json`.
-   **Economy:** Economy and Inventory classes.
-   **Misc:** Active Pool Maps, Teams, and Veto utilities.
