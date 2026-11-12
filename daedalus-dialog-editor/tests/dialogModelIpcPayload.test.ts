/**
 * The model every renderer-facing IPC path returns carries no `callSites`, and
 * the index a file returns is still built from them (#541). The handlers are
 * registered against a stubbed `electron`, as in npcIpc.test.ts.
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

const parsedModel = () => ({
  dialogs: { DIA_Test: { properties: { information: 'DIA_Test_Info' } } },
  functions: {
    DIA_Test_Info: {
      name: 'DIA_Test_Info',
      returnType: 'VOID',
      calls: ['AI_Output'],
      callSites: [{
        functionName: 'AI_Output',
        args: [{ raw: 'self', value: 'self', isString: false }],
        position: { startLine: 2, startColumn: 3, endLine: 2, endColumn: 31 },
      }],
      actions: [],
      conditions: [],
    },
    Spawner: {
      name: 'Spawner',
      returnType: 'VOID',
      calls: ['Wld_InsertNpc'],
      callSites: [{
        functionName: 'Wld_InsertNpc',
        args: [
          { raw: 'VLK_400_Bauer', value: 'VLK_400_Bauer', isString: false },
          { raw: '"WP_START"', value: 'WP_START', isString: true },
        ],
        position: { startLine: 9, startColumn: 3, endLine: 9, endColumn: 44 },
      }],
      actions: [],
      conditions: [],
    },
  },
  instances: {},
  prototypes: {},
  hasErrors: false,
  errors: [],
});

jest.mock('../src/main/services/serviceRegistry', () => {
  const registry = {
    __model: null as unknown,
    parserService: { parseSource: jest.fn(async () => registry.__model) },
    fileService: { readFile: jest.fn(async () => 'source') },
    codeGeneratorService: {}, validationService: {},
    projectService: { takeParsedModel: jest.fn(async () => null) },
    settingsService: {}, fileWatcherService: {}, updaterService: {}, worldService: {},
    worldFoldersService: { sidecarPath: (p: string) => `${p}.folders.json` },
    thumbnailCacheService: {}, assetCatalogService: {},
    logService: { log: jest.fn(), getLogFilePath: jest.fn() },
    pathValidator: { validatePathResolved: async () => undefined },
  };
  return { __registry: registry, getServiceRegistry: () => registry };
});

const electron = jest.requireMock('electron') as { __handlers: Map<string, Handler> };
const registry = (jest.requireMock('../src/main/services/serviceRegistry') as { __registry: any }).__registry;

async function invoke(channel: string, ...args: unknown[]) {
  const handler = electron.__handlers.get(channel);
  expect(handler).toBeDefined();
  return handler!({}, ...args);
}

describe('renderer-facing model payloads', () => {
  let model: ReturnType<typeof parsedModel>;

  beforeEach(() => {
    electron.__handlers.clear();
    // The handlers hold the module's service references, so the model is
    // swapped through the mock the parser is mocked to answer with.
    model = parsedModel();
    registry.__model = model;
    registry.parserService.parseSource.mockClear();
    registry.projectService.takeParsedModel.mockResolvedValue(null);
    setupIpcHandlers();
  });

  it('parser:parseSource drops call sites but keeps the calls list', async () => {
    const result = await invoke('parser:parseSource', 'func void f() {};') as any;

    expect(result.functions.DIA_Test_Info).not.toHaveProperty('callSites');
    expect(result.functions.DIA_Test_Info.calls).toEqual(['AI_Output']);
    // The main process model is not mutated: the index still has its sites.
    expect(model.functions.DIA_Test_Info.callSites).toHaveLength(1);
  });

  it('project:parseDialogFile drops call sites from a freshly parsed file', async () => {
    const result = await invoke('project:parseDialogFile', 'C:/project/DIA_Test.d') as any;

    expect(result.functions.Spawner).not.toHaveProperty('callSites');
    expect(result.dialogs.DIA_Test.properties.information).toBe('DIA_Test_Info');
  });

  it('project:parseDialogFile also drops them from the model the index build primed', async () => {
    registry.projectService.takeParsedModel.mockResolvedValueOnce(model);

    const result = await invoke('project:parseDialogFile', 'C:/project/DIA_Test.d') as any;

    expect(result.functions.DIA_Test_Info).not.toHaveProperty('callSites');
    expect(registry.parserService.parseSource).not.toHaveBeenCalled();
  });

  it('project:indexFile builds the index from the calls it then drops', async () => {
    const result = await invoke('project:indexFile', {
      filePath: 'C:/project/Spawner.d',
      layouts: {},
    }) as any;

    expect(result.model.functions.Spawner).not.toHaveProperty('callSites');
    expect(result.index.spawnSites).toEqual([{
      instance: 'VLK_400_BAUER',
      spawnPoint: 'WP_START',
      filePath: 'C:/project/Spawner.d',
      functionName: 'Spawner',
      line: 9,
    }]);
  });
});
