import { test, expect, Page } from '@playwright/test';

/**
 * Issue #436: dialog lines inside an expanded choice could not be reordered by
 * mouse drag — the row sometimes went invisible during the drag and on mouse-up
 * it snapped back to its old position.
 *
 * The choice sub-list is a Droppable nested inside the Choice ActionCard, which
 * is itself a Draggable of the dialog's top-level list. The mock-model seam is
 * used because the regex mock parser cannot synthesise choices from source.
 */

const MODEL = {
  dialogs: {
    DIA_ChoiceDnd: {
      name: 'DIA_ChoiceDnd',
      parent: 'C_INFO',
      properties: {
        npc: 'SLD_DND_Choice',
        nr: 1,
        condition: 'DIA_ChoiceDnd_Condition',
        information: 'DIA_ChoiceDnd_Info',
      },
    },
  },
  functions: {
    DIA_ChoiceDnd_Condition: { name: 'DIA_ChoiceDnd_Condition', returnType: 'INT', actions: [], conditions: [], calls: [] },
    DIA_ChoiceDnd_Info: {
      name: 'DIA_ChoiceDnd_Info',
      returnType: 'VOID',
      conditions: [],
      calls: [],
      actions: [
        { type: 'DialogLine', speaker: 'self', text: 'TOP_LINE', id: 'top_line' },
        { type: 'Choice', dialogRef: 'DIA_ChoiceDnd', text: 'Pick one', targetFunction: 'DIA_ChoiceDnd_Choice' },
      ],
    },
    DIA_ChoiceDnd_Choice: {
      name: 'DIA_ChoiceDnd_Choice',
      returnType: 'VOID',
      conditions: [],
      calls: [],
      actions: [
        { type: 'DialogLine', speaker: 'self', text: 'CHOICE_A', id: 'choice_a' },
        { type: 'DialogLine', speaker: 'self', text: 'CHOICE_B', id: 'choice_b' },
        { type: 'DialogLine', speaker: 'self', text: 'CHOICE_C', id: 'choice_c' },
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

function handle(page: Page, id: string) {
  return page.locator(`[data-rfd-drag-handle-draggable-id$="-${id}"]`).first();
}

test.describe('Mouse drag reorder inside an expanded choice (issue #436)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate((content) => {
      localStorage.setItem('mockapi_file_choice-dnd.d', content);
    }, SEED_FILE);

    page.on('dialog', async (d) => await d.accept('choice-dnd.d'));
    await page.getByRole('button', { name: /Open Single File/i }).click();
    await expect(page.getByRole('heading', { name: 'NPCs' })).toBeVisible({ timeout: 10000 });

    await page.getByText('SLD_DND_Choice').click();
    await page.getByRole('button', { name: /DIA_ChoiceDnd/ }).first().click();
    await expect(page.getByRole('heading', { name: 'DIA_ChoiceDnd', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Expand choice actions' }).click();
    await expect(async () => {
      const values = await textOrder(page);
      expect(values.indexOf('CHOICE_A')).toBeGreaterThan(-1);
      expect(values.indexOf('CHOICE_A')).toBeLessThan(values.indexOf('CHOICE_B'));
      expect(values.indexOf('CHOICE_B')).toBeLessThan(values.indexOf('CHOICE_C'));
    }).toPass({ timeout: 5000 });

    // Let the expand animation settle (it holds `overflow: hidden` until it
    // enters) and bring the sub-list into view: the pane scrolls, and a drag
    // must start from rows the user can see.
    await page.waitForTimeout(400);
    await page.getByLabel('Text', { exact: true }).nth(3).evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(200);
  });

  test('dragging a choice line below the next line reorders the sub-list', async ({ page }) => {
    const before = await textOrder(page);
    const cField = page.getByLabel('Text', { exact: true }).nth(before.indexOf('CHOICE_C'));

    const source = await handle(page, 'choice_a').boundingBox();
    const target = await cField.boundingBox();
    if (!source || !target) throw new Error('missing drag geometry');

    // The grip sits at the row's left edge, so the gesture is a straight pull
    // down onto CHOICE_C — exactly what a user does.
    const x = source.x + source.width / 2;
    await page.mouse.move(x, source.y + source.height / 2);
    await page.mouse.down();
    await page.mouse.move(x, target.y + target.height / 2, { steps: 10 });
    await page.waitForTimeout(100);

    // While dragging, the lifted row must still be on screen — the report's
    // "row goes invisible while I drag it". The drag preview is position:fixed,
    // so it lands off screen if an ancestor grows a transform mid-drag.
    const dragging = await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>('[data-rfd-drag-handle-draggable-id$="-choice_a"]');
      const row = el?.closest<HTMLElement>('[data-rfd-draggable-id]');
      if (!row) return null;
      const rect = row.getBoundingClientRect();
      const style = getComputedStyle(row);
      return {
        position: style.position,
        visibility: style.visibility,
        opacity: Number(style.opacity),
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        viewport: { width: window.innerWidth, height: window.innerHeight },
      };
    });
    expect(dragging).not.toBeNull();
    expect(dragging!.position).toBe('fixed'); // the row is actually lifted
    expect(dragging!.visibility).not.toBe('hidden');
    expect(dragging!.opacity).toBeGreaterThan(0);
    expect(dragging!.rect.x + dragging!.rect.width).toBeGreaterThan(0);
    expect(dragging!.rect.y + dragging!.rect.height).toBeGreaterThan(0);
    expect(dragging!.rect.x).toBeLessThan(dragging!.viewport.width);
    expect(dragging!.rect.y).toBeLessThan(dragging!.viewport.height);

    await page.mouse.up();

    await expect(async () => {
      const after = await textOrder(page);
      // CHOICE_A lands after CHOICE_C; the other two keep their relative order
      // and the sub-list keeps its lines (nothing lost, nothing duplicated).
      expect(after.indexOf('CHOICE_B')).toBeLessThan(after.indexOf('CHOICE_C'));
      expect(after.indexOf('CHOICE_C')).toBeLessThan(after.indexOf('CHOICE_A'));
      expect(after.indexOf('TOP_LINE')).toBeLessThan(after.indexOf('CHOICE_B'));
    }).toPass({ timeout: 5000 });
  });
});
