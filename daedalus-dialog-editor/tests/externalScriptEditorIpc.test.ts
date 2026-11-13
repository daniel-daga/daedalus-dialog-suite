/** @jest-environment node */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import * as fs from 'fs/promises';
import * as path from 'path';
import os from 'node:os';
import { setupIpcHandlers } from '../src/main/main';
import { PathValidationService } from '../src/main/services/PathValidationService';

type Handler = (event: unknown, ...args: unknown[]) => unknown;
jest.mock('electron', () => ({
  __handlers: new Map<string, Handler>(),
  app: { getPath: () => os.tmpdir(), getVersion: () => 'test', setPath: () => undefined,
    whenReady: () => new Promise(() => undefined), on: () => undefined, quit: () => undefined },
  BrowserWindow: class {},
  ipcMain: { handle(channel: string, handler: Handler) {
    (jest.requireMock('electron') as { __handlers: Map<string, Handler> }).__handlers.set(channel, handler);
  }, on: () => undefined },
  dialog: {},
  shell: { openPath: jest.fn(async () => '') },
}));

const mockValidator = { current: new PathValidationService([]) };
jest.mock('../src/main/services/serviceRegistry', () => ({
  getServiceRegistry: () => ({
    fileService: {}, parserService: {}, projectService: {}, settingsService: {},
    fileWatcherService: {}, updaterService: {}, worldService: {}, worldFoldersService: {},
    logService: { log: jest.fn(), getLogFilePath: jest.fn() },
    pathValidator: { validatePathResolved: (filePath: string) => mockValidator.current.validatePathResolved(filePath) },
  }),
}));

const electron = jest.requireMock('electron') as {
  __handlers: Map<string, Handler>;
  shell: { openPath: jest.Mock<(filePath: string) => Promise<string>> };
};
async function invoke(filePath: unknown): Promise<unknown> {
  const handler = electron.__handlers.get('file:openScriptInExternalEditor');
  expect(handler).toBeDefined();
  return handler!({}, filePath);
}

describe('external script editor IPC', () => {
  let directory: string;
  let script: string;
  beforeEach(async () => {
    await fs.mkdir(path.join(os.tmpdir(), 'opencode'), { recursive: true });
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'opencode', 'script-editor-'));
    script = path.join(directory, 'test.d');
    await fs.writeFile(script, 'FUNC VOID Test() {};');
    mockValidator.current = new PathValidationService([]);
    mockValidator.current.addAllowedFile(script);
    electron.shell.openPath.mockReset().mockResolvedValue('');
    setupIpcHandlers();
  });
  afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }); });

  it('opens the permitted script using its resolved path', async () => {
    await invoke(script);
    expect(electron.shell.openPath).toHaveBeenCalledWith(await fs.realpath(script));
  });
  it('rejects malformed, ungranted and non-script paths before launching anything', async () => {
    await expect(invoke(42)).rejects.toThrow();
    const outside = path.join(directory, 'outside.d');
    await fs.writeFile(outside, '');
    await expect(invoke(outside)).rejects.toThrow(/allowed/i);
    const executable = path.join(directory, 'tool.exe');
    await fs.writeFile(executable, '');
    mockValidator.current.addAllowedFile(executable);
    await expect(invoke(executable)).rejects.toThrow(/\.d/);
    expect(electron.shell.openPath).not.toHaveBeenCalled();
  });
  it('rejects directories with a script extension', async () => {
    const folder = path.join(directory, 'folder.d');
    await fs.mkdir(folder);
    mockValidator.current.addAllowedPath(folder);
    await expect(invoke(folder)).rejects.toThrow(/file/i);
    expect(electron.shell.openPath).not.toHaveBeenCalled();
  });
  it('reports a missing file or failed OS association instead of claiming success', async () => {
    electron.shell.openPath.mockResolvedValue('No application associated with .d');
    await expect(invoke(script)).rejects.toThrow(/No application/);
    electron.shell.openPath.mockClear();
    await fs.unlink(script);
    await expect(invoke(script)).rejects.toThrow();
    expect(electron.shell.openPath).not.toHaveBeenCalled();
  });
});
