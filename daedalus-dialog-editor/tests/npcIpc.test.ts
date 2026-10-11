/**
 * The NPC editor's two IPC channels (docs/plans/npc-editor.md, Phase 2): both
 * are validated here and answered by the parser pool, never parsed in main.
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
  __parser: {
    extractNpc: jest.fn(async () => ({ name: 'A', parent: 'C_Npc', statements: [], closingBraceIndex: 0 })),
    applyNpcEdits: jest.fn(async () => 'patched'),
  },
  getServiceRegistry: () => ({
    fileService: {}, parserService: (jest.requireMock('../src/main/services/serviceRegistry') as any).__parser,
    codeGeneratorService: {}, validationService: {}, projectService: {}, settingsService: {},
    fileWatcherService: {}, updaterService: {}, worldService: {}, worldFoldersService: {},
    logService: { log: jest.fn(), getLogFilePath: jest.fn() },
    pathValidator: {},
  }),
}));

const electron = jest.requireMock('electron') as { __handlers: Map<string, Handler> };
const registry = jest.requireMock('../src/main/services/serviceRegistry') as any;

async function invoke(channel: string, ...args: unknown[]) {
  const handler = electron.__handlers.get(channel);
  expect(handler).toBeDefined();
  return handler!({}, ...args);
}

describe('NPC editor IPC', () => {
  beforeEach(() => {
    electron.__handlers.clear();
    registry.__parser.extractNpc.mockClear();
    registry.__parser.applyNpcEdits.mockClear();
    setupIpcHandlers();
  });

  it('npc:extract hands the source to the parser pool', async () => {
    const result = await invoke('npc:extract', 'instance A (C_Npc) {};');
    expect(registry.__parser.extractNpc).toHaveBeenCalledWith('instance A (C_Npc) {};');
    expect(result).toMatchObject({ name: 'A' });
  });

  it('npc:extract refuses a non-string before reaching the pool', async () => {
    await expect(invoke('npc:extract', 42)).rejects.toThrow(/NPC/);
    expect(registry.__parser.extractNpc).not.toHaveBeenCalled();
  });

  it('npc:applyEdits validates, then hands source and edits to the pool', async () => {
    const edits = [{ op: 'set', field: 'guild', value: 'GIL_SLD' }];
    const result = await invoke('npc:applyEdits', { sourceText: 'src', edits });
    expect(registry.__parser.applyNpcEdits).toHaveBeenCalledWith('src', edits);
    expect(result).toBe('patched');
  });

  it('npc:applyEdits refuses an edit that would span lines', async () => {
    await expect(invoke('npc:applyEdits', {
      sourceText: 'src', edits: [{ op: 'set', field: 'guild', value: 'A;\nB' }],
    })).rejects.toThrow(/value/);
    expect(registry.__parser.applyNpcEdits).not.toHaveBeenCalled();
  });
});
