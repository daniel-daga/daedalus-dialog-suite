/**
 * `world:save` overwrites exactly the world held by WorldService. The renderer
 * supplies no path, so a compromised renderer cannot redirect a save to a
 * sibling file that merely happens to be readable.
 *
 * @jest-environment node
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { setupIpcHandlers } from '../src/main/main';

type Handler = (event: unknown, ...args: unknown[]) => unknown;

jest.mock('electron', () => ({
  __handlers: new Map<string, Handler>(),
  __showOpenDialog: jest.fn(async () => ({ canceled: true, filePaths: [] as string[] })),
  __showSaveDialog: jest.fn(async () => ({ canceled: true, filePath: undefined as string | undefined })),
  app: {
    getPath: () => os.tmpdir(),
    getVersion: () => '0.0.0-test',
    setPath: () => undefined,
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
    const mock = jest.requireMock('electron') as { __showOpenDialog: unknown; __showSaveDialog: unknown };
    return { showOpenDialog: mock.__showOpenDialog, showSaveDialog: mock.__showSaveDialog };
  },
  shell: {},
}));

jest.mock('../src/main/services/SettingsService', () => ({
  SettingsService: class {
    getGothicInstallPath = async (): Promise<string | null> => null;
    setGothicInstallPath = async () => undefined;
    getRecentProjects = async () => [];
  },
}));

/** The one call under test: which target the service was actually asked for. */
jest.mock('../src/main/services/WorldService', () => ({
  WorldService: class {
    static saved: string[] = [];
    static opened: string | null = null;
    saveWorld = async (target: string) => {
      (jest.requireMock('../src/main/services/WorldService') as {
        WorldService: { saved: string[] };
      }).WorldService.saved.push(target);
    };
    openWorldPath = () => {
      const opened = (jest.requireMock('../src/main/services/WorldService') as {
        WorldService: { opened: string | null };
      }).WorldService.opened;
      if (opened === null) throw new Error('No world is open');
      return opened;
    };
    close = () => undefined;
  },
}));

const electron = jest.requireMock('electron') as {
  __handlers: Map<string, Handler>;
  __showOpenDialog: jest.Mock<() => Promise<{ canceled: boolean; filePaths: string[] }>>;
  __showSaveDialog: jest.Mock<() => Promise<{ canceled: boolean; filePath: string | undefined }>>;
};
const { WorldService } = jest.requireMock('../src/main/services/WorldService') as {
  WorldService: { saved: string[]; opened: string | null };
};

/** A real directory with a real world file: the validator resolves symlinks
 *  with `realpath`, so nothing here can be fictional. */
function seedWorlds(): { dir: string; opened: string; sibling: string } {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dde-world-save-')));
  const opened = path.join(dir, 'NEWWORLD.ZEN');
  const sibling = path.join(dir, 'OLDWORLD.ZEN');
  fs.writeFileSync(opened, 'not really a world');
  fs.writeFileSync(sibling, 'nor is this');
  return { dir, opened, sibling };
}

async function invoke(channel: string, request?: unknown): Promise<unknown> {
  const handler = electron.__handlers.get(channel);
  expect(handler).toBeDefined();
  return handler!({}, request);
}

describe('world:save — overwrite the open world only', () => {
  let worlds: ReturnType<typeof seedWorlds>;

  beforeEach(() => {
    electron.__handlers.clear();
    electron.__showOpenDialog.mockReset();
    electron.__showSaveDialog.mockReset();
    WorldService.saved.length = 0;
    WorldService.opened = null;
    worlds = seedWorlds();
    setupIpcHandlers();
  });

  /** Open a world through the picker, as the surface does before any save. */
  async function openThroughDialog(): Promise<void> {
    electron.__showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [worlds.opened] });
    await expect(invoke('world:openDialog')).resolves.toBe(worlds.opened);
    WorldService.opened = worlds.opened;
  }

  it('writes over the opened world without a save dialog', async () => {
    await openThroughDialog();

    await expect(invoke('world:save')).resolves.toBeUndefined();
    expect(WorldService.saved).toEqual([worlds.opened]);
    expect(electron.__showSaveDialog).not.toHaveBeenCalled();
  });

  it('does not let a renderer payload redirect the save', async () => {
    await openThroughDialog();

    await expect(invoke('world:save', { targetPath: worlds.sibling })).resolves.toBeUndefined();
    expect(WorldService.saved).toEqual([worlds.opened]);
  });

  it('refuses when no world is open', async () => {
    await expect(invoke('world:save')).rejects.toThrow(/no world is open/i);
    expect(WorldService.saved).toEqual([]);
  });

  it('grants the opened world and its sidecar, not the folder they sit in', async () => {
    await openThroughDialog();

    // The sidecar is the one other file an open legitimately reaches for.
    await expect(invoke('world:getVobFolders', { worldPath: worlds.opened })).resolves.toBeDefined();

    // Everything else in that directory stays out of reach, which is what the
    // directory grant gave away — these are retail game folders.
    await expect(invoke('file:read', worlds.sibling)).rejects.toThrow();
  });
});
