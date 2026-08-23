import { test, expect, type Page } from '@playwright/test';

/**
 * E2E tests for the live litegraph quest canvas (fix-04 §4 items 7-10, Q1-Q5).
 *
 * These run in real Chromium via the Vite `dev:browser` harness, where the canvas
 * fully initializes (jsdom bails). Canvas pixels are unaddressable from the DOM, so
 * the tests drive it through the test-only `window.__questGraphDebug` hook exposed by
 * QuestLiteGraphCanvas in dev/test builds — it returns CSS-pixel PAGE coordinates
 * (matching Playwright's mouse space) plus render/build counters and node/edge maps.
 *
 * The mock parser cannot synthesise quest data, so the seeded quest file carries a
 * hand-authored SemanticModel injected through the `//__MOCK_MODEL__` seam in mockAPI.
 */

const QUEST_NAME = 'TOPIC_E2E_QUEST';

// A quest with:
//  - DIA_Start_Info: CreateTopic + a Choice transition to DIA_Mid_Info (→ a `transitions` edge)
//  - DIA_Mid_Info: gated by MIS_E2E_QUEST == 1, no quest-write (→ a `dialog` node with an IF chip)
const INJECTED_MODEL = {
  dialogs: {
    DIA_Start: { name: 'DIA_Start', parent: 'C_INFO', properties: { information: 'DIA_Start_Info', npc: 'PC_Hero' } },
    DIA_Mid: { name: 'DIA_Mid', parent: 'C_INFO', properties: { information: 'DIA_Mid_Info', npc: 'PC_Hero' } }
  },
  functions: {
    DIA_Start_Info: {
      name: 'DIA_Start_Info',
      returnType: 'VOID',
      calls: [],
      conditions: [],
      actions: [
        { type: 'CreateTopic', topic: QUEST_NAME, topicType: 'LOG_MISSION' },
        { type: 'Choice', dialogRef: 'self', text: 'Continue on', targetFunction: 'DIA_Mid_Info' }
      ]
    },
    DIA_Mid_Info: {
      name: 'DIA_Mid_Info',
      returnType: 'VOID',
      calls: [],
      conditions: [{ type: 'VariableCondition', variableName: 'MIS_E2E_QUEST', operator: '==', value: 1 }],
      actions: []
    }
  },
  constants: { [QUEST_NAME]: { name: QUEST_NAME, type: 'string', value: '"E2E Quest"' } },
  variables: { MIS_E2E_QUEST: { name: 'MIS_E2E_QUEST', type: 'int' } },
  instances: {},
  hasErrors: false,
  errors: []
};

const QUEST_FILE = `//__MOCK_MODEL__${JSON.stringify(INJECTED_MODEL)}\n// E2E quest fixture`;

interface DebugNode {
  id: string;
  type: string;
  runtimeId: number;
  hasIfPanel: boolean;
}
interface DebugEdge {
  id: string;
  kind?: string;
  source: string;
  target: string;
}
interface DebugRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  centerX: number;
  centerY: number;
  width: number;
  height: number;
}

// Playwright-side accessors that call into window.__questGraphDebug.
const debug = {
  listNodes: (page: Page) =>
    page.evaluate(() => (window as any).__questGraphDebug?.listNodes() ?? []) as Promise<DebugNode[]>,
  listEdges: (page: Page) =>
    page.evaluate(() => (window as any).__questGraphDebug?.listEdges() ?? []) as Promise<DebugEdge[]>,
  linkCenter: (page: Page, edgeId: string) =>
    page.evaluate((id) => (window as any).__questGraphDebug?.getLinkCenterScreenPos(id) ?? null, edgeId) as Promise<{ x: number; y: number } | null>,
  ifPanelRect: (page: Page, nodeId: string) =>
    page.evaluate((id) => (window as any).__questGraphDebug?.getIfPanelScreenRect(id) ?? null, nodeId) as Promise<DebugRect | null>,
  nodeRect: (page: Page, nodeId: string) =>
    page.evaluate((id) => (window as any).__questGraphDebug?.getNodeScreenRect(id) ?? null, nodeId) as Promise<DebugRect | null>,
  viewport: (page: Page) =>
    page.evaluate(() => (window as any).__questGraphDebug?.getViewport() ?? null) as Promise<{ scale: number; offset: [number, number] } | null>,
  renderCount: (page: Page) =>
    page.evaluate(() => (window as any).__questGraphDebug?.getRenderCount() ?? -1) as Promise<number>,
  selectedNodeId: (page: Page) =>
    page.evaluate(() => (window as any).__questGraphDebug?.getSelectedNodeId() ?? null) as Promise<string | null>,
  selectedEdgeId: (page: Page) =>
    page.evaluate(() => (window as any).__questGraphDebug?.getSelectedEdgeId() ?? null) as Promise<string | null>
};

/** Seeds the mock project, opens it, and drives the UI to the live quest flow canvas. */
async function openQuestFlow(page: Page): Promise<void> {
  // Writable quest editing is opt-in (flag default off); these tests exercise the
  // write flows, so seed the feature flag before the app loads.
  await page.addInitScript(() => {
    window.localStorage.setItem('feature.writableQuestEditor', '1');
  });
  await page.goto('/');
  await expect(page.getByText('Welcome to Dandelion')).toBeVisible();

  await page.evaluate((quest) => {
    localStorage.setItem('mockapi_file_e2equest/quest.d', quest);
  }, QUEST_FILE);

  page.on('dialog', async (dialog) => {
    if (dialog.message().includes('project folder path')) {
      await dialog.accept('e2equest');
    } else {
      await dialog.dismiss();
    }
  });

  await page.getByRole('button', { name: /Open Project/i }).first().click();

  // Switch to the quest editor (this triggers loadQuestData → merges the topic).
  await page.getByRole('button', { name: 'Quest Editor' }).click();

  // Select the seeded quest, then switch to the flow (graph) view.
  await page.getByText('E2E Quest').click({ timeout: 15000 });
  await page.getByRole('button', { name: 'Flow View' }).click();

  // Wait for the live canvas to mount and the graph to build (survives async ingestion).
  await expect
    .poll(async () => (await debug.listNodes(page)).length, { timeout: 20000 })
    .toBeGreaterThan(0);

  // Fit the whole graph into the canvas so every node/link is drawn and addressable
  // (dagre lays the graph out wider than the canvas; a link's center only exists once
  // it has been drawn).
  await page.evaluate(() => (window as any).__questGraphDebug?.fitAll());
}

test.describe('Quest canvas (live litegraph)', () => {
  test('diagnostic: graph builds with a transitions edge and a dialog IF-chip node', async ({ page }) => {
    await openQuestFlow(page);
    const nodes = await debug.listNodes(page);
    const edges = await debug.listEdges(page);

    expect(edges.some((edge) => edge.kind === 'transitions')).toBe(true);
    expect(nodes.some((node) => node.type === 'dialog' && node.hasIfPanel)).toBe(true);
    expect(nodes.some((node) => node.id === 'DIA_Mid_Info')).toBe(true);
  });

  // Q1 — real link-click selection; no stock litegraph context menu / searchbox.
  test('Q1: clicking a transition link opens the inspector edge section and no litegraph menu', async ({ page }) => {
    await openQuestFlow(page);
    const edges = await debug.listEdges(page);
    const transition = edges.find((edge) => edge.kind === 'transitions');
    expect(transition, 'a transitions edge should exist').toBeTruthy();

    const center = await debug.linkCenter(page, transition!.id);
    expect(center, 'link center should be resolvable after a draw').toBeTruthy();

    await page.mouse.click(center!.x, center!.y);

    // Inspector shows the transitions edge section.
    await expect(page.getByText('Edge: transitions')).toBeVisible();
    await expect(page.getByLabel('Transition Text')).toBeVisible();
    expect(await debug.selectedEdgeId(page)).toBe(transition!.id);

    // The stock litegraph link menu ("Add Node" / "Delete") must NOT appear (N7).
    await expect(page.locator('.litecontextmenu')).toHaveCount(0);
    await expect(page.getByText('Add Node', { exact: true })).toHaveCount(0);

    // Double-clicking empty canvas must NOT open litegraph's search box (allow_searchbox=false).
    const viewportSize = page.viewportSize()!;
    await page.mouse.dblclick(viewportSize.width - 30, viewportSize.height - 30);
    await expect(page.locator('.litegraph.litesearchbox')).toHaveCount(0);
  });

  // Q2 — IF-chip selects the dialog node; inspector is the condition-editing surface.
  test('Q2: clicking the IF chip selects the dialog node and edits the condition expression', async ({ page }) => {
    await openQuestFlow(page);
    const panelRect = await debug.ifPanelRect(page, 'DIA_Mid_Info');
    expect(panelRect, 'IF-panel rect should be resolvable').toBeTruthy();

    await page.mouse.click(panelRect!.centerX, panelRect!.centerY);
    expect(await debug.selectedNodeId(page)).toBe('DIA_Mid_Info');

    const expressionField = page.getByLabel('Condition expression');
    await expect(expressionField).toBeVisible();

    await expressionField.fill('MIS_E2E_QUEST == 2');
    await page.getByTestId('qi-condition-expression-preview').click();

    // The diff-preview dialog appears with the regenerated condition function.
    await expect(page.getByText('Quest Command Diff Preview')).toBeVisible();
    const applyButton = page.getByRole('button', { name: 'Apply' });
    await expect(applyButton).toBeEnabled();
    await applyButton.click();

    await expect(page.getByText('Quest Command Diff Preview')).toBeHidden();
    // Graph rebuilt and the node is still present / selection retained.
    await expect.poll(async () => (await debug.listNodes(page)).some((n) => n.id === 'DIA_Mid_Info')).toBe(true);
  });

  // Q3/Q5 — pan/zoom + a model edit preserves viewport and selection; canvas is idle-stable.
  test('Q3/Q5: viewport and selection survive a model edit and the canvas is idle-stable', async ({ page }) => {
    await openQuestFlow(page);

    const viewportInitial = await debug.viewport(page);

    // Pan the canvas by dragging empty space (upper-left quadrant) and zoom with the
    // wheel over the canvas center. Do this BEFORE selecting — dragging empty canvas is
    // a pane click, which deselects; the point is that the EDIT below preserves both.
    const box = (await page.locator('canvas').boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.15, box.y + box.height * 0.15);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.24, box.y + box.height * 0.24, { steps: 10 });
    await page.mouse.up();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -120);

    const viewportBefore = await debug.viewport(page);
    expect(viewportBefore).toBeTruthy();
    // Sanity: the pan/zoom actually moved the viewport.
    const movedScale = Math.abs(viewportBefore!.scale - viewportInitial!.scale) > 1e-6;
    const movedOffset =
      Math.abs(viewportBefore!.offset[0] - viewportInitial!.offset[0]) > 0.5 ||
      Math.abs(viewportBefore!.offset[1] - viewportInitial!.offset[1]) > 0.5;
    expect(movedScale || movedOffset).toBe(true);

    // Now select the start node (re-read its rect at the panned/zoomed viewport).
    const startRect = await debug.nodeRect(page, 'DIA_Start_Info');
    expect(startRect).toBeTruthy();
    await page.mouse.click(startRect!.centerX, startRect!.centerY);
    expect(await debug.selectedNodeId(page)).toBe('DIA_Start_Info');

    // Apply a model-changing edit (append a LOG_RUNNING topic status — non-blocking).
    const statusField = page.getByRole('textbox', { name: 'Status' });
    await statusField.waitFor();
    await statusField.fill('LOG_RUNNING');
    await page.getByTestId('qi-topic-status-preview').click();
    await expect(page.getByText('Quest Command Diff Preview')).toBeVisible();
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByText('Quest Command Diff Preview')).toBeHidden();

    // Viewport (pan/zoom) is unchanged by the model edit (mount-once canvas keeps `ds`).
    const viewportAfter = await debug.viewport(page);
    expect(viewportAfter!.scale).toBeCloseTo(viewportBefore!.scale, 5);
    expect(viewportAfter!.offset[0]).toBeCloseTo(viewportBefore!.offset[0], 3);
    expect(viewportAfter!.offset[1]).toBeCloseTo(viewportBefore!.offset[1], 3);

    // Selection retained across the rebuild.
    expect(await debug.selectedNodeId(page)).toBe('DIA_Start_Info');

    // Idle stability: no 4 Hz render storm — the draw counter is flat over ~1 s idle.
    const renderStart = await debug.renderCount(page);
    await page.waitForTimeout(1100);
    const renderEnd = await debug.renderCount(page);
    expect(renderEnd - renderStart).toBeLessThanOrEqual(1);
  });

  // Q4 — a blocking guardrail delta disables Apply, and forcing apply is refused with the message.
  test('Q4: a blocking guardrail warning disables Apply and refuses the edit', async ({ page }) => {
    await openQuestFlow(page);

    // Select the start (topic) node, which can append a topic status.
    const startRect = await debug.nodeRect(page, 'DIA_Start_Info');
    await page.mouse.click(startRect!.centerX, startRect!.centerY);
    expect(await debug.selectedNodeId(page)).toBe('DIA_Start_Info');

    // Introduce a NEW LOG_FAILED path → introduces a blocking failure-status warning.
    const statusField = page.getByRole('textbox', { name: 'Status' });
    await statusField.waitFor();
    await statusField.fill('LOG_FAILED');
    await page.getByTestId('qi-topic-status-preview').click();

    await expect(page.getByText('Quest Command Diff Preview')).toBeVisible();
    // Blocking warning shown; Apply disabled (UX gate).
    await expect(page.getByText(/LOG_FAILED\/LOG_OBSOLETE status paths/)).toBeVisible();
    const applyButton = page.getByRole('button', { name: 'Apply' });
    await expect(applyButton).toBeDisabled();

    // Invoke the REAL apply handler directly (React filters click events on the disabled
    // button, so page.mouse can't reach it). The application-layer guardrail gate must
    // still refuse the edit at apply time and surface the guardrail message.
    await page.evaluate(() => (window as any).__questApplyDiff?.());

    await expect(page.getByText(/Apply blocked to protect quest guardrails/)).toBeVisible();
  });
});
