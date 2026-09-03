/** @jest-environment node */

import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import { setupIpcHandlers } from '../src/main/main';
import { ProjectConfigService } from '../src/main/services/ProjectConfigService';

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
  __settings: { getGothicInstallPath: jest.fn(async () => null), setGothicInstallPath: jest.fn(async () => undefined), clearGothicInstallPath: jest.fn(async () => undefined), getRecentProjects: jest.fn(async () => []) },
  __worldService: { openWorld: jest.fn(async () => ({ worldPath: 'test', stats: {} })) },
  getServiceRegistry: () => ({
    fileService: {}, parserService: {}, codeGeneratorService: {}, validationService: {}, projectService: {},
    settingsService: (jest.requireMock('../src/main/services/serviceRegistry') as any).__settings,
    fileWatcherService: {}, updaterService: {}, worldService: (jest.requireMock('../src/main/services/serviceRegistry') as any).__worldService, worldFoldersService: {},
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

/** A folder shaped like a Gothic install, and the setting pointed at it (§9). */
async function useInstall() {
  const install = await fs.mkdtemp(path.join(os.tmpdir(), 'dde-install-'));
  await fs.mkdir(path.join(install, 'Data'), { recursive: true });
  await fs.writeFile(path.join(install, 'Data', 'Textures.vdf'), 'archive');
  registry.__settings.getGothicInstallPath.mockResolvedValue(install);
  return { install, archive: path.join(install, 'Data', 'Textures.vdf') };
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
    registry.__settings.setGothicInstallPath.mockClear();
    registry.__settings.clearGothicInstallPath.mockClear();
    registry.__worldService.openWorld.mockClear();
    setupIpcHandlers();
  });

  it('loads only an already-allowed root and warns about a machine install that is gone', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dde-ipc-migrate-'));
    const missing = path.join(root, 'missing-install');
    registry.__settings.getGothicInstallPath.mockResolvedValue(missing);

    const opened = await invoke('project:loadConfig', root) as any;

    expect(registry.__pathValidator.validatePathResolved).toHaveBeenCalledWith(root);
    expect(opened.warnings).toEqual([expect.objectContaining({
      code: 'gothic-install-unavailable', source: missing,
    })]);
    expect(opened.gothicInstallPath).toBeNull();
    // The setting is machine state now (§9), never cleared behind the user.
    expect(registry.__settings.clearGothicInstallPath).not.toHaveBeenCalled();
  });

  it('mounts the machine install under the project`s own sources', async () => {
    const { install, archive } = await useInstall();
    const project = await makeProject();

    const opened = await invoke('project:loadConfig', project.root) as any;

    expect(opened.gothicInstallPath).toBe(install);
    expect(opened.resolvedAssetSources).toEqual([archive, project.root]);
    // Not written into the project file: it is not the project's fact.
    expect(opened.config.assetSources).toEqual(['.']);
  });

  it('does not clear legacy state when migration fails', async () => {
    registry.__pathValidator.validatePathResolved.mockRejectedValueOnce(new Error('not allowed'));
    await expect(invoke('project:loadConfig', 'C:/untrusted')).rejects.toThrow(/not allowed/);
    expect(registry.__settings.clearGothicInstallPath).not.toHaveBeenCalled();
  });

  it('adopts an install-shaped source from the project file into the setting', async () => {
    // Project files written while the install lived in the list (§16.28) hand
    // it over on the next open: the entry stays, but the machine now knows.
    const install = await fs.mkdtemp(path.join(os.tmpdir(), 'dde-configured-install-'));
    await fs.mkdir(path.join(install, 'Data'), { recursive: true });
    await fs.writeFile(path.join(install, 'Data', 'Textures.vdf'), 'archive');
    const project = await makeProject(['.', install]);

    const opened = await invoke('project:loadConfig', project.root) as any;

    expect(registry.__settings.setGothicInstallPath).toHaveBeenCalledWith(install);
    expect(opened.gothicInstallPath).toBe(install);
    // Mounted once, and as the base rather than over the project's own folders.
    expect(opened.resolvedAssetSources).toEqual([path.join(install, 'Data', 'Textures.vdf'), project.root]);
  });

  it('does not promote configured absolute or symlink-resolved sources into the generic whitelist', async () => {
    const external = await fs.mkdtemp(path.join(os.tmpdir(), 'dde-declared-external-'));
    const project = await makeProject(['.', external]);
    const escaped = await fs.mkdtemp(path.join(os.tmpdir(), 'dde-symlink-external-'));
    const link = path.join(project.root, 'linked-assets');
    try {
      await fs.symlink(escaped, link, process.platform === 'win32' ? 'junction' : 'dir');
    } catch {
      return;
    }
    await fs.writeFile(project.projectFilePath, JSON.stringify({ version: 1, target: 'g2-notr', scriptsRoot: '.', worlds: [], assetSources: ['.', external, 'linked-assets'] }));

    await invoke('project:loadConfig', project.root);

    expect(registry.__pathValidator.addAllowedPath).not.toHaveBeenCalledWith(external);
    expect(registry.__pathValidator.addAllowedPath).not.toHaveBeenCalledWith(escaped);
    expect(registry.__pathValidator.addAllowedPath).not.toHaveBeenCalledWith(link);
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

  it('holds the GMBT project folder to the same picker rule as an asset source (§16.29)', async () => {
    const project = await makeProject();
    await invoke('project:loadConfig', project.root);
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'dde-gmbt-'));

    await expect(invoke('project:saveAssetSources', project.projectFilePath, ['.'], outside))
      .rejects.toThrow(/native folder picker/i);
    await expect(invoke('project:saveAssetSources', project.projectFilePath, ['.'], '../escape'))
      .rejects.toThrow(/within the project folder/i);
    await expect(invoke('project:saveAssetSources', project.projectFilePath, ['.'], 42))
      .rejects.toThrow(/GMBT project folder/i);

    electron.__showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [outside] });
    expect(await invoke('project:selectAssetSourceFolder')).toBe(outside);
    await expect(invoke('project:saveAssetSources', project.projectFilePath, ['.'], outside))
      .resolves.toMatchObject({ config: { gmbtProjectDir: outside } });

    // Cleared to null, and a re-save with it omitted leaves what is there.
    await expect(invoke('project:saveAssetSources', project.projectFilePath, ['.'], null))
      .resolves.toMatchObject({ gmbtProjectDir: null });
  });

  // level-editor.md §16.31: the GMBT folders sit *beside* the project folder,
  // so "Add from GMBT" saves `../thirdparty` — main derived those paths itself,
  // which is what makes them savable without a trip through the picker.
  it('saves a relative source that leaves the project folder when the GMBT project declares it', async () => {
    const gmbtRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dde-gmbt-'));
    await fs.mkdir(path.join(gmbtRoot, 'mod'));
    await fs.mkdir(path.join(gmbtRoot, 'thirdparty'));
    await fs.writeFile(path.join(gmbtRoot, '.gmbt.yml'), `modFiles:
  assets:
    - mod
    - thirdparty
`);
    const projectFilePath = path.join(gmbtRoot, 'mod', 'mod.gothicproject.json');
    await fs.writeFile(projectFilePath, JSON.stringify({
      version: 1, target: 'g2-notr', scriptsRoot: '.', worlds: [], assetSources: ['.'],
    }));

    const opened = await invoke('project:loadConfig', path.join(gmbtRoot, 'mod')) as any;
    expect(opened.gmbtAssetSources).toEqual(['../thirdparty']);
    // Adopted on open, and it escapes the project folder too.
    expect(opened.config.gmbtProjectDir).toBe('..');

    await expect(invoke(
      'project:saveAssetSources', opened.projectFilePath, ['.', '../thirdparty'], '..',
    )).resolves.toMatchObject({ config: { assetSources: ['.', '../thirdparty'] } });

    // Everything else outside the project folder is still refused.
    await expect(invoke('project:saveAssetSources', opened.projectFilePath, ['.', '../mdk']))
      .rejects.toThrow(/stay within the project folder/i);
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

  it('returns null and grants nothing when the launching project registration was replaced', async () => {
    const project = await makeProject();
    const picked = await fs.mkdtemp(path.join(os.tmpdir(), 'dde-stale-picker-assets-'));
    let resolvePicker!: (result: { canceled: boolean; filePaths: string[] }) => void;
    electron.__showOpenDialog.mockImplementationOnce(() => new Promise((resolve) => { resolvePicker = resolve; }));
    await invoke('project:loadConfig', project.root);
    const pendingSelection = invoke('project:selectAssetSourceFolder');
    await invoke('project:loadConfig', project.root);
    resolvePicker({ canceled: false, filePaths: [picked] });

    await expect(pendingSelection).resolves.toBeNull();
    expect(registry.__pathValidator.addAllowedPath).not.toHaveBeenCalledWith(picked);
    await expect(invoke('project:saveAssetSources', project.projectFilePath, ['.', picked]))
      .rejects.toThrow(/native folder picker/i);
  });

  it('rejects opening a stale project after another project becomes active', async () => {
    const first = await makeProject();
    const second = await makeProject();
    await invoke('project:loadConfig', first.root);
    await invoke('project:loadConfig', second.root);

    await expect(invoke('world:open', {
      worldPath: path.join(second.root, 'World.zen'),
      gameVersion: 'g2',
      projectFilePath: first.projectFilePath,
    })).rejects.toThrow(/active project/i);

    await expect(invoke('project:saveAssetSources', second.projectFilePath, ['.']))
      .resolves.toMatchObject({ projectFilePath: second.projectFilePath });
  });

  it('rejects when another project becomes active during descriptor reload', async () => {
    const first = await makeProject();
    const second = await makeProject();
    await invoke('project:loadConfig', first.root);
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const original = ProjectConfigService.prototype.openOrMigrate;
    const reload = jest.spyOn(ProjectConfigService.prototype, 'openOrMigrate')
      .mockImplementationOnce(async (...args) => {
        await blocked;
        return original.apply(ProjectConfigService.prototype, args);
      });

    const opening = invoke('world:open', {
      worldPath: path.join(first.root, 'World.zen'), gameVersion: 'g2', projectFilePath: first.projectFilePath,
    });
    await Promise.resolve();
    await invoke('project:loadConfig', second.root);
    release();

    await expect(opening).rejects.toThrow(/project changed|active project/i);
    await expect(invoke('project:saveAssetSources', second.projectFilePath, ['.']))
      .resolves.toMatchObject({ projectFilePath: second.projectFilePath });
    reload.mockRestore();
  });

  it('rejects when another project becomes active during source validation', async () => {
    const first = await makeProject();
    const second = await makeProject();
    await invoke('project:loadConfig', first.root);
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    registry.__pathValidator.validatePathResolved.mockImplementation(async (candidate: string) => {
      if (candidate.endsWith('World.zen')) await blocked;
    });

    const opening = invoke('world:open', {
      worldPath: path.join(first.root, 'World.zen'), gameVersion: 'g2', projectFilePath: first.projectFilePath,
    });
    await Promise.resolve();
    await invoke('project:loadConfig', second.root);
    release();

    await expect(opening).rejects.toThrow(/project changed|active project/i);
    await expect(invoke('project:saveAssetSources', second.projectFilePath, ['.']))
      .resolves.toMatchObject({ projectFilePath: second.projectFilePath });
  });

  it('dispatches a world open when the active project remains unchanged', async () => {
    const { archive } = await useInstall();
    const project = await makeProject();
    await invoke('project:loadConfig', project.root);
    const summary = { worldPath: 'test', stats: {} };
    registry.__worldService.openWorld.mockResolvedValueOnce(summary);

    await expect(invoke('world:open', {
      worldPath: path.join(project.root, 'World.zen'), gameVersion: 'g2', projectFilePath: project.projectFilePath,
    })).resolves.toEqual(summary);
    expect(registry.__worldService.openWorld).toHaveBeenCalledWith(expect.objectContaining({
      worldPath: path.join(project.root, 'World.zen'), gameVersion: 'g2',
      assetSources: [archive, project.root],
    }));
  });

  it('opens with a configured external source without generic whitelisting', async () => {
    const { archive } = await useInstall();
    const external = await fs.mkdtemp(path.join(os.tmpdir(), 'dde-world-external-'));
    const project = await makeProject(['.', external]);
    await invoke('project:loadConfig', project.root);
    const worldPath = path.join(project.root, 'World.zen');
    registry.__pathValidator.validatePathResolved.mockImplementation(async (candidate: string) => {
      if (candidate === external) throw new Error('external source is not generic renderer-approved');
      if (candidate.endsWith('unrelated.zen')) throw new Error('outside project');
    });
    const summary = { worldPath, stats: {} };
    registry.__worldService.openWorld.mockResolvedValueOnce(summary);

    await expect(invoke('world:open', { worldPath, gameVersion: 'g2', projectFilePath: project.projectFilePath }))
      .resolves.toEqual(summary);
    expect(registry.__worldService.openWorld).toHaveBeenCalledWith(expect.objectContaining({ assetSources: [archive, project.root, external] }));
    await expect(invoke('world:open', {
      worldPath: path.join(os.tmpdir(), 'unrelated.zen'), gameVersion: 'g2', projectFilePath: project.projectFilePath,
    })).rejects.toThrow(/generic renderer-approved|outside/i);
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
