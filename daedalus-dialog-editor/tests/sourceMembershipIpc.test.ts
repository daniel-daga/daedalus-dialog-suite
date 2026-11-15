/**
 * #568: a script the SRC lists exclude stays out of the index when the watcher
 * or a save asks for its share again. Main owns that decision, so the channel
 * answers `excluded` without reading the file.
 *
 * @jest-environment node
 */

import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import os from 'node:os';
import { setupIpcHandlers } from '../src/main/main';

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
  shell: {},
}));

jest.mock('../src/main/services/serviceRegistry', () => ({
  __parser: { parseSource: jest.fn(async () => ({ instances: {}, functions: {}, hasErrors: false })) },
  __file: { readFile: jest.fn(async () => 'instance A (C_Npc) {};') },
  __project: { isProjectSource: jest.fn(() => true) },
  getServiceRegistry: () => {
    const mock = jest.requireMock('../src/main/services/serviceRegistry') as any;
    return {
      fileService: mock.__file, parserService: mock.__parser, projectService: mock.__project,
      settingsService: {}, fileWatcherService: {}, updaterService: {}, worldService: {}, worldFoldersService: {},
      logService: { log: jest.fn(), getLogFilePath: jest.fn() },
      pathValidator: { validatePathResolved: jest.fn(async () => undefined) },
    };
  },
}));

const electron = jest.requireMock('electron') as { __handlers: Map<string, Handler> };
const registry = jest.requireMock('../src/main/services/serviceRegistry') as any;

describe('project:indexFile and SRC membership (#568)', () => {
  beforeEach(() => {
    electron.__handlers.clear();
    registry.__parser.parseSource.mockClear();
    registry.__file.readFile.mockClear();
    setupIpcHandlers();
  });
  const indexFile = (filePath: string) =>
    electron.__handlers.get('project:indexFile')!({}, { filePath, layouts: {} });

  it('indexes a script the compilation lists include', async () => {
    registry.__project.isProjectSource.mockReturnValue(true);
    const result = await indexFile('/p/Story/Live.d') as { index: { instances: unknown[] } };
    expect(result.index.instances).toEqual([]);
    expect(registry.__parser.parseSource).toHaveBeenCalledTimes(1);
  });

  it('answers excluded, without reading it, for a script they leave out', async () => {
    registry.__project.isProjectSource.mockReturnValue(false);
    expect(await indexFile('/p/AI/Externals.d')).toEqual({ excluded: true });
    expect(registry.__project.isProjectSource).toHaveBeenLastCalledWith('/p/AI/Externals.d');
    expect(registry.__file.readFile).not.toHaveBeenCalled();
    expect(registry.__parser.parseSource).not.toHaveBeenCalled();
  });

  it('answers the membership question for a file that just appeared', async () => {
    registry.__project.isProjectSource.mockReturnValue(false);
    expect(await electron.__handlers.get('project:isProjectSource')!({}, '/p/AI/New.d')).toBe(false);
    await expect(electron.__handlers.get('project:isProjectSource')!({}, 42)).rejects.toThrow();
  });
});
