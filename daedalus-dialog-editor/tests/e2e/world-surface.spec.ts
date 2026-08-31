import { test, expect, Page } from '@playwright/test';

/**
 * Browser mock-harness specs for the World surface (level-editor.md §6).
 *
 * What this suite can and cannot reach is worth stating, because a green run
 * here is not a working viewport: the harness runs the renderer in plain
 * Chromium against the mock API, which has no ZenGin world, no Gothic install
 * and no native binding — deliberately, since a fabricated world would be a
 * scene nobody could tell apart from a broken real one.
 *
 * So these specs cover exactly the flow that lives in the renderer: the view is
 * reachable, it is lazily loaded, it explains what it needs, and a refused open
 * surfaces the refusal instead of leaving a spinner running. The rendering
 * itself is covered by the scene-graph assertions in tests/WorldScene.test.ts,
 * and its performance by the measured spike numbers in §3.
 */

async function openWorldView(page: Page) {
  await page.goto('/');
  await expect(page.getByText('Welcome to Dandelion')).toBeVisible();

  // The view toggles live in the main layout, which needs a file open first.
  await page.evaluate(() => {
    localStorage.setItem('mockapi_file_project/world.d', '// empty\n');
    localStorage.setItem(
      'recent_projects',
      JSON.stringify([{ path: 'project', name: 'project', lastOpened: Date.now() }]),
    );
  });

  page.on('dialog', async (dialog) => {
    if (dialog.message().includes('project folder path')) await dialog.accept('project');
    else await dialog.dismiss();
  });
  await page.getByRole('button', { name: /Open Project/i }).first().click();

  await page.getByTestId('world-toggle').click();
}

test.describe('World surface', () => {
  test('the World view is reachable and says what it needs before it can show anything', async ({ page }) => {
    await openWorldView(page);

    await expect(page.getByTestId('world-open')).toBeVisible();
    await expect(page.getByTestId('world-choose-install')).toBeVisible();
    // The install is what supplies meshes and textures; a world opened without
    // one resolves no visual at all, so the surface says so up front rather
    // than rendering an empty world and letting it look like a data problem.
    await expect(page.getByText(/Select the Gothic installation|Gothic installation/i)).toBeVisible();
  });

  test('the toolbar keeps its file controls in the file group', async ({ page }) => {
    // A regression tripwire for the toolbar restructure
    // (level-editor.md §17): the split into
    // WorldToolbar's four groups must not have left world-open or
    // world-choose-install outside the group named for them, and this is
    // the one thing the browser harness can check pre-open without a world.
    await openWorldView(page);

    const fileGroup = page.getByTestId('world-toolbar-file');
    await expect(fileGroup.getByTestId('world-open')).toBeVisible();
    await expect(fileGroup.getByTestId('world-choose-install')).toBeVisible();
  });

  test('the viewport is not mounted until a world is actually open', async ({ page }) => {
    // The scene costs tens of megabytes of GPU buffers; mounting it eagerly
    // would pay that for a view the user only glanced at.
    await openWorldView(page);
    await expect(page.getByTestId('world-viewport')).toHaveCount(0);
  });

  test('switching away from the World view hides it without unmounting it', async ({ page }) => {
    // `docs/refactoring-targets.md` §8: the surface holds the world's geometry
    // in local state and never refetches it on mount, so a conditional mount
    // loses it on every navigate-away. It is hidden by a display toggle now —
    // off screen but still in the DOM, and still the same instance.
    await openWorldView(page);
    await expect(page.getByTestId('world-open')).toBeVisible();

    await page.getByRole('button', { name: 'Dialog Editor' }).click();
    await expect(page.getByTestId('world-open')).toHaveCount(1);
    await expect(page.getByTestId('world-open')).not.toBeVisible();

    await page.getByTestId('world-toggle').click();
    await expect(page.getByTestId('world-open')).toBeVisible();
  });

  test('a refused open is reported, not left spinning', async ({ page }) => {
    // The mock API refuses `openWorld` outright, which is the same shape as the
    // real refusals a user will actually hit — no Gothic install configured, or
    // a world path outside the whitelist.
    await openWorldView(page);

    await page.evaluate(() => {
      const api = (window as unknown as { editorAPI: Record<string, unknown> }).editorAPI;
      api.openWorldDialog = async () => 'C:/Gothic II/NewWorld.zen';
    });

    await page.getByTestId('world-open').click();
    await expect(page.getByTestId('world-error')).toBeVisible();
    await expect(page.getByTestId('world-viewport')).toHaveCount(0);
  });
});
