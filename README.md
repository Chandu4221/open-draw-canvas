# OpenDraw Canvas SDK (`@open-draw/canvas`)

A framework-free, batteries-included visual canvas and drawing SDK with zero runtime dependencies.

## Features

- **Batteries-Included**: Built-in vector shapes (rectangles, ellipses, lines, pen paths, text), transformation handles, and snapping.
- **Single Source of Truth**: Strict document-model architecture with typed transactions and invertible commands (undo/redo).
- **Zero Runtime Dependencies**: The published package bundles its internal primitives and carries `dependencies: {}`.
- **Pure SVG Rendering**: Deterministic SVG rendering, hand-drawn/crayon renderers, and SVG export.
- **Spatial Indexing & Hit Testing**: Built-in spatial tree for high-performance point and box picking.
- **Framework Agnostic**: Pure TypeScript controller and editor; mounts directly to any DOM container (React, Vue, Svelte, or vanilla JS).

## Installation

```bash
npm install @open-draw/canvas
```

## Quick Start

```ts
import { createEditor, createDocument, TOOLS } from "@open-draw/canvas";

const container = document.getElementById("canvas-container")!;
const editor = createEditor(container, {
  document: createDocument(),
  tool: TOOLS.select,
});
```

## Development & Verification

This repository is organized as a multi-package monorepo managed with `pnpm` and `turbo`.

```bash
pnpm install
pnpm format:check
pnpm lint
pnpm lint:deps
pnpm lint:naming
pnpm typecheck
pnpm test
pnpm build
```

Or run all verification gates at once:

```bash
pnpm check
```

## License

MIT
