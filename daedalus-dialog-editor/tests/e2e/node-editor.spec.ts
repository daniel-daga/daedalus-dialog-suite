import { expect, test } from '@playwright/test';

test.describe('Node editor playground', () => {
  test('loads isolated quest flow with mock data', async ({ page }) => {
    await page.goto('/node-editor.html');

    await expect(page.getByText('Quest Node Editor Playground')).toBeVisible();
    await expect(page.getByText('TOPIC_DRAGONHUNT')).toBeVisible();

    await expect(page.locator('.react-flow__node')).toHaveCount(8);

    await page.getByTestId('node-editor-quest-select').click();
    await page.getByRole('option', { name: 'TOPIC_GUILDJOIN' }).click();

    await expect(page.locator('.react-flow__node')).toHaveCount(5);
  });

  test('renders multiple condition nodes and condition edges for dialogs with multiple conditions', async ({ page }) => {
    await page.goto('/node-editor.html');

    const startDialogFunctionName = 'DIA_DragonHunt_Start_Info';
    const relatedConditionNodes = page.locator(
      `.react-flow__node[data-id^="condition-${startDialogFunctionName}-"]`
    );
    const relatedConditionEdges = page.locator(
      `.react-flow__edge[data-id^="condition-edge-condition-${startDialogFunctionName}-"][data-id$="-${startDialogFunctionName}"]`
    );

    await expect(relatedConditionNodes).toHaveCount(2);
    await expect(relatedConditionEdges).toHaveCount(2);
  });
});
