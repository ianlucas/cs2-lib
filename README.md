# cs2-lib

> A TypeScript library for manipulating Counter-Strike 2 data

This library contains items and data from Counter-Strike 2, including utility functions and classes for interacting with them using TypeScript.

## Install

```sh
npm install @ianlucas/cs2-lib
```

## Usage

```typescript
import { CS2Economy, CS2_ITEMS } from "@ianlucas/cs2-lib";
import { english } from "@ianlucas/cs2-lib/dist/translations";

CS2Economy.use({
    items: CS2_ITEMS,
    language: english
});

const item = CS2Economy.getById(307);

item.name;
//=> "AWP | Dragon Lore"
```
