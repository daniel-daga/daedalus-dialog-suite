import { expect, test, type Locator } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  launchApp,
  seedProjectDir,
  stubOpenDialogsByTitle,
  type AppFixture,
} from './harness';

const PROJECT_DIALOG = 'Select Gothic Mod Project Folder';
const ASSET_SOURCE_DIALOG = 'Select asset source folder';

type ProjectFile = {
  version: 1;
  target: 'g2-notr';
  scriptsRoot: '.';
  worlds: [];
  assetSources: string[];
};

function projectFilePath(projectDir: string): string {
  return path.join(projectDir, `${path.basename(projectDir)}.gothicproject.json`);
}

function writeProjectFile(projectDir: string, assetSources: string[]): string {
  const filePath = projectFilePath(projectDir);
  const config: ProjectFile = {
    version: 1,
    target: 'g2-notr',
    scriptsRoot: '.',
    worlds: [],
    assetSources,
  };
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf8');
  return filePath;
}

async function openProject(fixture: AppFixture, projectDir: string, assetSource?: string): Promise<void> {
  await stubOpenDialogsByTitle(fixture.app, {
    [PROJECT_DIALOG]: [projectDir],
    ...(assetSource ? { [ASSET_SOURCE_DIALOG]: [assetSource] } : {}),
  });
  await fixture.page.getByRole('button', { name: /Open Project/i }).first().click();
}

function sourceRow(dialog: Locator, source: string): Locator {
  return dialog.getByRole('listitem').filter({
    has: dialog.getByText(source, { exact: true }),
  });
}

test.describe('project asset sources', () => {
  let fixture: AppFixture | undefined;
  const extraTempDirs: string[] = [];

  test.afterEach(async () => {
    await fixture?.cleanup();
    fixture = undefined;
    for (const dir of extraTempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('migrates a legacy project and consumes the machine-local Gothic install setting', async () => {
    const projectDir = seedProjectDir(['sample-dialog.d']);
    const gothicInstall = fs.mkdtempSync(path.join(os.tmpdir(), 'dde-e2e-gothic-install-'));
    extraTempDirs.push(gothicInstall);
    fixture = await launchApp({
      settings: { recentProjects: [], gothicInstallPath: gothicInstall },
    });

    await openProject(fixture, projectDir);

    const configPath = projectFilePath(projectDir);
    await expect(async () => {
      expect(JSON.parse(fs.readFileSync(configPath, 'utf8'))).toEqual({
        version: 1,
        target: 'g2-notr',
        scriptsRoot: '.',
        worlds: [],
        assetSources: ['.', gothicInstall],
      });
      const settings = JSON.parse(
        fs.readFileSync(path.join(fixture!.userDataDir, 'settings.json'), 'utf8'),
      );
      expect(settings).not.toHaveProperty('gothicInstallPath');
    }).toPass({ timeout: 20_000 });
  });

  test('adds, reorders, saves, and restores ordered asset sources', async () => {
    const projectDir = seedProjectDir(['sample-dialog.d']);
    const existingSource = fs.mkdtempSync(path.join(os.tmpdir(), 'dde-e2e-assets-existing-'));
    const addedSource = fs.mkdtempSync(path.join(os.tmpdir(), 'dde-e2e-assets-added-'));
    extraTempDirs.push(existingSource, addedSource);
    const configPath = writeProjectFile(projectDir, ['.', existingSource]);
    fixture = await launchApp();
    await openProject(fixture, projectDir, addedSource);

    await fixture.page.getByRole('button', { name: 'Asset sources...' }).click();
    let dialog = fixture.page.getByRole('dialog', { name: /Asset sources/i });
    await expect(dialog).toContainText(/later sources override earlier sources/i);
    await expect(sourceRow(dialog, '.').getByRole('button', { name: /remove/i })).toBeDisabled();

    await dialog.getByRole('button', { name: /Add/i }).click();
    await expect(sourceRow(dialog, addedSource)).toBeVisible();
    await sourceRow(dialog, addedSource).getByRole('button', { name: /Move up/i }).click();

    const orderedSources = dialog.getByRole('listitem');
    await expect(orderedSources.nth(0)).toContainText('.');
    await expect(orderedSources.nth(1)).toContainText(addedSource);
    await expect(orderedSources.nth(2)).toContainText(existingSource);
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();

    await expect(async () => {
      expect(JSON.parse(fs.readFileSync(configPath, 'utf8')).assetSources).toEqual([
        '.',
        addedSource,
        existingSource,
      ]);
    }).toPass({ timeout: 10_000 });

    await fixture.page.getByRole('button', { name: 'Asset sources...' }).click();
    dialog = fixture.page.getByRole('dialog', { name: /Asset sources/i });
    await expect(dialog.getByRole('listitem').nth(0)).toContainText('.');
    await expect(dialog.getByRole('listitem').nth(1)).toContainText(addedSource);
    await expect(dialog.getByRole('listitem').nth(2)).toContainText(existingSource);
  });

  test('keeps a missing source visible as a warning while project editing remains usable', async () => {
    const projectDir = seedProjectDir(['sample-dialog.d']);
    const missingSource = path.join(projectDir, 'assets-that-do-not-exist');
    writeProjectFile(projectDir, ['.', missingSource]);
    fixture = await launchApp();
    await openProject(fixture, projectDir);

    const warning = fixture.page.getByRole('alert').filter({ hasText: missingSource });
    await expect(warning).toBeVisible({ timeout: 20_000 });
    await expect(fixture.page.getByText('SLD_99005_Arog')).toBeVisible({ timeout: 20_000 });

    await fixture.page.getByRole('button', { name: 'Asset sources...' }).click();
    const dialog = fixture.page.getByRole('dialog', { name: /Asset sources/i });
    await expect(sourceRow(dialog, missingSource)).toBeVisible();
    await expect(sourceRow(dialog, missingSource).getByRole('button', { name: /remove/i })).toBeEnabled();
    await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeEnabled();
  });
});
