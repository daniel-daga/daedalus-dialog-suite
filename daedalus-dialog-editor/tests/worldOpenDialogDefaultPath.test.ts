/**
 * `world:openDialog` should start where the worlds actually are: the Gothic
 * install the user already selected through `world:selectGothicInstall`.
 *
 * @jest-environment node
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { setupIpcHandlers } from '../src/main/main';

type Handler = (event: unknown, ...args: unknown[]) => unknown;
type OpenDialogOptions = { defaultPath?: string; properties?: string[] };

// Every factory below is self-contained: `jest.mock` is hoisted above the
// imports, so a reference to a `const` in this file would be in its TDZ when
// the mocked module is first required. The doubles are read back through
// `jest.requireMock` instead.
jest.mock('electron', () => ({
  __handlers: new Map<string, Handler>(),
  __showOpenDialog: jest.fn(async () => ({ canceled: true, filePaths: [] as string[] })),
  app: {
    getPath: () => os.tmpdir(),
    getVersion: () => '0.0.0-test',
    setPath: () => undefined,
    // Never resolves: keeps the real startup path (createWindow, IPC
    // registration) from running on import. The test calls setupIpcHandlers.
    whenReady: () => new Promise(() => undefined),
    on: () => undefined,
    quit: () => undefined,
  },
  BrowserWindow: class {},
  ipcMain: {
    handle(channel: string, handler: Handler) {
      (jest.requireMock('electron') as { __handlers: Map<string, Handler> }).__handlers.set(channel, handler);
    },
    on: () => undefined,
  },
  get dialog() {
    return { showOpenDialog: (jest.requireMock('electron') as { __showOpenDialog: unknown }).__showOpenDialog };
  },
  shell: {},
}));

jest.mock('fs', () => {
  const actual = jest.requireActual<typeof import('fs')>('fs');
  return { ...actual, existsSync: jest.fn(() => false) };
});

// main.ts constructs one eagerly, and its worker pool would outlive the test.
jest.mock('../src/main/services/ParserService', () => ({ ParserService: class {} }));

jest.mock('../src/main/services/SettingsService', () => ({
  SettingsService: class {
    static getGothicInstallPath = jest.fn(async (): Promise<string | null> => null);
    getGothicInstallPath = () => SettingsServiceMock.getGothicInstallPath();
    setGothicInstallPath = async () => undefined;
    getRecentProjects = async () => [];
  },
}));

const electron = jest.requireMock('electron') as {
  __handlers: Map<string, Handler>;
  __showOpenDialog: jest.Mock<() => Promise<{ canceled: boolean; filePaths: string[] }>>;
};
const { SettingsService: SettingsServiceMock } = jest.requireMock('../src/main/services/SettingsService') as {
  SettingsService: { getGothicInstallPath: jest.Mock<() => Promise<string | null>> };
};
const existsSync = fs.existsSync as unknown as jest.Mock<(p: fs.PathLike) => boolean>;

const INSTALL = path.join('C:', 'Games', 'Gothic II');
const WORLDS = path.join(INSTALL, '_work', 'Data', 'Worlds');

describe('world:openDialog defaultPath', () => {
  beforeEach(() => {
    electron.__handlers.clear();
    electron.__showOpenDialog.mockClear();
    SettingsServiceMock.getGothicInstallPath.mockReset();
    SettingsServiceMock.getGothicInstallPath.mockResolvedValue(null);
    existsSync.mockReset();
    existsSync.mockReturnValue(false);
    setupIpcHandlers();
  });

  async function invokeAndGetOptions(): Promise<OpenDialogOptions> {
    const handler = electron.__handlers.get('world:openDialog');
    expect(handler).toBeDefined();
    await handler!({});
    expect(electron.__showOpenDialog).toHaveBeenCalledTimes(1);
    return electron.__showOpenDialog.mock.calls[0][0] as unknown as OpenDialogOptions;
  }

  it("opens in the install's extracted worlds directory when it exists", async () => {
    SettingsServiceMock.getGothicInstallPath.mockResolvedValue(INSTALL);
    existsSync.mockImplementation((p) => p === WORLDS);

    expect(await invokeAndGetOptions()).toMatchObject({ defaultPath: WORLDS });
  });

  it('falls back to the install root when no worlds directory is extracted', async () => {
    SettingsServiceMock.getGothicInstallPath.mockResolvedValue(INSTALL);

    expect(await invokeAndGetOptions()).toMatchObject({ defaultPath: INSTALL });
  });

  it('passes no defaultPath when no Gothic install is stored', async () => {
    const options = await invokeAndGetOptions();

    expect(options.defaultPath).toBeUndefined();
    // The rest of the picker is unchanged.
    expect(options).toMatchObject({ properties: ['openFile'] });
  });
});
