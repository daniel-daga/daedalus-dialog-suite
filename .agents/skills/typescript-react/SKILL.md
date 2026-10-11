---
name: typescript-react
description: TypeScript, React, Zustand, MUI, and Reactflow patterns for daedalus-dialog-editor
triggers:
  - "src/renderer/**"
  - "*.tsx"
  - "*.ts"
  - "vite.config.ts"
  - "tsconfig.json"
---

# TypeScript + React – daedalus-dialog-editor

## Stack

- TypeScript + React (renderer process)
- Zustand for state management
- MUI (Material UI) for UI components
- Reactflow for the node/quest graph editor
- Vite for bundling (`vite.config.ts`)
- `tsconfig.json` (renderer) + `tsconfig.main.json` (main process)

## Project Layout

```
src/
  main/           # Electron main process (Node.js)
    main.ts
    preload.ts
    services/
  renderer/       # React app
    components/
    stores/       # Zustand stores
    utils/
      mockAPI.ts  # Mock window.editorAPI for tests
```

## Zustand Store Patterns

```ts
import { create } from 'zustand';

interface MyStore {
  value: string;
  setValue: (v: string) => void;
}

export const useMyStore = create<MyStore>((set) => ({
  value: '',
  setValue: (v) => set({ value: v }),
}));
```

- **Do not pass the full `semanticModel` to deeply memoized components** — it is large and recreated frequently. Prefer stable sub-properties.
- Use granular selectors to avoid unnecessary re-renders:

```ts
// Prefer
const questName = useEditorStore((s) => s.activeQuest?.name);

// Avoid
const { activeQuest } = useEditorStore();
```

## React.memo and Performance

- Use `React.memo` with custom comparators for components in hot paths (e.g., dialog tree nodes).
- Prefer stable sub-property comparisons over full object equality.
- Performance-sensitive tests are in `tests/**/*.perf.test.tsx` — keep them green.

```ts
export const DialogTreeItem = React.memo(
  ({ questId, label }: Props) => { ... },
  (prev, next) => prev.questId === next.questId && prev.label === next.label
);
```

## MUI Usage

- Use MUI theme tokens; avoid hardcoded colors.
- Typography scale is tested in `tests/theme.typographyScale.test.ts` — don't introduce raw `fontSize` values outside the theme scale.

## Reactflow (Node Editor)

- Entry point: `src/renderer/components/` (node editor components)
- Dev playground: `npm run dev:node-editor` → `http://localhost:5173/node-editor.html`
- Key testid: `data-testid="node-editor-quest-select"`
- After node editor changes, do a quick smoke pass: open `/node-editor.html`, verify controls render.

## TypeScript Strictness

- `strict: true` is enabled — no implicit `any`.
- Prefer explicit return types on exported functions.
- Use `unknown` over `any` at API boundaries; narrow with type guards.
- IPC payloads crossing the contextBridge use `any` in preload only — type them properly on both sides.

## Vite Config Notes

- Config: `daedalus-dialog-editor/vite.config.ts`
- Two entry points: main app and `node-editor.html`
- `npm run dev` starts full Electron dev mode
- `npm run dev:browser` starts browser-only mode (used by Playwright E2E)
- `npm run dev:node-editor` serves only the node editor playground

## Imports

Use package-level imports for `daedalus-parser`:

```ts
// Correct
import { SemanticModel } from 'daedalus-parser/semantic-model';

// Wrong — do not use internal source paths
import { SemanticModel } from '../../../daedalus-parser/src/semantic/model';
```

## Linting and Type Checks

```bash
# from editor workspace
npm run typecheck
npm run lint
```

Run both before marking work complete.
