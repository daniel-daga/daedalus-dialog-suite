/**
 * Test suite for PathValidationService - Secure file path validation
 *
 * Tests protection against:
 * - Directory traversal attacks (../)
 * - Absolute path escapes
 * - Path normalization bypass attempts
 * - Null/undefined inputs
 * - Invalid characters
 */

import * as path from 'path';
import * as os from 'os';
import * as fsp from 'fs/promises';

describe('PathValidationService', () => {
  let PathValidationService: any;
  const isWin = os.platform() === 'win32';
  const projectPath = isWin
    ? path.join('C:', 'Users', 'Test', 'MyGothicMod')
    : path.join('/tmp', 'Users', 'Test', 'MyGothicMod');
  const allowedPaths = [projectPath];

  beforeAll(async () => {
    // Dynamically import to avoid issues with main process code
    const module = await import('../src/main/services/PathValidationService');
    PathValidationService = module.PathValidationService;
  });

  describe('constructor', () => {
    it('should create instance with allowed paths', () => {
      const service = new PathValidationService(allowedPaths);
      expect(service).toBeDefined();
    });

    it('should handle empty allowed paths array', () => {
      const service = new PathValidationService([]);
      expect(service).toBeDefined();
    });

    it('should normalize allowed paths on construction', () => {
      const unnormalizedPath = isWin
        ? 'C:/Users/Test/../Test/MyGothicMod'
        : '/tmp/Users/Test/../Test/MyGothicMod';
      const service = new PathValidationService([unnormalizedPath]);

      // Should accept a file in the normalized location
      const normalizedProjectPath = path.normalize(unnormalizedPath);
      const validFile = path.join(normalizedProjectPath, 'test.d');
      expect(service.isPathAllowed(validFile)).toBe(true);
    });
  });

  describe('isPathAllowed - valid paths', () => {
    let service: any;

    beforeEach(() => {
      service = new PathValidationService(allowedPaths);
    });

    it('should allow file directly in project root', () => {
      const filePath = path.join(projectPath, 'test.d');
      expect(service.isPathAllowed(filePath)).toBe(true);
    });

    it('should allow file in nested subdirectory', () => {
      const filePath = path.join(projectPath, 'Dialoge', 'NPCs', 'DIA_Farim.d');
      expect(service.isPathAllowed(filePath)).toBe(true);
    });

    it('should allow deeply nested files', () => {
      const filePath = path.join(projectPath, 'a', 'b', 'c', 'd', 'e', 'file.d');
      expect(service.isPathAllowed(filePath)).toBe(true);
    });

    it('should allow files with special but valid characters', () => {
      const filePath = path.join(projectPath, 'file-with-dashes_and_underscores (and parens).d');
      expect(service.isPathAllowed(filePath)).toBe(true);
    });

    it('should handle paths with spaces correctly', () => {
      const filePath = path.join(projectPath, 'My Folder', 'My File.d');
      expect(service.isPathAllowed(filePath)).toBe(true);
    });
  });

  describe('isPathAllowed - directory traversal attacks', () => {
    let service: any;

    beforeEach(() => {
      service = new PathValidationService(allowedPaths);
    });

    it('should reject path with .. going outside project', () => {
      const filePath = path.join(projectPath, '..', '..', 'etc', 'passwd');
      expect(service.isPathAllowed(filePath)).toBe(false);
    });

    it('should reject path starting with ../', () => {
      const filePath = path.join('..', 'SensitiveFolder', 'secret.txt');
      expect(service.isPathAllowed(filePath)).toBe(false);
    });

    it('should reject multiple .. attempts', () => {
      const filePath = path.join(projectPath, 'Dialoge', '..', '..', '..', 'Windows', 'System32', 'file.dll');
      expect(service.isPathAllowed(filePath)).toBe(false);
    });

    it('should treat URL-encoded sequences as literal filename characters (IPC-c)', () => {
      // The local fs never URL-decodes, so %2e/%2f are ordinary filename
      // characters. A file literally named like this lives inside the project
      // and must be allowed (the old substring rejection was a false positive).
      const filePath = projectPath + '/%2e%2e%2f%2e%2e%2fsecret.txt';
      expect(service.isPathAllowed(filePath)).toBe(true);
    });

    it('should treat double-encoded sequences as literal filename characters (IPC-c)', () => {
      const filePath = projectPath + '/%252e%252e%252fsecret.txt';
      expect(service.isPathAllowed(filePath)).toBe(true);
    });

    it('should allow .. that stays within project bounds', () => {
      // Going up and back down should be OK if still within project
      const filePath = path.join(projectPath, 'Dialoge', 'SubFolder', '..', 'OtherFolder', 'file.d');
      const normalized = path.normalize(filePath);

      // Should be allowed because normalized path is still within project
      expect(service.isPathAllowed(normalized)).toBe(true);
    });
  });

  describe('isPathAllowed - absolute path escapes', () => {
    let service: any;

    beforeEach(() => {
      service = new PathValidationService(allowedPaths);
    });

    it('should reject absolute path to different drive (Windows)', () => {
      if (os.platform() === 'win32') {
        const filePath = 'D:\\SecretFiles\\passwords.txt';
        expect(service.isPathAllowed(filePath)).toBe(false);
      }
    });

    it('should reject absolute path outside allowed directory (Unix)', () => {
      const filePath = '/etc/passwd';
      expect(service.isPathAllowed(filePath)).toBe(false);
    });

    it('should reject absolute path to home directory', () => {
      const homePath = os.homedir();
      const filePath = path.join(homePath, '.ssh', 'id_rsa');

      // Should be rejected unless homePath is in allowedPaths
      expect(service.isPathAllowed(filePath)).toBe(false);
    });

    it('should reject absolute path to system directory (Windows)', () => {
      if (os.platform() === 'win32') {
        const filePath = 'C:\\Windows\\System32\\config\\SAM';
        expect(service.isPathAllowed(filePath)).toBe(false);
      }
    });

    it('should reject absolute path to temp directory', () => {
      const filePath = path.join(os.tmpdir(), 'malicious.exe');
      expect(service.isPathAllowed(filePath)).toBe(false);
    });
  });

  describe('isPathAllowed - invalid inputs', () => {
    let service: any;

    beforeEach(() => {
      service = new PathValidationService(allowedPaths);
    });

    it('should reject null path', () => {
      expect(service.isPathAllowed(null)).toBe(false);
    });

    it('should reject undefined path', () => {
      expect(service.isPathAllowed(undefined)).toBe(false);
    });

    it('should reject empty string', () => {
      expect(service.isPathAllowed('')).toBe(false);
    });

    it('should reject whitespace-only string', () => {
      expect(service.isPathAllowed('   ')).toBe(false);
    });

    it('should reject non-string inputs', () => {
      expect(service.isPathAllowed(123 as any)).toBe(false);
      expect(service.isPathAllowed({} as any)).toBe(false);
      expect(service.isPathAllowed([] as any)).toBe(false);
    });
  });

  describe('isPathAllowed - path normalization bypass attempts', () => {
    let service: any;

    beforeEach(() => {
      service = new PathValidationService(allowedPaths);
    });

    it('should reject paths with forward slashes mixed with backslashes', () => {
      if (os.platform() === 'win32') {
        const filePath = 'C:/Users/Test/MyGothicMod\\..\\..\\Windows\\System32\\file.dll';
        expect(service.isPathAllowed(filePath)).toBe(false);
      }
    });

    it('should reject paths with redundant separators', () => {
      const filePath = projectPath + path.sep + path.sep + path.sep + 'file.d';
      // Should normalize and allow (it's still in project)
      const normalized = path.normalize(filePath);
      expect(service.isPathAllowed(normalized)).toBe(true);
    });

    it('should reject paths with null bytes', () => {
      const filePath = projectPath + '\0' + 'file.d';
      expect(service.isPathAllowed(filePath)).toBe(false);
    });

    it('should reject paths with control characters', () => {
      const filePath = projectPath + '\r\n' + 'file.d';
      expect(service.isPathAllowed(filePath)).toBe(false);
    });
  });

  describe('isPathAllowed - relative paths', () => {
    let service: any;

    beforeEach(() => {
      service = new PathValidationService(allowedPaths);
    });

    it('should reject relative paths without base', () => {
      const filePath = 'Dialoge/DIA_Test.d';
      expect(service.isPathAllowed(filePath)).toBe(false);
    });

    it('should reject ./ relative path', () => {
      const filePath = './file.d';
      expect(service.isPathAllowed(filePath)).toBe(false);
    });

    it('should reject ~/ home directory expansion', () => {
      const filePath = '~/Documents/secrets.txt';
      expect(service.isPathAllowed(filePath)).toBe(false);
    });
  });

  describe('isPathAllowed - with multiple allowed directories', () => {
    it('should allow paths in any of the allowed directories', () => {
      const projectPath1 = isWin ? 'C:\\Users\\Test\\Project1' : '/tmp/Users/Test/Project1';
      const projectPath2 = isWin ? 'C:\\Users\\Test\\Project2' : '/tmp/Users/Test/Project2';
      const service = new PathValidationService([projectPath1, projectPath2]);

      const file1 = path.join(projectPath1, 'file1.d');
      const file2 = path.join(projectPath2, 'file2.d');

      expect(service.isPathAllowed(file1)).toBe(true);
      expect(service.isPathAllowed(file2)).toBe(true);
    });

    it('should reject paths outside all allowed directories', () => {
      const projectPath1 = isWin ? 'C:\\Users\\Test\\Project1' : '/tmp/Users/Test/Project1';
      const projectPath2 = isWin ? 'C:\\Users\\Test\\Project2' : '/tmp/Users/Test/Project2';
      const service = new PathValidationService([projectPath1, projectPath2]);

      const outsideFile = isWin ? 'C:\\Users\\Test\\Project3\\file.d' : '/tmp/Users/Test/Project3/file.d';
      expect(service.isPathAllowed(outsideFile)).toBe(false);
    });
  });

  describe('validatePath - throws on invalid paths', () => {
    let service: any;

    beforeEach(() => {
      service = new PathValidationService(allowedPaths);
    });

    it('should not throw for valid path', () => {
      const filePath = path.join(projectPath, 'test.d');
      expect(() => service.validatePath(filePath)).not.toThrow();
    });

    it('should throw PathValidationError for directory traversal', () => {
      // Use literal string with .. to test traversal detection (not path.join which normalizes)
      const filePath = projectPath + path.sep + '..' + path.sep + '..' + path.sep + 'etc' + path.sep + 'passwd';
      expect(() => service.validatePath(filePath)).toThrow('Path validation failed');
      expect(() => service.validatePath(filePath)).toThrow('directory traversal');
    });

    it('should throw PathValidationError for absolute path escape', () => {
      const filePath = '/etc/passwd';
      expect(() => service.validatePath(filePath)).toThrow('Path validation failed');
      expect(() => service.validatePath(filePath)).toThrow('not within allowed directories');
    });

    it('should throw PathValidationError for null path', () => {
      expect(() => service.validatePath(null)).toThrow('Path validation failed');
      expect(() => service.validatePath(null)).toThrow('Path must be a non-empty string');
    });

    it('should include attempted path in error message', () => {
      const maliciousPath = '../../../etc/passwd';
      try {
        service.validatePath(maliciousPath);
        fail('Should have thrown error');
      } catch (error: any) {
        expect(error.message).toContain(maliciousPath);
      }
    });
  });

  describe('addAllowedPath', () => {
    it('should allow adding new allowed path at runtime', () => {
      const service = new PathValidationService([projectPath]);
      const newProjectPath = isWin ? 'C:\\Users\\Test\\NewProject' : '/tmp/Users/Test/NewProject';

      // Initially should reject
      const filePath = path.join(newProjectPath, 'test.d');
      expect(service.isPathAllowed(filePath)).toBe(false);

      // Add new allowed path
      service.addAllowedPath(newProjectPath);

      // Now should allow
      expect(service.isPathAllowed(filePath)).toBe(true);
    });

    it('should normalize paths when adding', () => {
      const service = new PathValidationService([projectPath]);
      const unnormalizedPath = isWin
        ? 'C:/Users/Test/../Test/NewProject'
        : '/tmp/Users/Test/../Test/NewProject';

      service.addAllowedPath(unnormalizedPath);

      const normalizedProjectPath = path.normalize(unnormalizedPath);
      const filePath = path.join(normalizedProjectPath, 'test.d');
      expect(service.isPathAllowed(filePath)).toBe(true);
    });
  });

  describe('removeAllowedPath', () => {
    it('should disallow paths after removing from allowed list', () => {
      const service = new PathValidationService([projectPath]);
      const filePath = path.join(projectPath, 'test.d');

      // Initially allowed
      expect(service.isPathAllowed(filePath)).toBe(true);

      // Remove path
      service.removeAllowedPath(projectPath);

      // Now should reject
      expect(service.isPathAllowed(filePath)).toBe(false);
    });
  });

  describe('getAllowedPaths', () => {
    it('should return array of allowed paths', () => {
      const paths = [projectPath, isWin ? 'C:\\Users\\Test\\Project2' : '/tmp/Users/Test/Project2'];
      const service = new PathValidationService(paths);

      const allowed = service.getAllowedPaths();
      expect(allowed).toHaveLength(2);
      expect(allowed).toContain(path.normalize(projectPath));
    });

    it('should return copy not reference', () => {
      const service = new PathValidationService([projectPath]);
      const allowed = service.getAllowedPaths();

      // Mutating returned array shouldn't affect service
      allowed.push(isWin ? 'C:\\Malicious\\Path' : '/tmp/Malicious/Path');

      const maliciousFile = isWin ? 'C:\\Malicious\\Path\\file.d' : '/tmp/Malicious/Path/file.d';
      expect(service.isPathAllowed(maliciousFile)).toBe(false);
    });
  });

  // N3: containment must be segment-aware. A sibling whose first segment merely
  // *begins* with '..' (e.g. "..backup") is a legitimate child, not traversal.
  describe('..-prefix sibling edge (N3)', () => {
    it('should allow a child directory whose name begins with ".." (isPathAllowed)', () => {
      const service = new PathValidationService([projectPath]);
      const filePath = path.join(projectPath, '..backup', 'x.d');
      expect(service.isPathAllowed(filePath)).toBe(true);
    });

    it('should allow a child directory whose name begins with ".." (validatePath)', () => {
      const service = new PathValidationService([projectPath]);
      const filePath = path.join(projectPath, '..backup', 'x.d');
      expect(() => service.validatePath(filePath)).not.toThrow();
    });
  });

  describe('%2e literal filename (IPC-c)', () => {
    it('should allow a real folder whose name literally contains "%2e"', () => {
      const service = new PathValidationService([projectPath]);
      const filePath = path.join(projectPath, 'mod%2e5', 'x.d');
      expect(service.isPathAllowed(filePath)).toBe(true);
      expect(() => service.validatePath(filePath)).not.toThrow();
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
