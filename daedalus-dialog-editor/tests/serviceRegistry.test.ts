/**
 * The main-process composition root (mcp-server.md §2, Phase 0).
 *
 * `main.ts` used to construct every service at module scope, which made the set
 * unreachable from anything but `main.ts` itself. The registry is the shared
 * construction site — one memoized set of singletons that `main.ts` and any
 * later main-side consumer both take.
 *
 * Two properties are load-bearing and are what this file asserts:
 *  - construction is *deferred to the first call*, never done at import. The
 *    E2E `DDE_E2E_USER_DATA` seam in `main.ts` redirects `app.getPath` before
 *    the services read it, and an eagerly-constructing module would read it
 *    first.
 *  - the set is memoized, so a second consumer shares `main.ts`'s instances
 *    rather than opening a second SettingsService over the same file.
 *
 * @jest-environment node
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import * as os from 'os';

type Handler = (event: unknown, ...args: unknown[]) => unknown;

const getPathCalls: string[] = [];

jest.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      getPathCalls.push(name);
      return os.tmpdir();
    },
    getVersion: () => '0.0.0-test',
    setPath: () => undefined,
    // Never resolves: keeps the real startup path from running on import.
    whenReady: () => new Promise(() => undefined),
    on: () => undefined,
    quit: () => undefined,
  },
  BrowserWindow: class {},
  ipcMain: { handle: (_c: string, _h: Handler) => undefined, on: () => undefined },
  dialog: {},
  shell: {},
}));

describe('serviceRegistry', () => {
  beforeEach(() => {
    getPathCalls.length = 0;
    jest.resetModules();
  });

  it('constructs nothing at import time', async () => {
    await import('../src/main/services/serviceRegistry');

    expect(getPathCalls).toEqual([]);
  });

  it('memoizes one set of services', async () => {
    const { getServiceRegistry } = await import('../src/main/services/serviceRegistry');

    const first = getServiceRegistry();
    const second = getServiceRegistry();

    expect(second).toBe(first);
    expect(second.settingsService).toBe(first.settingsService);
    expect(second.worldService).toBe(first.worldService);
    // userData is read by the one construction only — SettingsService and
    // LogService each resolve it, and nothing resolves it a second time.
    expect(getPathCalls).toEqual(['userData', 'userData']);
  });

  it('wires the services that depend on each other', async () => {
    const { getServiceRegistry } = await import('../src/main/services/serviceRegistry');
    const { ValidationService } = await import('../src/main/services/ValidationService');
    const { UpdaterService } = await import('../src/main/services/UpdaterService');

    const registry = getServiceRegistry();

    expect(registry.validationService).toBeInstanceOf(ValidationService);
    expect(registry.updaterService).toBeInstanceOf(UpdaterService);
    // The validator starts empty; paths are whitelisted as the user opens them.
    await expect(
      registry.pathValidator.validatePathResolved(os.tmpdir())
    ).rejects.toThrow();
  });

  it('is the same set main.ts runs on', async () => {
    const { getServiceRegistry } = await import('../src/main/services/serviceRegistry');
    await import('../src/main/main');

    const before = getPathCalls.length;
    getServiceRegistry();

    // main.ts already built the registry; taking it again constructs nothing.
    expect(before).toBeGreaterThan(0);
    expect(getPathCalls.length).toBe(before);
  });
});
