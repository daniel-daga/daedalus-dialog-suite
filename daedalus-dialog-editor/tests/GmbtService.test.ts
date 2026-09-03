import path from 'node:path';
import type { ChildProcess } from 'node:child_process';

import {
  quickTestArguments,
  resolveGmbtExecutable,
  startGmbtQuickTest,
} from '../src/main/services/GmbtService';

/**
 * The GMBT quick test (level-editor.md §16.29): the same `gmbt` lookup and the
 * same command `zenkit-node/tools/engine-batch.ps1` uses, minus `--noreparse`.
 */
const WINDOWS_ENV = {
  PATH: ['C:\\tools', 'C:\\other'].join(path.delimiter),
  PATHEXT: '.COM;.EXE;.BAT',
  APPDATA: 'C:\\Users\\d\\AppData\\Roaming',
};

function fakeChild() {
  const child = {
    on: jest.fn(() => child),
    unref: jest.fn(),
  };
  return child as unknown as ChildProcess & { on: jest.Mock; unref: jest.Mock };
}

describe('resolveGmbtExecutable', () => {
  it('takes gmbt off PATH, extension by extension, before the APPDATA fallback', () => {
    const found = path.join('C:\\other', 'gmbt.EXE');
    expect(resolveGmbtExecutable({
      env: WINDOWS_ENV, platform: 'win32', exists: (candidate) => candidate === found,
    })).toBe(found);
  });

  it('falls back to %APPDATA%\\GMBT\\bin\\gmbt.exe when PATH has none', () => {
    const fallback = path.join(WINDOWS_ENV.APPDATA, 'GMBT', 'bin', 'gmbt.exe');
    expect(resolveGmbtExecutable({
      env: WINDOWS_ENV, platform: 'win32', exists: (candidate) => candidate === fallback,
    })).toBe(fallback);
  });

  it('is null when GMBT is installed nowhere it looks', () => {
    expect(resolveGmbtExecutable({ env: WINDOWS_ENV, platform: 'win32', exists: () => false }))
      .toBeNull();
  });
});

describe('startGmbtQuickTest', () => {
  it('runs the world by its own filename from the GMBT project folder, detached', () => {
    const child = fakeChild();
    const spawn = jest.fn(() => child);

    startGmbtQuickTest('C:\\mod\\gmbt', 'MYWORLD.ZEN', {
      env: WINDOWS_ENV, platform: 'win32', exists: () => true,
      spawn: spawn as unknown as typeof import('node:child_process').spawn,
    });

    const [executable, args, options] = spawn.mock.calls[0] as unknown as [string, string[], Record<string, unknown>];
    expect(executable).toBe(path.join('C:\\tools', 'gmbt.COM'));
    expect(args).toEqual(['test', '--world=MYWORLD.ZEN', '--nomenu', '-D', '--noupdatesubtitles']);
    // `--noreparse` is the harness's, not this one's: scripts edited in this
    // app have to be recompiled by the run that tests them.
    expect(args).not.toContain('--noreparse');
    expect(args).not.toContain('--full');
    expect(options).toMatchObject({ cwd: 'C:\\mod\\gmbt', detached: true, stdio: 'ignore' });
    // Fire-and-forget: nothing waits on it, so the process is let go of and a
    // spawn failure has a listener rather than taking main down.
    expect(child.unref).toHaveBeenCalled();
    expect(child.on).toHaveBeenCalledWith('error', expect.any(Function));
  });

  it('refuses rather than spawning when gmbt is not installed', () => {
    const spawn = jest.fn();
    expect(() => startGmbtQuickTest('C:\\mod\\gmbt', 'MYWORLD.ZEN', {
      env: WINDOWS_ENV, platform: 'win32', exists: () => false,
      spawn: spawn as unknown as typeof import('node:child_process').spawn,
    })).toThrow(/gmbt was not found/i);
    expect(spawn).not.toHaveBeenCalled();
  });
});

describe('quickTestArguments', () => {
  it('passes the filename through without upper-casing it', () => {
    expect(quickTestArguments('NewWorld.Zen')[1]).toBe('--world=NewWorld.Zen');
  });
});
