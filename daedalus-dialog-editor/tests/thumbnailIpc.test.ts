/**
 * The thumbnail channels' boundary (level-editor.md §16.26 row 1): a put
 * carries the key a read answered, and nothing else reaches `userData`.
 *
 * @jest-environment node
 */

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import * as fs from 'fs/promises';
import * as path from 'path';
import os from 'node:os';
import { setupIpcHandlers } from '../src/main/main';
import { ThumbnailCacheService } from '../src/main/services/ThumbnailCacheService';

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

// `main.ts` takes the registry once at import, so the cache is a facade over
// whatever this test constructed for the case at hand.
const mockCache: { current: ThumbnailCacheService | null } = { current: null };

jest.mock('../src/main/services/serviceRegistry', () => ({
  getServiceRegistry: () => ({
    fileService: {}, parserService: {},
    projectService: {}, settingsService: {}, fileWatcherService: {}, updaterService: {},
    worldService: { openAssetSources: () => [] },
    worldFoldersService: {},
    thumbnailCacheService: {
      keyFor: (name: string, sources: readonly string[]) => mockCache.current!.keyFor(name, sources),
      load: (key: string) => mockCache.current!.load(key),
      store: (key: string, dataUrl: string) => mockCache.current!.store(key, dataUrl),
    },
    assetCatalogService: {},
    logService: { log: jest.fn(), getLogFilePath: jest.fn() },
    pathValidator: {},
  }),
}));

const electron = jest.requireMock('electron') as { __handlers: Map<string, Handler> };

const testDir = path.resolve('./test-thumbnail-ipc');
const thumbs = path.join(testDir, 'thumbs');
const PNG = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]).toString('base64')}`;

async function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const handler = electron.__handlers.get(channel);
  expect(handler).toBeDefined();
  return handler!({}, ...args);
}

/** The cache directory, or null while nothing has written to it. */
async function cachedNames(): Promise<string[] | null> {
  try {
    return await fs.readdir(thumbs);
  } catch {
    return null;
  }
}

describe('thumbnail IPC', () => {
  beforeEach(() => {
    electron.__handlers.clear();
    mockCache.current = new ThumbnailCacheService(thumbs);
    setupIpcHandlers();
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('refuses a key that is not a 64-digit hex digest before anything is written', async () => {
    await expect(invoke('world:putThumbnail', { key: '../settings', dataUrl: PNG })).rejects.toThrow(/key/);
    await expect(invoke('world:putThumbnail', { key: 'A'.repeat(64), dataUrl: PNG })).rejects.toThrow(/key/);
    expect(await cachedNames()).toBeNull();
  });

  it('refuses a well-formed key the cache never minted, before anything is written', async () => {
    await expect(invoke('world:putThumbnail', { key: 'e'.repeat(64), dataUrl: PNG })).rejects.toThrow(/key/);
    expect(await cachedNames()).toBeNull();
  });

  it('stores under the key a read answered, and answers that PNG back', async () => {
    const { key } = (await invoke('world:getThumbnail', { name: 'NW_CRATE.MRM' })) as { key: string };
    await invoke('world:putThumbnail', { key, dataUrl: PNG });
    await expect(invoke('world:getThumbnail', { name: 'NW_CRATE.MRM' })).resolves.toEqual({ key, dataUrl: PNG });
  });
});
