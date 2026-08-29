import { parseBuildNumber, isNewerVersion, UpdaterService } from '../../src/main/services/UpdaterService';
import { app } from 'electron';
import * as https from 'https';
import { Readable } from 'stream';
import * as crypto from 'crypto';
import * as realFs from 'fs';
import { SettingsService } from '../../src/main/services/SettingsService';
import { UpdaterSettings } from '../../src/shared/updater-types';

// ============================================================================
// Version parsing / comparison — pure function tests
// ============================================================================

describe('parseBuildNumber', () => {
  it('parses a valid build suffix', () => {
    expect(parseBuildNumber('0.1.0-build.42')).toBe(42);
  });

  it('returns null for a plain semver (dev build)', () => {
    expect(parseBuildNumber('0.1.0')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(parseBuildNumber('')).toBeNull();
  });

  it('handles build number 0', () => {
    expect(parseBuildNumber('1.2.3-build.0')).toBe(0);
  });

  it('handles large build numbers', () => {
    expect(parseBuildNumber('0.1.0-build.9999')).toBe(9999);
  });
});

describe('isNewerVersion', () => {
  it('returns true when remote build is higher', () => {
    expect(isNewerVersion('0.1.0-build.5', '0.1.0-build.3')).toBe(true);
  });

  it('returns false when remote build is lower', () => {
    expect(isNewerVersion('0.1.0-build.3', '0.1.0-build.5')).toBe(false);
  });

  it('returns false when build numbers are equal', () => {
    expect(isNewerVersion('0.1.0-build.5', '0.1.0-build.5')).toBe(false);
  });

  it('falls back to semver comparison when no build suffix (minor bump)', () => {
    expect(isNewerVersion('0.2.0', '0.1.0')).toBe(true);
  });

  it('falls back to semver comparison when no build suffix (same)', () => {
    expect(isNewerVersion('0.1.0', '0.1.0')).toBe(false);
  });

  it('falls back to semver comparison when no build suffix (major bump)', () => {
    expect(isNewerVersion('1.0.0', '0.9.9')).toBe(true);
  });

  it('returns false when remote semver is lower (no build suffix)', () => {
    expect(isNewerVersion('0.1.0', '0.2.0')).toBe(false);
  });
});

// ============================================================================
// UpdaterService — mocked HTTPS and SettingsService
// ============================================================================

jest.mock('electron', () => ({
  app: {
    getVersion: jest.fn().mockReturnValue('0.1.0-build.10'),
    getPath: jest.fn().mockReturnValue('/tmp'),
    quit: jest.fn(),
  },
}));

jest.mock('https', () => ({
  get: jest.fn(),
}));

const mockSpawn = jest.fn(() => ({ unref: jest.fn() }));
jest.mock('child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

const mockGetUpdaterSettings = jest.fn();
const mockSetUpdaterLastCheckTimestamp = jest.fn();

const mockSettingsService = {
  getUpdaterSettings: mockGetUpdaterSettings,
  setUpdaterLastCheckTimestamp: mockSetUpdaterLastCheckTimestamp,
} as unknown as SettingsService;

function makeDefaultUpdaterSettings(overrides: Partial<UpdaterSettings> = {}): UpdaterSettings {
  return {
    autoCheckOnStartup: true,
    lastCheckTimestamp: null,
    dismissedVersion: null,
    ...overrides,
  };
}

function buildMockRelease(metaVersion: string, buildNumber: number, extraMeta: Record<string, unknown> = {}) {
  const meta = JSON.stringify({ version: metaVersion, baseVersion: metaVersion.split('-')[0], buildNumber, ...extraMeta });
  const release = JSON.stringify({
    html_url: 'https://github.com/daniel-daga/daedalus-dialog-suite/releases/tag/windows-latest',
    assets: [
      {
        name: 'update-meta.json',
        browser_download_url: 'https://example.com/update-meta.json',
      },
      {
        name: 'daedalus-dialog-editor-windows-latest.exe',
        browser_download_url: 'https://example.com/installer.exe',
      },
    ],
  });
  return { meta, release };
}

function setupHttpsMock(responses: Array<{ body: string; status?: number }>) {
  let callIndex = 0;
  (https.get as jest.Mock).mockImplementation((_url: string, _opts: any, callback: any) => {
    const response = responses[callIndex++] || responses[responses.length - 1];
    const status = response.status ?? 200;
    const mockRes = {
      statusCode: status,
      headers: {},
      on: jest.fn((event: string, handler: any) => {
        if (event === 'data') handler(Buffer.from(response.body));
        if (event === 'end') handler();
        return mockRes;
      }),
    };
    callback(mockRes);
    return { on: jest.fn() };
  });
}

describe('UpdaterService.checkForUpdate', () => {
  let service: UpdaterService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new UpdaterService(mockSettingsService);
    mockSetUpdaterLastCheckTimestamp.mockResolvedValue(undefined);
  });

  it('returns no update when version has no build suffix (dev mode)', async () => {
    (app.getVersion as jest.Mock).mockReturnValue('0.1.0');

    const result = await service.checkForUpdate();
    expect(result.updateAvailable).toBe(false);
  });

  it('returns no update when checked within the last hour', async () => {
    (app.getVersion as jest.Mock).mockReturnValue('0.1.0-build.10');
    mockGetUpdaterSettings.mockResolvedValue(
      makeDefaultUpdaterSettings({ lastCheckTimestamp: Date.now() - 1000 })
    );

    const result = await service.checkForUpdate();
    expect(result.updateAvailable).toBe(false);
  });

  it('detects an available update when remote build is higher', async () => {
    (app.getVersion as jest.Mock).mockReturnValue('0.1.0-build.10');
    mockGetUpdaterSettings.mockResolvedValue(makeDefaultUpdaterSettings());

    const { meta, release } = buildMockRelease('0.1.0-build.20', 20);
    setupHttpsMock([{ body: release }, { body: meta }]);

    const result = await service.checkForUpdate();
    expect(result.updateAvailable).toBe(true);
    expect(result.latestVersion).toBe('0.1.0-build.20');
    expect(result.latestBuildNumber).toBe(20);
    expect(result.downloadUrl).toBe('https://example.com/installer.exe');
  });

  it('returns no update when remote build is same or lower', async () => {
    (app.getVersion as jest.Mock).mockReturnValue('0.1.0-build.20');
    mockGetUpdaterSettings.mockResolvedValue(makeDefaultUpdaterSettings());

    const { meta, release } = buildMockRelease('0.1.0-build.20', 20);
    setupHttpsMock([{ body: release }, { body: meta }]);

    const result = await service.checkForUpdate();
    expect(result.updateAvailable).toBe(false);
  });

  it('handles network error gracefully (returns no update)', async () => {
    (app.getVersion as jest.Mock).mockReturnValue('0.1.0-build.10');
    mockGetUpdaterSettings.mockResolvedValue(makeDefaultUpdaterSettings());

    (https.get as jest.Mock).mockImplementation((_url: string, _opts: any, _callback: any) => {
      const req = { on: jest.fn((event: string, handler: any) => { if (event === 'error') handler(new Error('Network failure')); }) };
      return req;
    });

    const result = await service.checkForUpdate();
    expect(result.updateAvailable).toBe(false);
  });

  it('does not check when autoCheckOnStartup is disabled', async () => {
    (app.getVersion as jest.Mock).mockReturnValue('0.1.0-build.10');
    mockGetUpdaterSettings.mockResolvedValue(
      makeDefaultUpdaterSettings({ autoCheckOnStartup: false })
    );

    const result = await service.checkForUpdate();

    expect(result.updateAvailable).toBe(false);
    expect(https.get).not.toHaveBeenCalled();
    expect(mockSetUpdaterLastCheckTimestamp).not.toHaveBeenCalled();
  });

  it('reports no update for a version the user already dismissed', async () => {
    (app.getVersion as jest.Mock).mockReturnValue('0.1.0-build.10');
    mockGetUpdaterSettings.mockResolvedValue(
      makeDefaultUpdaterSettings({ dismissedVersion: '0.1.0-build.20' })
    );

    const { meta, release } = buildMockRelease('0.1.0-build.20', 20);
    setupHttpsMock([{ body: release }, { body: meta }]);

    const result = await service.checkForUpdate();
    expect(result.updateAvailable).toBe(false);
  });

  it('still reports an update newer than the dismissed version', async () => {
    (app.getVersion as jest.Mock).mockReturnValue('0.1.0-build.10');
    mockGetUpdaterSettings.mockResolvedValue(
      makeDefaultUpdaterSettings({ dismissedVersion: '0.1.0-build.20' })
    );

    const { meta, release } = buildMockRelease('0.1.0-build.21', 21);
    setupHttpsMock([{ body: release }, { body: meta }]);

    const result = await service.checkForUpdate();
    expect(result.updateAvailable).toBe(true);
    expect(result.latestVersion).toBe('0.1.0-build.21');
  });

  it('handles missing assets in release gracefully', async () => {
    (app.getVersion as jest.Mock).mockReturnValue('0.1.0-build.10');
    mockGetUpdaterSettings.mockResolvedValue(makeDefaultUpdaterSettings());

    const release = JSON.stringify({ html_url: 'https://example.com', assets: [] });
    setupHttpsMock([{ body: release }]);

    const result = await service.checkForUpdate();
    expect(result.updateAvailable).toBe(false);
  });
});

describe('UpdaterService.installUpdate security', () => {
  it('throws when installer path is outside temp directory', () => {
    const service = new UpdaterService(mockSettingsService);
    expect(() => service.installUpdate('/etc/passwd')).toThrow('outside temp directory');
  });

  it('throws when installer path is not the last downloaded installer', () => {
    const service = new UpdaterService(mockSettingsService);
    // Inside the temp dir, but never produced by downloadUpdate
    expect(() => service.installUpdate('/tmp/evil.exe')).toThrow('not the downloaded installer');
  });
});

describe('UpdaterService.downloadUpdate security', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSetUpdaterLastCheckTimestamp.mockResolvedValue(undefined);
  });

  it('rejects a download URL that was not offered by checkForUpdate', async () => {
    const service = new UpdaterService(mockSettingsService);
    await expect(
      service.downloadUpdate('https://attacker.example/installer.exe', () => {})
    ).rejects.toThrow('not offered by the last update check');
  });

  it('accepts the URL offered by the last checkForUpdate', async () => {
    (app.getVersion as jest.Mock).mockReturnValue('0.1.0-build.10');
    mockGetUpdaterSettings.mockResolvedValue(makeDefaultUpdaterSettings());

    const service = new UpdaterService(mockSettingsService);
    const { meta, release } = buildMockRelease('0.1.0-build.20', 20);
    setupHttpsMock([{ body: release }, { body: meta }]);

    const result = await service.checkForUpdate();
    expect(result.downloadUrl).toBe('https://example.com/installer.exe');

    // The offered URL must pass the pinning check (the mocked https response
    // is not a valid download stream, so only assert it gets past the guard).
    (https.get as jest.Mock).mockImplementation((_url: string, _opts: any, callback: any) => {
      const mockRes = {
        statusCode: 404,
        headers: {},
        on: jest.fn().mockReturnThis(),
        pipe: jest.fn(),
      };
      callback(mockRes);
      return { on: jest.fn() };
    });

    await expect(
      service.downloadUpdate(result.downloadUrl!, () => {})
    ).rejects.toThrow('HTTP 404');
  });
});

describe('UpdaterService redirect handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSetUpdaterLastCheckTimestamp.mockResolvedValue(undefined);
  });

  it('gives up after a bounded number of redirects instead of recursing forever', async () => {
    (app.getVersion as jest.Mock).mockReturnValue('0.1.0-build.10');
    mockGetUpdaterSettings.mockResolvedValue(makeDefaultUpdaterSettings());

    (https.get as jest.Mock).mockImplementation((_url: string, _opts: any, callback: any) => {
      const mockRes = {
        statusCode: 302,
        headers: { location: 'https://example.com/loop' },
        on: jest.fn().mockReturnThis(),
      };
      callback(mockRes);
      return { on: jest.fn() };
    });

    const service = new UpdaterService(mockSettingsService);
    const result = await service.checkForUpdate();

    expect(result.updateAvailable).toBe(false);
    // 1 initial request + at most 5 redirects
    expect((https.get as jest.Mock).mock.calls.length).toBeLessThanOrEqual(6);
  });

  it.each([303, 307, 308])('bounds %d redirects the same way as 301/302', async (status) => {
    (app.getVersion as jest.Mock).mockReturnValue('0.1.0-build.10');
    mockGetUpdaterSettings.mockResolvedValue(makeDefaultUpdaterSettings());

    (https.get as jest.Mock).mockImplementation((_url: string, _opts: any, callback: any) => {
      const mockRes = {
        statusCode: status,
        headers: { location: 'https://example.com/loop' },
        on: jest.fn().mockReturnThis(),
      };
      callback(mockRes);
      return { on: jest.fn() };
    });

    const service = new UpdaterService(mockSettingsService);
    const result = await service.checkForUpdate();

    expect(result.updateAvailable).toBe(false);
    expect((https.get as jest.Mock).mock.calls.length).toBeLessThanOrEqual(6);
  });
});

// ============================================================================
// UpdaterService.downloadUpdate / installUpdate — integrity (sha256 / size)
// Uses real Readable streams so the service's real hashing + file write runs.
// ============================================================================


const DOWNLOAD_DEST = '/tmp/daedalus-update-0.1.0-build.10.exe';

function streamResponse(
  body: string | null,
  { status = 200, headers = {} }: { status?: number; headers?: Record<string, string> } = {}
) {
  const res: any = new Readable({ read() {} });
  res.statusCode = status;
  res.headers = headers;
  process.nextTick(() => {
    if (body != null) res.push(Buffer.from(body));
    res.push(null);
  });
  return res;
}

// Redirect responses are never piped; the service only reads statusCode/location.
function redirectResponse(status: number, location: string) {
  return { statusCode: status, headers: { location } };
}

function setupStreamMock(responses: any[]) {
  let i = 0;
  (https.get as jest.Mock).mockImplementation((_url: string, _opts: any, callback: any) => {
    const r = responses[i++] ?? responses[responses.length - 1];
    callback(r);
    return { on: jest.fn() };
  });
}

describe('UpdaterService.downloadUpdate integrity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (app.getVersion as jest.Mock).mockReturnValue('0.1.0-build.10');
    (app.getPath as jest.Mock).mockReturnValue('/tmp');
    mockGetUpdaterSettings.mockResolvedValue(makeDefaultUpdaterSettings());
    mockSetUpdaterLastCheckTimestamp.mockResolvedValue(undefined);
  });

  afterEach(() => {
    try { realFs.unlinkSync(DOWNLOAD_DEST); } catch { /* ignore */ }
  });

  it('resolves when the streamed bytes match meta.sha256 and meta.size', async () => {
    const body = 'installer-bytes-abcdef';
    const digest = crypto.createHash('sha256').update(body).digest('hex');
    const { meta, release } = buildMockRelease('0.1.0-build.20', 20, { sha256: digest, size: body.length });
    setupStreamMock([
      streamResponse(release),
      streamResponse(meta),
      streamResponse(body, { headers: { 'content-length': String(body.length) } }),
    ]);

    const service = new UpdaterService(mockSettingsService);
    const result = await service.checkForUpdate();
    const dest = await service.downloadUpdate(result.downloadUrl!, () => {});

    expect(realFs.existsSync(dest)).toBe(true);
    expect(realFs.readFileSync(dest).toString()).toBe(body);
  });

  it('rejects and unlinks the file when meta.sha256 does not match', async () => {
    const body = 'installer-bytes-abcdef';
    const wrong = 'a'.repeat(64);
    const { meta, release } = buildMockRelease('0.1.0-build.20', 20, { sha256: wrong, size: body.length });
    setupStreamMock([
      streamResponse(release),
      streamResponse(meta),
      streamResponse(body, { headers: { 'content-length': String(body.length) } }),
    ]);

    const service = new UpdaterService(mockSettingsService);
    const result = await service.checkForUpdate();
    await expect(service.downloadUpdate(result.downloadUrl!, () => {})).rejects.toThrow(/sha256/i);
    expect(realFs.existsSync(DOWNLOAD_DEST)).toBe(false);
  });

  it('rejects when downloaded bytes disagree with content-length', async () => {
    const body = 'only-fifty-ish-bytes';
    const { meta, release } = buildMockRelease('0.1.0-build.20', 20);
    setupStreamMock([
      streamResponse(release),
      streamResponse(meta),
      // Claim 100 bytes but stream far fewer.
      streamResponse(body, { headers: { 'content-length': '100' } }),
    ]);

    const service = new UpdaterService(mockSettingsService);
    const result = await service.checkForUpdate();
    await expect(service.downloadUpdate(result.downloadUrl!, () => {})).rejects.toThrow(/size|length/i);
    expect(realFs.existsSync(DOWNLOAD_DEST)).toBe(false);
  });

  it('rejects when downloaded bytes disagree with meta.size', async () => {
    const body = 'installer-bytes-abcdef';
    const { meta, release } = buildMockRelease('0.1.0-build.20', 20, { size: body.length + 999 });
    setupStreamMock([
      streamResponse(release),
      streamResponse(meta),
      streamResponse(body, { headers: { 'content-length': String(body.length) } }),
    ]);

    const service = new UpdaterService(mockSettingsService);
    const result = await service.checkForUpdate();
    await expect(service.downloadUpdate(result.downloadUrl!, () => {})).rejects.toThrow(/size/i);
    expect(realFs.existsSync(DOWNLOAD_DEST)).toBe(false);
  });

  it('warns and proceeds when meta has no sha256 (R1 tolerance)', async () => {
    const body = 'installer-bytes-abcdef';
    const { meta, release } = buildMockRelease('0.1.0-build.20', 20); // no sha256, no size
    setupStreamMock([
      streamResponse(release),
      streamResponse(meta),
      streamResponse(body, { headers: { 'content-length': String(body.length) } }),
    ]);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const service = new UpdaterService(mockSettingsService);
    const result = await service.checkForUpdate();
    const dest = await service.downloadUpdate(result.downloadUrl!, () => {});

    expect(realFs.existsSync(dest)).toBe(true);
    expect(warnSpy.mock.calls.some((c) => String(c[0]).toLowerCase().includes('sha256'))).toBe(true);
    warnSpy.mockRestore();
  });

  it('follows a 307 redirect and still verifies sha256', async () => {
    const body = 'installer-bytes-abcdef';
    const digest = crypto.createHash('sha256').update(body).digest('hex');
    const { meta, release } = buildMockRelease('0.1.0-build.20', 20, { sha256: digest, size: body.length });
    setupStreamMock([
      streamResponse(release),
      streamResponse(meta),
      redirectResponse(307, 'https://example.com/redirected.exe'),
      streamResponse(body, { headers: { 'content-length': String(body.length) } }),
    ]);

    const service = new UpdaterService(mockSettingsService);
    const result = await service.checkForUpdate();
    const dest = await service.downloadUpdate(result.downloadUrl!, () => {});

    expect(realFs.existsSync(dest)).toBe(true);
    expect(realFs.readFileSync(dest).toString()).toBe(body);
  });

  it('re-hashes the file before install and refuses a tampered installer (N2)', async () => {
    const body = 'installer-bytes-abcdef';
    const digest = crypto.createHash('sha256').update(body).digest('hex');
    const { meta, release } = buildMockRelease('0.1.0-build.20', 20, { sha256: digest, size: body.length });
    setupStreamMock([
      streamResponse(release),
      streamResponse(meta),
      streamResponse(body, { headers: { 'content-length': String(body.length) } }),
    ]);

    const service = new UpdaterService(mockSettingsService);
    const result = await service.checkForUpdate();
    const dest = await service.downloadUpdate(result.downloadUrl!, () => {});

    // A local process swaps the installer between download and install.
    realFs.writeFileSync(dest, 'malicious-payload');

    expect(() => service.installUpdate(dest)).toThrow(/sha256|integrity|mismatch/i);
    expect(mockSpawn).not.toHaveBeenCalled();
    expect(app.quit).not.toHaveBeenCalled();
    // Tampered file is removed.
    expect(realFs.existsSync(dest)).toBe(false);
  });
});
