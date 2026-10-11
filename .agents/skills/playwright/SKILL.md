---
name: playwright
description: Playwright E2E testing patterns for daedalus-dialog-editor
triggers:
  - "tests/e2e/**"
  - "playwright.config.ts"
  - "*.spec.ts"
---

# Playwright E2E – daedalus-dialog-editor

## Setup

- Config: `daedalus-dialog-editor/playwright.config.ts`
- Test directory: `daedalus-dialog-editor/tests/e2e/`
- Spec files: `*.spec.ts`
- Base URL: `http://localhost:5173`
- Browser: Chromium only (Desktop Chrome profile)
- Dev server command: `npm run dev:browser` (auto-started before tests)

**This is browser-based E2E, not Electron native.** Tests run against the renderer served by Vite in browser mode — the real `window.editorAPI` is replaced by the mock API layer.

## Running Tests

```bash
# from repo root
npm run test:e2e --workspace daedalus-dialog-editor

# from editor workspace
npx playwright test
npx playwright test tests/e2e/node-editor.spec.ts
npx playwright test --headed           # show browser
npx playwright test --debug            # step-by-step
npx playwright show-report             # open HTML report after run
```

## Existing Specs

| File | Coverage |
|------|----------|
| `node-editor.spec.ts` | Node editor playground, quest select, entry surfaces |
| `dialog-creation.spec.ts` | Creating new dialogs |
| `dialog-editing.spec.ts` | Editing dialog content |
| `dialog-focus.spec.ts` | Focus/navigation behaviour |
| `file-opening.spec.ts` | Opening `.d` files |
| `project-mode-editing.spec.ts` | Project-mode multi-file editing |

## Writing Specs

```ts
import { expect, test } from '@playwright/test';

test.describe('My feature', () => {
  test('does the thing', async ({ page }) => {
    await page.goto('/node-editor.html');

    // Prefer role-based locators
    await page.getByRole('combobox', { name: 'Quest' }).click();
    await page.getByRole('option', { name: 'TOPIC_GUILDJOIN' }).click();

    await expect(page.getByRole('combobox', { name: 'Quest' }))
      .toContainText('TOPIC_GUILDJOIN');
  });
});
```

## Locator Conventions

- Prefer `getByRole`, `getByText`, `getByLabel` — mirrors how users perceive the UI.
- Use `data-testid` attributes (e.g., `data-testid="node-editor-quest-select"`) only for non-semantic controls.
- Avoid CSS selectors and XPath.

## Waiting and Assertions

```ts
// Visible
await expect(locator).toBeVisible();

// Not present
await expect(locator).toHaveCount(0);

// Text content
await expect(locator).toContainText(/Entry surfaces:\s+\d+/);

// Avoid manual waits — use expect() assertions which auto-retry
```

## CI Behaviour

- `forbidOnly: true` — never commit `test.only`
- `retries: 2` on CI, `0` locally
- `workers: 1` on CI (sequential), uncapped locally
- Artifacts on failure: screenshot + video retained in `playwright-report/`

## Timeouts

- Per-test timeout: 30 s (set in config)
- For slow operations, override locally: `test.setTimeout(60_000)`
- Dev server startup timeout: 120 s
