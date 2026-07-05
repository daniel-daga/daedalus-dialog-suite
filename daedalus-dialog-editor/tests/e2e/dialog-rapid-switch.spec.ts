import { test, expect } from '@playwright/test';

/**
 * Phase 2 (dialog-open-latency): the editor pane now stays mounted across
 * same-file dialog switches instead of unmounting to a spinner shell and
 * remounting. This guards the rapid-switch race that the old RAF
 * cancellation guard used to cover: clicking a second dialog before the
 * first one has fully committed must end up showing the SECOND dialog, not
 * a stale mix of the first.
 */

const SAMPLE_DIALOG_CONTENT = `
INSTANCE DIA_Rapid_A(C_INFO)
{
	npc	= SLD_99005_Rapid;
	nr	= 1;
	condition	= DIA_Rapid_A_Condition;
	information	= DIA_Rapid_A_Info;
	important	= TRUE;
};

FUNC INT DIA_Rapid_A_Condition()
{
	return TRUE;
};

FUNC VOID DIA_Rapid_A_Info()
{
	AI_Output(self, other, "DIA_Rapid_A_15_1"); //Dialog A first line
};

INSTANCE DIA_Rapid_B(C_INFO)
{
	npc	= SLD_99005_Rapid;
	nr	= 2;
	condition	= DIA_Rapid_B_Condition;
	information	= DIA_Rapid_B_Info;
	important	= TRUE;
};

FUNC INT DIA_Rapid_B_Condition()
{
	return TRUE;
};

FUNC VOID DIA_Rapid_B_Info()
{
	AI_Output(self, other, "DIA_Rapid_B_15_1"); //Dialog B first line
};
`;

test.describe('Rapid dialog switching', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');

    await page.evaluate((content) => {
      localStorage.setItem('mockapi_file_test-rapid-switch.d', content);
    }, SAMPLE_DIALOG_CONTENT);

    page.on('dialog', async (dialog) => {
      await dialog.accept('test-rapid-switch.d');
    });

    await page.getByRole('button', { name: /Open Single File/i }).click();
    await expect(page.getByRole('heading', { name: 'NPCs' })).toBeVisible({ timeout: 10000 });

    await page.getByText('SLD_99005_Rapid').click();
  });

  test('clicking dialog B immediately after dialog A ends showing dialog B, not dialog A', async ({ page }) => {
    // Click dialog A, then IMMEDIATELY click dialog B — no waiting for A's
    // selection to settle in between. This is the rapid-switch race: dialog
    // A's transition may still be in flight when dialog B is requested.
    await page.getByRole('button', { name: /^DIA_Rapid_A /i }).click();
    await page.getByRole('button', { name: /^DIA_Rapid_B /i }).click();

    // The pane must end up showing dialog B's heading and its action content...
    await expect(page.getByRole('heading', { name: 'DIA_Rapid_B', exact: true })).toBeVisible();
    await expect(page.getByText('DIA_Rapid_B_15_1')).toBeVisible();

    // ...and not a stale mix of dialog A's heading/content.
    await expect(page.getByRole('heading', { name: 'DIA_Rapid_A', exact: true })).not.toBeVisible();
    await expect(page.getByText('DIA_Rapid_A_15_1')).not.toBeVisible();
  });
});
