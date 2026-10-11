# Browser mock-harness UI suite (`tests/e2e/`)

Despite the directory name, this is **not** an end-to-end suite — it never
launches Electron. Specs run the real React/MUI/Zustand renderer in plain
Chromium (via `playwright.config.ts` / `npm run dev:browser`) against the
**mock API** (`src/renderer/utils/mockAPI.ts`): a localStorage-backed fake of
the entire main process, with a mock parser and a mock code generator.

Use it for UI-flow iteration — action/choice/condition editing, drag-reorder,
dialog properties, focus management, search, variable manager, theming, view
switching, reload-confirmation UX — where the backend is irrelevant.

## Harness contract

The mock code generator only round-trips **dialog properties and AI_Output
dialog lines** (`mockAPI.ts` skips every action without `speaker`/`text`/`id`),
and the mock "parser" returns a canned model. Therefore:

- **No spec in this directory may assert generated/saved file content beyond
  AI_Output lines.** An assertion about bytes-after-save or generated-from-model
  output validates the *mock's* codegen, not the product's — e.g. a CreateTopic
  action "saved" through the mock silently disappears and the test still passes.
- Disk-truth assertions (real parser + real codegen + real file writes) belong
  in the real-Electron suite `tests/e2e-electron/` (built separately), which
  launches the packaged app and reads bytes directly from disk.

Assertions that are legitimate here: UI state after an edit/reload round-trip,
AI_Output line counts/text, and dialog-property values.
