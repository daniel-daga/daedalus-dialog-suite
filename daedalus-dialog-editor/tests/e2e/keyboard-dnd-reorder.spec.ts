import { test, expect, Page } from '@playwright/test';

/**
 * fix-05 §2.5 (U5): all action lists in a dialog pane share ONE hoisted
 * DragDropContext. This spec exercises @hello-pangea/dnd keyboard drag
 * (focus handle -> Space to lift -> Arrow to move -> Space to drop) in three
 * nested list surfaces that previously each mounted their own context:
 *   - the top-level action list,
 *   - a ConditionalAction "then" branch,
 *   - an InlineChoiceEditor sub-list (a different target function).
 *
 * The dialog is injected via the mock-model seam because the regex mock parser
 * cannot synthesise conditionals/choices from source.
 */

const MODEL = {
  dialogs: {
    DIA_Dnd: {
      name: 'DIA_Dnd',
      parent: 'C_INFO',
      properties: {
        npc: 'SLD_DND_Reorder',
        nr: 1,
        condition: 'DIA_Dnd_Condition',
        information: 'DIA_Dnd_Info',
      },
    },
  },
  functions: {
    DIA_Dnd_Condition: { name: 'DIA_Dnd_Condition', returnType: 'INT', actions: [], conditions: [], calls: [] },
    DIA_Dnd_Info: {
      name: 'DIA_Dnd_Info',
      returnType: 'VOID',
      conditions: [],
      calls: [],
      actions: [
        { type: 'DialogLine', speaker: 'self', text: 'TOP_A', id: 'top_a' },
        { type: 'DialogLine', speaker: 'self', text: 'TOP_B', id: 'top_b' },
        {
          type: 'ConditionalAction',
          condition: 'Npc_KnowsInfo(other, DIA_Dnd)',
          thenActions: [
            { type: 'DialogLine', speaker: 'self', text: 'THEN_A', id: 'then_a' },
            { type: 'DialogLine', speaker: 'self', text: 'THEN_B', id: 'then_b' },
          ],
          elseActions: [],
        },
        { type: 'Choice', dialogRef: 'DIA_Dnd', text: 'A choice', targetFunction: 'DIA_Dnd_Choice' },
      ],
    },
    DIA_Dnd_Choice: {
      name: 'DIA_Dnd_Choice',
      returnType: 'VOID',
      conditions: [],
      calls: [],
      actions: [
        { type: 'DialogLine', speaker: 'self', text: 'CHOICE_A', id: 'choice_a' },
        { type: 'DialogLine', speaker: 'self', text: 'CHOICE_B', id: 'choice_b' },
      ],
    },
  },
  hasErrors: false,
  errors: [],
};

const SEED_FILE = `//__MOCK_MODEL__${JSON.stringify(MODEL)}\n`;

/** Read the DialogLine text values in DOM order. */
async function textOrder(page: Page): Promise<string[]> {
  return page.getByLabel('Text', { exact: true }).evaluateAll((els) =>
    els.map((el) => (el as HTMLTextAreaElement | HTMLInputElement).value)
  );
}

/** Keyboard-drag the draggable ending in `-<idSuffix>` one step down its list. */
async function keyboardMoveDown(page: Page, idSuffix: string) {
  const handle = page.locator(`[data-rfd-drag-handle-draggable-id$="-${idSuffix}"]`).first();
  await handle.focus();
  await page.keyboard.press('Space'); // lift
  await page.waitForTimeout(200);
  await page.keyboard.press('ArrowDown'); // move within the list
  await page.waitForTimeout(200);
  await page.keyboard.press('Space'); // drop
  await page.waitForTimeout(300);
}

test.describe('Keyboard drag-and-drop reorder under one hoisted context (U5)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate((content) => {
      localStorage.setItem('mockapi_file_dnd.d', content);
    }, SEED_FILE);

    page.on('dialog', async (d) => await d.accept('dnd.d'));
    await page.getByRole('button', { name: /Open Single File/i }).click();
    await expect(page.getByRole('heading', { name: 'NPCs' })).toBeVisible({ timeout: 10000 });

    await page.getByText('SLD_DND_Reorder').click();
    await page.getByRole('button', { name: /DIA_Dnd/ }).first().click();
    await expect(page.getByRole('heading', { name: 'DIA_Dnd', exact: true })).toBeVisible();
    // Two top lines + two conditional-branch lines are visible before expanding the choice.
    await expect(async () => {
      expect(await page.getByLabel('Text', { exact: true }).count()).toBe(4);
    }).toPass({ timeout: 5000 });
  });

  test('reorders the top-level list', async ({ page }) => {
    const before = await textOrder(page);
    expect(before.indexOf('TOP_A')).toBeLessThan(before.indexOf('TOP_B'));

    await keyboardMoveDown(page, 'top_a');

    await expect(async () => {
      const after = await textOrder(page);
      expect(after.indexOf('TOP_B')).toBeLessThan(after.indexOf('TOP_A'));
    }).toPass({ timeout: 5000 });
  });

  test('reorders inside a ConditionalAction "then" branch', async ({ page }) => {
    const before = await textOrder(page);
    expect(before.indexOf('THEN_A')).toBeLessThan(before.indexOf('THEN_B'));

    await keyboardMoveDown(page, 'then_a');

    await expect(async () => {
      const after = await textOrder(page);
      expect(after.indexOf('THEN_B')).toBeLessThan(after.indexOf('THEN_A'));
    }).toPass({ timeout: 5000 });
  });

  test('Alt+Arrow moves the focused action and keeps focus on it', async ({ page }) => {
    const before = await textOrder(page);
    expect(before.indexOf('TOP_A')).toBeLessThan(before.indexOf('TOP_B'));

    const topA = page.getByLabel('Text', { exact: true }).filter({ hasText: '' }).nth(before.indexOf('TOP_A'));
    await topA.click();
    await page.keyboard.press('Alt+ArrowDown');

    await expect(async () => {
      const after = await textOrder(page);
      expect(after.indexOf('TOP_B')).toBeLessThan(after.indexOf('TOP_A'));
    }).toPass({ timeout: 5000 });
    // Focus followed the moved line, so a second press keeps moving it.
    await expect(page.locator(':focus')).toHaveValue('TOP_A');

    await page.keyboard.press('Alt+ArrowUp');
    await expect(async () => {
      const back = await textOrder(page);
      expect(back.indexOf('TOP_A')).toBeLessThan(back.indexOf('TOP_B'));
    }).toPass({ timeout: 5000 });
  });

  test('Alt+Arrow inside a ConditionalAction branch stays within the branch', async ({ page }) => {
    const before = await textOrder(page);
    await page.getByLabel('Text', { exact: true }).nth(before.indexOf('THEN_B')).click();

    // THEN_B is the branch's last line: Alt+Down is a no-op, not an escape into the parent list.
    await page.keyboard.press('Alt+ArrowDown');
    await page.waitForTimeout(300);
    expect(await textOrder(page)).toEqual(before);

    await page.keyboard.press('Alt+ArrowUp');
    await expect(async () => {
      const after = await textOrder(page);
      expect(after.indexOf('THEN_B')).toBeLessThan(after.indexOf('THEN_A'));
      expect(after.indexOf('TOP_B')).toBeLessThan(after.indexOf('THEN_B'));
    }).toPass({ timeout: 5000 });
  });

  test('the InlineChoiceEditor sub-list joins the one hoisted context and lifts a drag', async ({ page }) => {
    // Expand the choice to mount its inline sub-list (a different target function).
    await page.getByRole('button', { name: 'Expand choice actions' }).click();
    await expect(async () => {
      const values = await textOrder(page);
      expect(values).toContain('CHOICE_A');
      expect(values).toContain('CHOICE_B');
    }).toPass({ timeout: 5000 });

    // Every list on the pane — top-level, conditional branch, and this choice
    // sub-list — must share ONE DragDropContext (the §2.5 hoist). @hello-pangea
    // stamps each drag handle with its context id.
    const contextIds = await page
      .locator('[data-rfd-drag-handle-context-id]')
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-rfd-drag-handle-context-id')));
    expect(contextIds.length).toBeGreaterThan(1);
    expect(new Set(contextIds).size).toBe(1);

    // The choice sub-list's droppableId is uniquely namespaced by its target
    // function, so it never collides with the top list's 'root' droppable.
    const droppableIds = await page
      .locator('[data-rfd-droppable-id]')
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-rfd-droppable-id')));
    expect(new Set(droppableIds).size).toBe(droppableIds.length); // all unique
    expect(droppableIds.some((id) => id?.startsWith('DIA_Dnd_Choice__'))).toBe(true);

    // The sub-list's own drag handle lifts under the single hoisted context with
    // no "unable to find draggable" / nested-context error.
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.text().includes('Unable to find')) errors.push(m.text());
    });
    const handle = page.locator('[data-rfd-drag-handle-draggable-id$="-choice_a"]').first();
    await handle.focus();
    await page.keyboard.press('Space');
    await page.waitForTimeout(200);
    await page.keyboard.press('Escape'); // cancel the lift cleanly
    await page.waitForTimeout(200);
    expect(errors.join('\n')).not.toContain('Unable to find');
  });
});
