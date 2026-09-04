/**
 * `world:save` writes only where a save dialog said it may.
 *
 * `docs/architecture/level-editor.md` §7: "the renderer never names its own
 * target: the dialog is what puts the directory on the path whitelist". The
 * whitelist was the whole of the enforcement, and it is a *directory* grant —
 * `world:openDialog`, `world:saveDialog` and `world:listWorlds` each added
 * `path.dirname(...)` recursively — so a renderer that had opened or merely
 * listed a world could `saveWorld(summary.worldPath)` straight over the retail
 * file, with no dialog and no overwrite prompt: those live in `WorldSurface`,
 * which is the side the promise is about.
 *
 * Two things changed, and this pins both. The world dialogs grant the exact
 * file (and its `.folders.json` sidecar) rather than its directory, the way the
 * script dialogs already did; and a save target has to have come out of
 * `world:saveDialog`, which is the "the dialog is what authorises the write"
 * half that no whitelist can express — the opened world's own path is legally
 * readable, and that is what made it writable.
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
    saveWorld = async (target: string) => {
      (jest.requireMock('../src/main/services/WorldService') as {
        WorldService: { saved: string[] };
      }).WorldService.saved.push(target);
    };
    openWorldPath = () => null;
    close = () => undefined;
  },
}));

const electron = jest.requireMock('electron') as {
  __handlers: Map<string, Handler>;
  __showOpenDialog: jest.Mock<() => Promise<{ canceled: boolean; filePaths: string[] }>>;
  __showSaveDialog: jest.Mock<() => Promise<{ canceled: boolean; filePath: string | undefined }>>;
};
const { WorldService } = jest.requireMock('../src/main/services/WorldService') as {
  WorldService: { saved: string[] };
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

describe('world:save — only a dialog names a write target', () => {
  let worlds: ReturnType<typeof seedWorlds>;

  beforeEach(() => {
    electron.__handlers.clear();
    electron.__showOpenDialog.mockReset();
    electron.__showSaveDialog.mockReset();
    WorldService.saved.length = 0;
    worlds = seedWorlds();
    setupIpcHandlers();
  });

  /** Open a world through the picker, as the surface does before any save. */
  async function openThroughDialog(): Promise<void> {
    electron.__showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [worlds.opened] });
    await expect(invoke('world:openDialog')).resolves.toBe(worlds.opened);
  }

  it('refuses to write over the opened world when no save dialog chose it', async () => {
    await openThroughDialog();

    await expect(invoke('world:save', { targetPath: worlds.opened })).rejects.toThrow();
    expect(WorldService.saved).toEqual([]);
  });

  it('refuses a neighbour of the opened world', async () => {
    await openThroughDialog();

    await expect(invoke('world:save', { targetPath: worlds.sibling })).rejects.toThrow();
    // And a path that does not exist yet, which is what a save-as would be.
    await expect(invoke('world:save', { targetPath: path.join(worlds.dir, 'INVENTED.ZEN') }))
      .rejects.toThrow();
    expect(WorldService.saved).toEqual([]);
  });

  it('writes where the save dialog said, including over the opened file', async () => {
    await openThroughDialog();

    const target = path.join(worlds.dir, 'NEWWORLD.edited.zen');
    electron.__showSaveDialog.mockResolvedValue({ canceled: false, filePath: target });
    await expect(invoke('world:saveDialog', { suggested: target })).resolves.toBe(target);

    await expect(invoke('world:save', { targetPath: target })).resolves.toBeUndefined();
    expect(WorldService.saved).toEqual([target]);

    // Overwriting the original stays reachable — the OS dialog asks, and the
    // quick test needs it (§16.29) — but it has to be chosen there.
    electron.__showSaveDialog.mockResolvedValue({ canceled: false, filePath: worlds.opened });
    await expect(invoke('world:saveDialog', { suggested: worlds.opened })).resolves.toBe(worlds.opened);
    await expect(invoke('world:save', { targetPath: worlds.opened })).resolves.toBeUndefined();
    expect(WorldService.saved).toEqual([target, worlds.opened]);
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
