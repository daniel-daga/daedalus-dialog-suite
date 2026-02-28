import { expect, test } from '@playwright/test';

test.describe('Node editor playground', () => {
  test('loads isolated quest flow with mock data', async ({ page }) => {
    await page.goto('/node-editor.html');

    await expect(page.getByText('Quest Node Editor Playground')).toBeVisible();
    await expect(page.getByText('TOPIC_RELIC_CONSPIRACY')).toBeVisible();
    await expect(page.getByText('Writable quest editor is disabled (read-only fallback).')).toBeVisible();
    await expect(page.getByText(/Entry surfaces:\s+\d+/)).toBeVisible();
    await expect(
      page.getByText('Quest branches depend on shared state variables: MIS_RELIC_CONSPIRACY_ALERT, MIS_RELIC_CONSPIRACY_STEP.')
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'DIA_RelicConspiracy_ConfrontJudge latent' })).toBeVisible();

    await page.getByRole('combobox', { name: 'Quest' }).click();
    await page.getByRole('option', { name: 'TOPIC_GUILDJOIN' }).click();

    await expect(page.getByRole('combobox', { name: 'Quest' })).toContainText('TOPIC_GUILDJOIN');
    await expect(
      page.getByText('Quest branches depend on shared state variables: MIS_RELIC_CONSPIRACY_ALERT, MIS_RELIC_CONSPIRACY_STEP.')
    ).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'DIA_RelicConspiracy_ConfrontJudge latent' })).toHaveCount(0);
  });

  test('shows a rich entry-surface list for the comprehensive dummy quest', async ({ page }) => {
    await page.goto('/node-editor.html');

    await expect(page.getByText('Entry Surfaces (10)')).toBeVisible();
    await expect(page.getByText('Latent: 10')).toBeVisible();
    await expect(page.getByRole('button', { name: 'DIA_RelicConspiracy_AskSmuggler latent' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'DIA_RelicConspiracy_BribeGuard latent' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'DIA_RelicConspiracy_ExposeAtCouncil latent' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'DIA_RelicConspiracy_FindLedger latent' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'DIA_RelicConspiracy_ReportDock latent' })).toBeVisible();

    const relicEntryButtons = page.locator('button:has-text("DIA_RelicConspiracy_")');
    expect(await relicEntryButtons.count()).toBeGreaterThanOrEqual(10);
  });

  test('uses semantic condition types for Henry/Owen in Der Turm dummy quest', async ({ page }) => {
    await page.goto('/node-editor.html');

    await page.getByRole('combobox', { name: 'Quest' }).click();
    await page.getByRole('option', { name: 'TOPIC_Addon_BanditsTower' }).click();
    await page.getByRole('button', { name: 'DIA_Addon_Henry_Owen latent' }).click();

    await expect(page.getByRole('combobox', { name: 'Quest' })).toContainText('TOPIC_Addon_BanditsTower');
    await expect(page.getByText('Function: DIA_Addon_Henry_Owen_Info')).toBeVisible();
    await expect(page.getByText('gated by VariableCondition, NpcIsDeadCondition')).toBeVisible();
    await expect(page.getByText('gated by Condition')).toHaveCount(0);
  });
});
