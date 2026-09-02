/** @jest-environment node */

import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import { setupIpcHandlers } from '../src/main/main';

type Handler = (event: unknown, ...args: unknown[]) => unknown;

jest.mock('electron', () => ({
  __handlers: new Map<string, Handler>(),
  __showOpenDialog: jest.fn(async () => ({ canceled: true, filePaths: [] as string[] })),
  app: { getPath: () => os.tmpdir(), getVersion: () => 'test', setPath: () => undefined,
    whenReady: () => new Promise(() => undefined), on: () => undefined, quit: () => undefined },
  BrowserWindow: class {},
  ipcMain: { handle(channel: string, handler: Handler) {
    (jest.requireMock('electron') as { __handlers: Map<string, Handler> }).__handlers.set(channel, handler);
  }, on: () => undefined },
  get dialog() { return { showOpenDialog: (jest.requireMock('electron') as any).__showOpenDialog }; },
  shell: {},
}));

jest.mock('../src/main/services/serviceRegistry', () => ({
  __pathValidator: { validatePathResolved: jest.fn(async () => undefined), addAllowedPath: jest.fn(), addAllowedFile: jest.fn() },
  __settings: { getGothicInstallPath: jest.fn(async () => null), clearGothicInstallPath: jest.fn(async () => undefined), getRecentProjects: jest.fn(async () => []) },
  getServiceRegistry: () => ({
    fileService: {}, parserService: {}, codeGeneratorService: {}, validationService: {}, projectService: {},
    settingsService: (jest.requireMock('../src/main/services/serviceRegistry') as any).__settings,
    fileWatcherService: {}, updaterService: {}, worldService: {}, worldFoldersService: {},
    logService: { log: jest.fn(), getLogFilePath: jest.fn() },
    pathValidator: (jest.requireMock('../src/main/services/serviceRegistry') as any).__pathValidator,
  }),
}));

const electron = jest.requireMock('electron') as { __handlers: Map<string, Handler>; __showOpenDialog: jest.Mock };
const registry = jest.requireMock('../src/main/services/serviceRegistry') as any;

async function invoke(channel: string, ...args: unknown[]) {
  const handler = electron.__handlers.get(channel);
  expect(handler).toBeDefined();
  return handler!({}, ...args);
}

async function makeProject(assetSources: string[] = ['.']) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dde-ipc-project-'));
  const projectFilePath = path.join(root, `${path.basename(root)}.gothicproject.json`);
  await fs.writeFile(projectFilePath, JSON.stringify({ version: 1, target: 'g2-notr', scriptsRoot: '.', worlds: [], assetSources }));
  return { root, projectFilePath };
}

describe('project config IPC', () => {
  beforeEach(() => {
    electron.__handlers.clear();
    electron.__showOpenDialog.mockReset().mockResolvedValue({ canceled: true, filePaths: [] });
    registry.__pathValidator.validatePathResolved.mockClear();
    registry.__pathValidator.addAllowedPath.mockClear();
    registry.__settings.getGothicInstallPath.mockReset().mockResolvedValue(null);
    registry.__settings.clearGothicInstallPath.mockClear();
    setupIpcHandlers();
  });

  it('loads only an already-allowed root, migrates, returns warnings, and clears legacy state after commit', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dde-ipc-migrate-'));
    const missing = path.join(root, 'missing-assets');
    registry.__settings.getGothicInstallPath.mockResolvedValue(missing);

    const opened = await invoke('project:loadConfig', root) as any;

    expect(registry.__pathValidator.validatePathResolved).toHaveBeenCalledWith(root);
    expect(opened.warnings).toEqual([expect.objectContaining({ source: missing })]);
    expect(registry.__settings.clearGothicInstallPath).toHaveBeenCalledTimes(1);
  });

  it('does not clear legacy state when migration fails', async () => {
    registry.__pathValidator.validatePathResolved.mockRejectedValueOnce(new Error('not allowed'));
    await expect(invoke('project:loadConfig', 'C:/untrusted')).rejects.toThrow(/not allowed/);
    expect(registry.__settings.clearGothicInstallPath).not.toHaveBeenCalled();
  });

  it('allows a native-picked external folder for the current project only', async () => {
    const first = await makeProject();
    const second = await makeProject();
    await invoke('project:loadConfig', first.root);
    const picked = await fs.mkdtemp(path.join(os.tmpdir(), 'dde-picked-assets-'));
    electron.__showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [picked] });
    expect(await invoke('project:selectAssetSourceFolder')).toBe(picked);
    expect(registry.__pathValidator.addAllowedPath).toHaveBeenCalledWith(picked);
    await expect(invoke('project:saveAssetSources', first.projectFilePath, ['.', picked])).resolves.toMatchObject({ config: { assetSources: ['.', picked] } });

    await invoke('project:loadConfig', second.root);
    await expect(invoke('project:saveAssetSources', second.projectFilePath, ['.', picked])).rejects.toThrow(/native folder picker/i);
  });

  it('grants a folder to the project that opened the picker when another project loads meanwhile', async () => {
    const first = await makeProject();
    const second = await makeProject();
    const picked = await fs.mkdtemp(path.join(os.tmpdir(), 'dde-interleaved-assets-'));
    let resolvePicker!: (result: { canceled: boolean; filePaths: string[] }) => void;
    electron.__showOpenDialog.mockImplementationOnce(() => new Promise((resolve) => { resolvePicker = resolve; }));

    await invoke('project:loadConfig', first.root);
    const pendingSelection = invoke('project:selectAssetSourceFolder');
    await invoke('project:loadConfig', second.root);
    resolvePicker({ canceled: false, filePaths: [picked] });
    await expect(pendingSelection).resolves.toBe(picked);

    await expect(invoke('project:saveAssetSources', second.projectFilePath, ['.', picked])).rejects.toThrow(/native folder picker/i);
    await expect(invoke('project:saveAssetSources', first.projectFilePath, ['.', picked])).resolves.toMatchObject({
      config: { assetSources: ['.', picked] },
    });
  });

  it('rejects malformed arrays, missing root, unknown files, and ungranted absolute paths', async () => {
    const project = await makeProject();
    await invoke('project:loadConfig', project.root);
    await expect(invoke('project:saveAssetSources', project.projectFilePath, '.')).rejects.toThrow(/assetSources/);
    await expect(invoke('project:saveAssetSources', project.projectFilePath, [])).rejects.toThrow(/include "\."/);
    await expect(invoke('project:saveAssetSources', path.join(project.root, 'other.gothicproject.json'), ['.'])).rejects.toThrow(/loaded project/i);
    await expect(invoke('project:saveAssetSources', project.projectFilePath, ['.', path.join(os.tmpdir(), 'not-picked')])).rejects.toThrow(/native folder picker/i);
  });

  it('re-reads disk state and preserves every field except assetSources', async () => {
    const project = await makeProject();
    await invoke('project:loadConfig', project.root);
    const disk = JSON.parse(await fs.readFile(project.projectFilePath, 'utf8'));
    disk.target = 'g1';
    await fs.writeFile(project.projectFilePath, JSON.stringify(disk));

    const result = await invoke('project:saveAssetSources', project.projectFilePath, ['.']) as any;
    expect(result.config.target).toBe('g1');
    expect(JSON.parse(await fs.readFile(project.projectFilePath, 'utf8')).target).toBe('g1');
  });
});
