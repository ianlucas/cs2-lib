# cslib

This is a TypeScript library for Counter-Strike-related tasks, primarily focused on handling economy items and miscellaneous elements like maps. It also provides utility classes like `CS_Veto` and `CS_Loadout`, which are beneficial for developing matchmaking systems or advanced interfaces.

## Getting Started

If you plan to use `CS_Economy` and/or `CS_Loadout`, you need to set up the items to be used. Place the following code snippet at the beginning of your project:

```typescript
import { CS_Economy, CS_ITEMS } from "cslib";
CS_Economy.setItems(CS_ITEMS);
```

Refer to the generated documentation in `./docs` directory.

## Feature Overview

-   [x] Economy Items - Weapon Skins
-   [x] Economy Items - Weapon Stickers
-   [x] Economy Items - Knives
-   [x] Economy Items - Gloves
-   [x] Economy Items - Music Kits
-   [ ] Economy Items - Grafitti
-   [x] Economy Items - Agents
-   [x] Economy Items - Agent Patches
-   [x] Economy Items - Pins
-   [x] Misc - Teams
-   [x] Misc - Active Pool Maps
