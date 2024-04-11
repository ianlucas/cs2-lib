# cs2-lib

> A TypeScript library for manipulating Counter-Strike 2 data

This library contains items and data from Counter-Strike 2, including utility functions and classes for manipulating them using TypeScript.

## Install

```sh
npm install @ianlucas/cs2-lib
```

## Usage

For any module that deals with economy items, you need to setup the available items (`CS_ITEMS` contains all items from the game):

```typescript
import { CS_Economy, CS_ITEMS } from "@ianlucas/cs2-lib";

CS_Economy.use(CS_ITEMS);

const item = CS_Economy.getById(307);

item.name;
//=> "AWP | Dragon Lore"
```
