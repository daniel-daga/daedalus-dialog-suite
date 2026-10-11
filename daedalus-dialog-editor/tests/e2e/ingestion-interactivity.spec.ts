import { test, expect } from '@playwright/test';

/**
 * Browser mock-harness smoke guard for fix-07 §3.3 (render performance at mod
 * scale). NOT a benchmark and NOT end-to-end — it never launches Electron and
 * makes zero wall-clock/timing assertions (see tests/e2e/README.md).
 *
 * Goal: guard against re-introducing a main-thread storm during background
 * ingestion. We seed a mod-scale project (many small dialog files across many
 * NPCs), open it, and assert that:
 *   1. the ingestion progress UI appears and renders determinate progress while
 *      ingestion is running (the main thread is committing flush states, not
 *      frozen) — the "during ingestion" precondition;
 *   2. ingestion eventually completes; and
 *   3. the NPC list is then interactive — typing into the NPC filter yields the
 *      expected filtered subset within a generous timeout.
 *
 * Note on the interaction ordering: the app shows a full-screen
 * `ProjectOpeningOverlay` (a modal Backdrop) for the whole `isIngesting` window,
 * so by product design the NPC filter is not clickable *until* ingestion
 * finishes. The filter interaction therefore runs as soon as the overlay clears;
 * Playwright's actionability auto-wait on `fill()` encodes "wait until the UI is
 * interactive again". A re-introduced storm would either stall the determinate
 * overlay, prevent ingestion from completing within the timeout, or hang the
 * post-ingestion filter — all caught here.
 *
 * The mock parser is synchronous, so without help a whole project ingests inside
 * one microtask burst (faster than the 500 ms flush window) and the progress
 * phase is never observable. We opt into `mockapi_parse_delay_ms` (a mock-only
 * seam) to give each file parse a small latency, modelling real parse cost so
 * ingestion spans multiple flush windows. All assertions remain state-based, not
 * timing-based.
 */

// ~50 NPCs × 3 dialog files each = 150 small files — enough to make ingestion
// span several 500 ms flush windows (with the parse delay below) and to give the
// NPC list real, filterable entries. Small content keeps the total well under
// the localStorage budget (~45 KB).
const NPC_COUNT = 50;
const FILES_PER_NPC = 3;
// Per-file parse latency (ms) applied only via the seeded mock seam. 150 files /
// 20 ingestion workers × ~200 ms ≈ 1.5 s of ingestion → multiple flush windows.
const PARSE_DELAY_MS = 200;
const FOLDER = 'perf';

const pad = (n: number) => String(n).padStart(3, '0');
const npcName = (npc: number) => `NPC_Villager_${pad(npc)}`;

function buildDialogFile(npc: number, fileIdx: number): { path: string; content: string } {
  const npcId = npcName(npc);
  const dialogName = `DIA_Villager_${pad(npc)}_${fileIdx}`;
  const content = `INSTANCE ${dialogName}(C_INFO)
{
\tnpc = ${npcId};
\tnr = 1;
\tcondition = ${dialogName}_Condition;
\tinformation = ${dialogName}_Info;
\timportant = FALSE;
};

FUNC INT ${dialogName}_Condition()
{
\treturn TRUE;
};

FUNC VOID ${dialogName}_Info()
{
\tAI_Output(self, other, "${dialogName}_15_00");
};
`;
  return { path: `${FOLDER}/${dialogName}.d`, content };
}

function buildFixture(): Array<{ path: string; content: string }> {
  const files: Array<{ path: string; content: string }> = [];
  for (let npc = 0; npc < NPC_COUNT; npc++) {
    for (let f = 0; f < FILES_PER_NPC; f++) {
      files.push(buildDialogFile(npc, f));
    }
  }
  return files;
}

test.describe('Ingestion interactivity (fix-07 §3.3 smoke)', () => {
  test('UI stays interactive: ingestion progresses, completes, and the NPC filter works', async ({ page }) => {
    const fixture = buildFixture();
    const totalFiles = fixture.length;

    await page.goto('/');
    await expect(page.getByText('Welcome to Dandelion')).toBeVisible();

    // Seed the mod-scale project and opt into per-parse latency so the ingestion
    // window is observable in the mock harness.
    await page.evaluate(
      ({ files, delayMs }) => {
        for (const { path, content } of files) {
          localStorage.setItem(`mockapi_file_${path}`, content);
        }
        localStorage.setItem('mockapi_parse_delay_ms', String(delayMs));
      },
      { files: fixture, delayMs: PARSE_DELAY_MS }
    );

    page.on('dialog', async (dialog) => {
      if (dialog.message().includes('project folder path')) {
        await dialog.accept(FOLDER);
      } else {
        await dialog.dismiss();
      }
    });

    await page.getByRole('button', { name: /Open Project/i }).first().click();

    // (1) Precondition: ingestion is in progress. The progress overlay is visible
    // and rendering determinate progress ("N / <total> files") — proof the main
    // thread is committing flush states rather than being jammed by a storm.
    const overlay = page.getByTestId('project-opening-overlay');
    await expect(overlay).toBeVisible();
    await expect(overlay).toContainText(new RegExp(`/ ${totalFiles} files`));

    // (2) Ingestion eventually completes — the overlay clears. Generous timeout;
    // this is a completion guard, not a speed assertion.
    await expect(overlay).toBeHidden({ timeout: 20000 });

    // (3) The NPC list is now interactive. The full NPC set is shown...
    await expect(page.getByText(`${NPC_COUNT} of ${NPC_COUNT} shown`)).toBeVisible();

    // ...and typing into the NPC filter yields the expected filtered subset.
    // "007" uniquely matches NPC_Villager_007.
    const filter = page.getByPlaceholder('Filter NPCs...');
    await filter.fill('007');

    await expect(page.getByText(`1 of ${NPC_COUNT} shown`)).toBeVisible();
    await expect(page.getByText('NPC_Villager_007')).toBeVisible();

    // Clearing the filter restores the full list — the list stays responsive.
    await filter.fill('');
    await expect(page.getByText(`${NPC_COUNT} of ${NPC_COUNT} shown`)).toBeVisible();
  });
});
