import { test, expect } from '@playwright/test';
import { launchApp, type AppFixture } from './harness';

test.describe('What changed build splash', () => {
  let fixture: AppFixture;

  test.beforeEach(async () => {
    fixture = await launchApp({ dismissWhatChanged: false });
  });

  test.afterEach(async () => {
    await fixture?.cleanup();
  });

  test('shows the build notes and closes when acknowledged', async () => {
    const { page } = fixture;
    const dialog = page.getByRole('dialog', { name: 'What changed' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('E2E release note fixture')).toBeVisible();
    await expect(dialog.getByText('#123')).toBeVisible();

    await page.getByRole('button', { name: 'Got it' }).click();
    await expect(dialog).toBeHidden();
  });
});
