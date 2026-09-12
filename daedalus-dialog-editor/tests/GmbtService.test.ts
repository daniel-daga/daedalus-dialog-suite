import path from 'node:path';
import type { ChildProcess } from 'node:child_process';

import {
  quickTestArguments,
  resolveGmbtExecutable,
  startGmbtQuickTest,
  worldIsInsideGmbtProject,
} from '../src/main/services/GmbtService';

/**
 * The GMBT quick test (level-editor.md §16.29): the same `gmbt` lookup and the
 * same command `zenkit-node/tools/engine-batch.ps1` uses, minus `--noreparse`.
 */
const WINDOWS_ENV = {
  PATH: ['C:\\tools', 'C:\\other'].join(path.win32.delimiter),
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
    const found = path.win32.join('C:\\other', 'gmbt.EXE');
    expect(resolveGmbtExecutable({
      env: WINDOWS_ENV, platform: 'win32', exists: (candidate) => candidate === found,
    })).toBe(found);
  });

  it('falls back to %APPDATA%\\GMBT\\bin\\gmbt.exe when PATH has none', () => {
    const fallback = path.win32.join(WINDOWS_ENV.APPDATA, 'GMBT', 'bin', 'gmbt.exe');
    expect(resolveGmbtExecutable({
      env: WINDOWS_ENV, platform: 'win32', exists: (candidate) => candidate === fallback,
    })).toBe(fallback);
  });

  it('passes over a .BAT or .CMD, which Node will not spawn without a shell', () => {
    // PATHEXT lists them and `where gmbt` would find one, but Node >= 20.12
    // refuses to spawn a batch file without `shell: true` (the fix for
    // CVE-2024-27980) — and `shell: true` is not the answer here, because the
    // arguments would then go through cmd's own parsing. Resolving one is
    // therefore resolving something this service cannot launch: the honest
    // answer is to keep looking, and to say GMBT was not found if a real
    // executable is not.
    const batch = path.win32.join('C:\\tools', 'gmbt.BAT');
    expect(resolveGmbtExecutable({
      env: WINDOWS_ENV, platform: 'win32', exists: (candidate) => candidate === batch,
    })).toBeNull();

    // And an .EXE beside it in the same directory is still found.
    const exe = path.win32.join('C:\\tools', 'gmbt.EXE');
    expect(resolveGmbtExecutable({
      env: WINDOWS_ENV,
      platform: 'win32',
      exists: (candidate) => candidate === batch || candidate === exe,
    })).toBe(exe);
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

    startGmbtQuickTest('C:\\mod\\gmbt', 'C:\\mod\\gmbt\\_work\\Data\\Worlds\\MYWORLD.ZEN', {
      env: WINDOWS_ENV, platform: 'win32', exists: () => true,
      spawn: spawn as unknown as typeof import('node:child_process').spawn,
    });

    const [executable, args, options] = spawn.mock.calls[0] as unknown as [string, string[], Record<string, unknown>];
    expect(executable).toBe(path.win32.join('C:\\tools', 'gmbt.COM'));
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

  // `gmbt test` takes a *basename* and a working directory, so it always plays
  // the GMBT project's own copy of that filename. A world opened from the
  // Gothic install and saved back therefore reads clean while the engine loads
  // different bytes — the edit silently does not show. The launch is refused,
  // and the refusal names both paths.
  it('refuses a world that is not inside the GMBT project folder, naming both paths', () => {
    const spawn = jest.fn();
    const outside = 'C:\\Gothic II\\_work\\Data\\Worlds\\MYWORLD.ZEN';

    let message = '';
    try {
      startGmbtQuickTest('C:\\mod\\gmbt', outside, {
        env: WINDOWS_ENV, platform: 'win32', exists: () => true,
        spawn: spawn as unknown as typeof import('node:child_process').spawn,
      });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain(outside);
    expect(message).toContain('C:\\mod\\gmbt');
    expect(spawn).not.toHaveBeenCalled();
  });

  it('refuses before it looks for gmbt, so the mismatch is what it reports', () => {
    expect(() => startGmbtQuickTest('C:\\mod\\gmbt', 'C:\\Gothic II\\Worlds\\W.ZEN', {
      env: WINDOWS_ENV, platform: 'win32', exists: () => false,
      spawn: jest.fn() as unknown as typeof import('node:child_process').spawn,
    })).toThrow(/not inside the GMBT project folder/i);
  });

  it('refuses rather than spawning when gmbt is not installed', () => {
    const spawn = jest.fn();
    expect(() => startGmbtQuickTest('C:\\mod\\gmbt', 'C:\\mod\\gmbt\\_work\\Data\\Worlds\\MYWORLD.ZEN', {
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

describe('worldIsInsideGmbtProject', () => {
  it('is true for a world under the folder, at any depth', () => {
    expect(worldIsInsideGmbtProject('C:\\mod\\gmbt', 'C:\\mod\\gmbt\\_work\\Data\\Worlds\\W.ZEN', { platform: 'win32' })).toBe(true);
    expect(worldIsInsideGmbtProject('C:\\mod\\gmbt', 'C:\\mod\\gmbt\\W.ZEN', { platform: 'win32' })).toBe(true);
  });

  it('folds case on Windows, where the two paths come from different places', () => {
    // The folder is typed into the project file and the world arrives from the
    // open dialog, so their casing routinely disagrees on a case-insensitive
    // filesystem.
    expect(worldIsInsideGmbtProject('C:\\Mod\\GMBT', 'c:\\mod\\gmbt\\_work\\W.ZEN', { platform: 'win32' })).toBe(true);
    expect(worldIsInsideGmbtProject('/mod/gmbt', '/MOD/GMBT/w.zen', { platform: 'linux' })).toBe(false);
  });

  it('is false for a sibling folder the name is merely a prefix of', () => {
    expect(worldIsInsideGmbtProject('C:\\mod\\gmbt', 'C:\\mod\\gmbt-old\\W.ZEN', { platform: 'win32' })).toBe(false);
  });

  it('is false for a folder above it, and for the folder itself', () => {
    expect(worldIsInsideGmbtProject('C:\\mod\\gmbt', 'C:\\mod\\W.ZEN', { platform: 'win32' })).toBe(false);
    expect(worldIsInsideGmbtProject('C:\\mod\\gmbt', 'C:\\mod\\gmbt', { platform: 'win32' })).toBe(false);
  });
});
