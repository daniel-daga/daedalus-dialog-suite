---
name: jest
description: Jest testing patterns for daedalus-dialog-editor
triggers:
  - "*.test.ts"
  - "*.test.tsx"
  - "jest.config.js"
  - "tests/setup.ts"
---

# Jest Testing – daedalus-dialog-editor

## Config

- Config file: `daedalus-dialog-editor/jest.config.js`
- Preset: `ts-jest`, environment: `jsdom`
- Test roots: `tests/` and `src/` (pattern `**/*.test.ts?(x)`)
- Setup file: `tests/setup.ts` — injects `window.editorAPI = mockEditorAPI` for all tests
- CSS imports are stubbed via `identity-obj-proxy`
- `daedalus-parser` subpath mocks live in `tests/mocks/` and are activated automatically when the real package is absent

## Running Tests

```bash
# from repo root
npm run test --workspace daedalus-dialog-editor

# focused — from editor workspace
npm test -- --testPathPattern=EditorPane
npm test -- --testNamePattern="saves on blur"
```

## Conventions

- **File placement**: test files live alongside source files in `src/` OR under `tests/` at the workspace root. Use `tests/` for integration-style tests that span multiple modules.
- **Naming**: `ComponentName.test.tsx` for components, `serviceName.test.ts` for services. For regression or scenario-specific tests use dot-separation: `editorStore.questHistory.test.ts`.
- **TDD order**: write a failing test first, then implement the minimal fix.

## Mocking `window.editorAPI`

The real `editorAPI` is injected by the Electron preload. In tests use the shared mock:

```ts
import { mockEditorAPI } from '../src/renderer/utils/mockAPI';

// tests/setup.ts already does this globally:
(window as any).editorAPI = mockEditorAPI;

// Override individual methods per test:
jest.spyOn(window.editorAPI, 'parseSource').mockResolvedValue({ ... });
```

Never mock `ipcRenderer` directly in renderer tests — use `mockEditorAPI` instead.

## Mocking `daedalus-parser`

Use the pre-built mock files in `tests/mocks/`:

```ts
// Automatically resolved when real package is absent.
// Manual import in edge cases:
import { createSemanticModel } from '../tests/mocks/semantic-model';
```

## Component Tests (React Testing Library)

```ts
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

it('updates label on input', async () => {
  const user = userEvent.setup();
  render(<MyComponent />);
  await user.type(screen.getByRole('textbox'), 'hello');
  expect(screen.getByDisplayValue('hello')).toBeInTheDocument();
});
```

- Prefer `getByRole` over `getByTestId`; fall back to `data-testid` only for non-semantic elements.
- Use `waitFor` / `findBy*` for async state updates.

## Performance Tests

Tests named `*.perf.test.ts(x)` (e.g., `DialogTree.perf.test.tsx`) measure render counts and timing. Use `jest.useFakeTimers()` sparingly and always restore with `jest.useRealTimers()`.

## Coverage

```bash
npm test -- --coverage
# Source: src/**/*.{ts,tsx} (excludes src/main/main.ts and *.d.ts)
```
