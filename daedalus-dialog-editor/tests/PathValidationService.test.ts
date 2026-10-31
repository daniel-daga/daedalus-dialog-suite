/**
 * Test suite for PathValidationService - Secure file path validation
 *
 * Tests protection against:
 * - Directory traversal attacks (../)
 * - Absolute path escapes
 * - Path normalization bypass attempts
 * - Null/undefined inputs
 * - Invalid characters
 *
 * Everything here goes through `validatePathResolved`, the only entry point the
 * app has: containment is checked against realpath'd roots, so each case needs a
 * real directory rather than a string that merely looks like a path.
 */

import * as path from 'path';
import * as os from 'os';
import * as fsp from 'fs/promises';

describe('PathValidationService', () => {
  let PathValidationService: any;

  beforeAll(async () => {
    // Dynamically import to avoid issues with main process code
    const module = await import('../src/main/services/PathValidationService');
    PathValidationService = module.PathValidationService;
  });

  describe('validatePathResolved - what it allows and refuses', () => {
    let root = '';
    let outside = '';
    let service: any;

    beforeEach(async () => {
      root = await fsp.mkdtemp(path.join(os.tmpdir(), 'pvs-gate-root-'));
      outside = await fsp.mkdtemp(path.join(os.tmpdir(), 'pvs-gate-out-'));
      service = new PathValidationService([root]);
    });

    afterEach(async () => {
      await fsp.rm(root, { recursive: true, force: true });
      await fsp.rm(outside, { recursive: true, force: true });
    });

    it('allows files in the root, in nested folders, and with ordinary punctuation', async () => {
      for (const relative of [
        'test.d',
        path.join('Dialoge', 'NPCs', 'DIA_Farim.d'),
        path.join('a', 'b', 'c', 'd', 'e', 'file.d'),
        'file-with-dashes_and_underscores (and parens).d',
        path.join('My Folder', 'My File.d'),
      ]) {
        await expect(service.validatePathResolved(path.join(root, relative))).resolves.toBeUndefined();
      }
    });

    it('refuses null, undefined, empty, whitespace and non-string inputs', async () => {
      for (const bad of [null, undefined, '', '   ', 123, {}, []]) {
        await expect(service.validatePathResolved(bad)).rejects.toThrow(/non-empty string/i);
      }
    });

    it('refuses a path holding a null byte or a line break', async () => {
      await expect(service.validatePathResolved(`${root}\0file.d`)).rejects.toThrow(/null bytes/i);
      await expect(service.validatePathResolved(`${root}\r\nfile.d`)).rejects.toThrow(/control characters/i);
    });

    it('refuses a relative path, whatever it looks like', async () => {
      for (const relative of ['Dialoge/DIA_Test.d', './file.d', '~/Documents/secrets.txt']) {
        await expect(service.validatePathResolved(relative)).rejects.toThrow(/Relative paths not allowed/i);
      }
    });

    it('refuses .. traversal out of the root, however many levels deep', async () => {
      const from = (...steps: string[]) => [root, ...steps, 'etc', 'passwd'].join(path.sep);
      await expect(service.validatePathResolved(from('..', '..'))).rejects.toThrow(/Path validation failed/i);
      await expect(service.validatePathResolved(from('Dialoge', '..', '..', '..'))).rejects.toThrow(/Path validation failed/i);
    });

    it('refuses an absolute path outside every allowed root', async () => {
      const evil = path.join(outside, 'passwords.txt');
      await fsp.writeFile(evil, 'x');
      await expect(service.validatePathResolved(evil)).rejects.toThrow(/outside the allowed project folder/i);

      // A temp-dir path is no less outside for being a temp-dir path.
      await expect(service.validatePathResolved(path.join(os.tmpdir(), 'malicious.exe'))).rejects.toThrow();
    });

    it('refuses a path in the home directory it does not own', async () => {
      await expect(service.validatePathResolved(path.join(os.homedir(), '.ssh', 'id_rsa'))).rejects.toThrow();
    });

    it('allows a child folder whose name merely begins with ".."', async () => {
      // N3: containment is segment-aware. "..backup" is a legitimate child, not
      // traversal.
      await fsp.mkdir(path.join(root, '..backup'));
      await expect(service.validatePathResolved(path.join(root, '..backup', 'x.d'))).resolves.toBeUndefined();
    });

    it('allows a folder whose name literally contains "%2e"', async () => {
      // The local fs never URL-decodes, so %2e/%2f are ordinary filename
      // characters; the old substring rejection was a false positive (IPC-c).
      await fsp.mkdir(path.join(root, 'mod%2e5'));
      await expect(service.validatePathResolved(path.join(root, 'mod%2e5', 'x.d'))).resolves.toBeUndefined();
      await expect(
        service.validatePathResolved(`${root}/%2e%2e%2f%2e%2e%2fsecret.txt`),
      ).resolves.toBeUndefined();
    });

    it('allows a path in any of several allowed roots and refuses it outside them all', async () => {
      const rootA = await fsp.mkdtemp(path.join(os.tmpdir(), 'pvs-multi-a-'));
      const rootB = await fsp.mkdtemp(path.join(os.tmpdir(), 'pvs-multi-b-'));
      try {
        const multi = new PathValidationService([rootA, rootB]);
        await expect(multi.validatePathResolved(path.join(rootA, 'file1.d'))).resolves.toBeUndefined();
        await expect(multi.validatePathResolved(path.join(rootB, 'file2.d'))).resolves.toBeUndefined();
        await expect(multi.validatePathResolved(path.join(outside, 'file.d'))).rejects.toThrow();
      } finally {
        await fsp.rm(rootA, { recursive: true, force: true });
        await fsp.rm(rootB, { recursive: true, force: true });
      }
    });

    it('grants a root added at runtime, normalized as it is stored', async () => {
      const newRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'pvs-added-'));
      try {
        const file = path.join(newRoot, 'test.d');
        await expect(service.validatePathResolved(file)).rejects.toThrow();

        // The same folder, spelled with a `..` on the way in.
        service.addAllowedPath(`${newRoot}${path.sep}sub${path.sep}..`);
        await fsp.mkdir(path.join(newRoot, 'sub'));
        await expect(service.validatePathResolved(file)).resolves.toBeUndefined();
      } finally {
        await fsp.rm(newRoot, { recursive: true, force: true });
      }
    });
  });

  // Symlink-aware async validation against the real filesystem.
  describe('validatePathResolved - symlink-aware containment', () => {
    // Symlink creation may need Developer Mode on Windows; probe and skip.
    let canSymlink = false;
    let probeDir = '';
    beforeAll(async () => {
      probeDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'pvs-probe-'));
      try {
        await fsp.symlink(path.join(probeDir, 'target'), path.join(probeDir, 'link'), 'junction');
        canSymlink = true;
      } catch {
        try {
          await fsp.symlink(path.join(probeDir, 'target'), path.join(probeDir, 'link2'));
          canSymlink = true;
        } catch {
          canSymlink = false;
        }
      }
    });
    afterAll(async () => {
      if (probeDir) await fsp.rm(probeDir, { recursive: true, force: true });
    });

    let root = '';
    let outside = '';
    let service: any;
    beforeEach(async () => {
      root = await fsp.mkdtemp(path.join(os.tmpdir(), 'pvs-root-'));
      outside = await fsp.mkdtemp(path.join(os.tmpdir(), 'pvs-out-'));
      service = new PathValidationService([root]);
    });
    afterEach(async () => {
      await fsp.rm(root, { recursive: true, force: true });
      await fsp.rm(outside, { recursive: true, force: true });
    });

    const maybe = (name: string, fn: () => Promise<void>) =>
      it(name, async () => {
        if (!canSymlink) {
          return; // symlinks unavailable on this platform/CI
        }
        await fn();
      });

    it('allows an ordinary file inside the root', async () => {
      const p = path.join(root, 'DIA_Test.d');
      await fsp.writeFile(p, 'x');
      await expect(service.validatePathResolved(p)).resolves.toBeUndefined();
    });

    it('allows a non-existent save-as target inside the root', async () => {
      const p = path.join(root, 'new', 'sub', 'file.d');
      await expect(service.validatePathResolved(p)).resolves.toBeUndefined();
    });

    it('rejects an absolute path outside the root', async () => {
      const p = path.join(outside, 'evil.d');
      await fsp.writeFile(p, 'x');
      await expect(service.validatePathResolved(p)).rejects.toThrow();
    });

    maybe('rejects a symlinked directory that escapes the root', async () => {
      await fsp.symlink(outside, path.join(root, 'link'), 'junction');
      await expect(
        service.validatePathResolved(path.join(root, 'link', 'x.d'))
      ).rejects.toThrow();
    });

    maybe('rejects writing through a symlinked file that escapes the root', async () => {
      // Broken/dangling symlink: target's parent exists, target file does not.
      await fsp.symlink(path.join(outside, 'target'), path.join(root, 'evil.d'));
      await expect(
        service.validatePathResolved(path.join(root, 'evil.d'), { write: true })
      ).rejects.toThrow();
    });

    maybe('allows a symlink that points within another allowed root', async () => {
      const rootB = await fsp.mkdtemp(path.join(os.tmpdir(), 'pvs-rootB-'));
      try {
        service.addAllowedPath(rootB);
        await fsp.symlink(rootB, path.join(root, 'link'), 'junction');
        const p = path.join(root, 'link', 'x.d');
        await fsp.writeFile(path.join(rootB, 'x.d'), 'x');
        await expect(service.validatePathResolved(p)).resolves.toBeUndefined();
      } finally {
        await fsp.rm(rootB, { recursive: true, force: true });
      }
    });

    maybe('rejects a non-existent target under an escaping symlink (save-as)', async () => {
      await fsp.symlink(outside, path.join(root, 'link-out'), 'junction');
      await expect(
        service.validatePathResolved(path.join(root, 'link-out', 'new.d'))
      ).rejects.toThrow();
    });

    it('still rejects .. traversal against the resolved variant', async () => {
      const p = path.join(root, '..', '..', 'etc', 'passwd');
      await expect(service.validatePathResolved(p)).rejects.toThrow();
    });

    // An exact-file grant for a file that does not exist yet, named through a
    // path whose existing prefix realpath rewrites. The candidate is resolved
    // through its deepest existing ancestor, so the whitelist entry has to be
    // resolved the same way or the two spellings never compare equal.
    //
    // This is not hypothetical: `os.tmpdir()` on GitHub's Windows runners is
    // `C:\Users\RUNNER~1\...`, an 8.3 alias realpath expands to `runneradmin`,
    // which silently refused every first `<world>.folders.json` write there
    // while passing on any machine whose paths need no alias. A junction
    // reproduces the same prefix rewrite on every platform.
    maybe('allows a not-yet-created granted file whose prefix realpath rewrites', async () => {
      const linked = path.join(outside, 'link');
      await fsp.symlink(root, linked, 'junction');
      const sidecar = path.join(linked, 'world.folders.json');

      // No allowed roots: the exact-file grant is the only thing that can pass
      // this, so the assertion cannot succeed by containment instead.
      const filesOnly: any = new PathValidationService([]);
      filesOnly.addAllowedFile(sidecar);

      await expect(filesOnly.validatePathResolved(sidecar, { write: true })).resolves.toBeUndefined();
      // Still exactly one file: an ungranted sibling through the same link stays refused.
      await expect(
        filesOnly.validatePathResolved(path.join(linked, 'other.folders.json'), { write: true })
      ).rejects.toThrow();
    });
  });

  // Whitelist granularity: openDialog/saveDialog whitelist the exact selected
  // file, not its parent directory. Selecting a.d must NOT grant b.d.
  describe('whitelist granularity - allowedFiles', () => {
    let dir = '';
    let service: any;
    beforeEach(async () => {
      dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'pvs-files-'));
      await fsp.writeFile(path.join(dir, 'a.d'), 'x');
      await fsp.writeFile(path.join(dir, 'b.d'), 'x');
      service = new PathValidationService([]);
    });
    afterEach(async () => {
      await fsp.rm(dir, { recursive: true, force: true });
    });

    it('allows the exact whitelisted file but rejects a sibling', async () => {
      service.addAllowedFile(path.join(dir, 'a.d'));
      await expect(service.validatePathResolved(path.join(dir, 'a.d'))).resolves.toBeUndefined();
      await expect(service.validatePathResolved(path.join(dir, 'b.d'))).rejects.toThrow();
    });
  });
});
