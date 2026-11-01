import { expect, test } from '@playwright/test';

/**
 * Browser mock-harness spec: a condition body the flat model cannot spell is
 * preserved verbatim as raw text, and the panel must not offer Add Condition
 * beside it — generation emits `conditions` instead of `actions`, so the click
 * would delete the preserved guard (#446).
 *
 * The harness's regex parser reads no condition bodies, so the model the real
 * parser produces for a mixed `&&`/`||` guard is injected.
 */

const DIALOG_PATH = 'project/dialogs/DIA_Raw.d';

const DIALOG_FILE = `//__MOCK_MODEL__${JSON.stringify({
  dialogs: {
    DIA_Raw_Hallo: {
      name: 'DIA_Raw_Hallo',
      parent: 'C_INFO',
      filePath: DIALOG_PATH,
      properties: {
        npc: 'BAU_Farmer',
        nr: 1,
        condition: 'DIA_Raw_Hallo_Condition',
        information: 'DIA_Raw_Hallo_Info',
        permanent: false
      }
    },
    DIA_Raw_Plain: {
      name: 'DIA_Raw_Plain',
      parent: 'C_INFO',
      filePath: DIALOG_PATH,
      properties: {
        npc: 'BAU_Farmer',
        nr: 2,
        condition: 'DIA_Raw_Plain_Condition',
        information: 'DIA_Raw_Plain_Info',
        permanent: false
      }
    }
  },
  functions: {
    DIA_Raw_Hallo_Condition: {
      name: 'DIA_Raw_Hallo_Condition',
      returnType: 'INT',
      calls: [],
      conditions: [],
      actions: [{ type: 'Action', action: 'if (Npc_IsDead(self) && A || B)\n{\n\treturn TRUE;\n};' }]
    },
    DIA_Raw_Hallo_Info: { name: 'DIA_Raw_Hallo_Info', returnType: 'VOID', calls: [], conditions: [], actions: [] },
    DIA_Raw_Plain_Condition: { name: 'DIA_Raw_Plain_Condition', returnType: 'INT', calls: [], conditions: [], actions: [] },
    DIA_Raw_Plain_Info: { name: 'DIA_Raw_Plain_Info', returnType: 'VOID', calls: [], conditions: [], actions: [] }
  },
  constants: {},
  variables: {},
  instances: {},
  hasErrors: false,
  errors: []
})}
// Raw condition guard fixture`;

test('a preserved raw guard offers no Add Condition', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Welcome to Dandelion')).toBeVisible();
  await page.evaluate(({ path, content }) => {
    localStorage.setItem('mockapi_file_' + path, content);
  }, { path: DIALOG_PATH, content: DIALOG_FILE });
  page.on('dialog', async (dialog) => {
    if (dialog.message().includes('project folder path')) await dialog.accept('project/dialogs');
    else await dialog.dismiss();
  });
  await page.getByRole('button', { name: /Open Project/i }).first().click();
  await expect(page.getByText('BAU_Farmer').first()).toBeVisible({ timeout: 15000 });
  await page.getByText('BAU_Farmer').first().click();
  await page.getByRole('button', { name: /DIA_Raw_Hallo/ }).click();
  await expect(page.getByRole('heading', { name: 'DIA_Raw_Hallo', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Expand conditions' }).click();
  await expect(page.getByText(/Npc_IsDead\(self\) && A \|\| B/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add Condition' })).toHaveCount(0);

  // The gate follows the raw text, not the panel: a function the model can
  // spell keeps the button.
  await page.getByRole('button', { name: /DIA_Raw_Plain/ }).click();
  await expect(page.getByRole('heading', { name: 'DIA_Raw_Plain', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Expand conditions' }).click();
  await expect(page.getByRole('button', { name: 'Add Condition' }).first()).toBeVisible();
});
