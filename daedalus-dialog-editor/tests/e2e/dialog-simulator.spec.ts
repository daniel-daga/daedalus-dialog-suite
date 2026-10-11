import { expect, test } from '@playwright/test';

const MODEL = {
  dialogs: {
    DIA_Sim_Start: { name: 'DIA_Sim_Start', parent: 'C_INFO', properties: { npc: 'SLD_SimNpc', nr: 1, condition: 'DIA_Sim_Start_Condition', information: 'DIA_Sim_Start_Info', permanent: false } },
    DIA_Sim_Unknown: { name: 'DIA_Sim_Unknown', parent: 'C_INFO', properties: { npc: 'SLD_SimNpc', nr: 2, condition: 'DIA_Sim_Unknown_Condition', information: 'DIA_Sim_Unknown_Info', important: true, permanent: true } }
  },
  functions: {
    DIA_Sim_Start_Condition: { name: 'DIA_Sim_Start_Condition', returnType: 'INT', calls: [], conditions: [], actions: [] },
    DIA_Sim_Start_Info: { name: 'DIA_Sim_Start_Info', returnType: 'VOID', calls: [], conditions: [], actions: [
      { type: 'DialogLine', speaker: 'other', text: 'Choose a path.', id: 'SIM_START_01' },
      { type: 'Choice', dialogRef: 'DIA_Sim_Start', text: 'Ask again', targetFunction: 'DIA_Sim_Again' },
      { type: 'Choice', dialogRef: 'DIA_Sim_Start', text: 'Leave', targetFunction: 'DIA_Sim_Leave' }
    ] },
    DIA_Sim_Again: { name: 'DIA_Sim_Again', returnType: 'VOID', calls: [], conditions: [], actions: [
      { type: 'DialogLine', speaker: 'other', text: 'The choices remain.', id: 'SIM_AGAIN_01' }
    ] },
    DIA_Sim_Leave: { name: 'DIA_Sim_Leave', returnType: 'VOID', calls: [], conditions: [], actions: [
      { type: 'ClearChoicesAction', dialog: 'DIA_Sim_Start' },
      { type: 'DialogLine', speaker: 'self', text: 'Goodbye.', id: 'SIM_LEAVE_01' }
    ] },
    DIA_Sim_Unknown_Condition: { name: 'DIA_Sim_Unknown_Condition', returnType: 'INT', calls: [], conditions: [
      { type: 'NpcIsDeadCondition', npc: 'SLD_Other', negated: false }
    ], actions: [] },
    DIA_Sim_Unknown_Info: { name: 'DIA_Sim_Unknown_Info', returnType: 'VOID', calls: [], conditions: [], actions: [] }
  },
  constants: {}, variables: { MIS_Sim: { name: 'MIS_Sim' } }, instances: {}, hasErrors: false, errors: []
};

const FILE = `//__MOCK_MODEL__${JSON.stringify(MODEL)}\n// Dialog simulator E2E fixture`;

test('plays a persistent choice menu, backs up, takes another branch, and restarts', async ({ page }) => {
  await page.goto('/');
  await page.evaluate((content) => localStorage.setItem('mockapi_file_dialog-simulator.d', content), FILE);
  page.on('dialog', async (dialog) => dialog.accept('dialog-simulator.d'));
  await page.getByRole('button', { name: /Open Single File/i }).click();
  await expect(page.getByRole('heading', { name: 'NPCs' })).toBeVisible();
  await page.getByText('SLD_SimNpc', { exact: true }).click();
  await page.getByRole('button', { name: /DIA_Sim_Start/ }).click();
  await expect(page.getByRole('heading', { name: 'DIA_Sim_Start', exact: true })).toBeVisible();

  await page.getByTestId('simulator-launch').click();
  await expect(page.getByRole('dialog', { name: 'Dialog simulator' })).toBeVisible();
  await expect(page.getByTestId('simulator-transcript-line')).toContainText('Choose a path.');
  await expect(page.getByTestId('simulator-available-dialogs')).not.toContainText('DIA_Sim_Start');
  await expect(page.getByTestId('simulator-available-dialogs')).toContainText('DIA_Sim_Unknown');
  await expect(page.getByText(/condition unknown/i)).toBeVisible();
  await expect(page.getByText(/important/i)).toBeVisible();

  await page.getByTestId('simulator-choice-0').click();
  await expect(page.getByTestId('simulator-transcript-line')).toHaveCount(2);
  await expect(page.getByText('The choices remain.')).toBeVisible();
  await expect(page.getByTestId('simulator-choice-0')).toContainText('Ask again');
  await expect(page.getByTestId('simulator-choice-1')).toContainText('Leave');

  await page.getByRole('button', { name: 'Back one step' }).click();
  await expect(page.getByTestId('simulator-transcript-line')).toHaveCount(1);
  await expect(page.getByText('The choices remain.')).toHaveCount(0);
  await page.getByTestId('simulator-choice-1').click();
  await expect(page.getByText('Goodbye.')).toBeVisible();
  await expect(page.getByText(/end of dialog/i)).toBeVisible();
  await expect(page.getByTestId('simulator-choice-0')).toHaveCount(0);

  await page.getByTestId('simulator-restart').click();
  await expect(page.getByText('Goodbye.')).toHaveCount(0);
  await expect(page.getByTestId('simulator-transcript-line')).toHaveCount(1);
  await expect(page.getByTestId('simulator-choice-0')).toContainText('Ask again');
  await expect(page.getByTestId('simulator-choice-1')).toContainText('Leave');
});
