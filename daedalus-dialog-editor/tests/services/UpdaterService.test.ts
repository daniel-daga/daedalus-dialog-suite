import { parseBuildNumber, isNewerVersion, UpdaterService } from '../../src/main/services/UpdaterService';
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

function buildMockRelease(metaVersion: string, buildNumber: number) {
  const meta = JSON.stringify({ version: metaVersion, baseVersion: metaVersion.split('-')[0], buildNumber });
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
  const https = require('https');
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
    const { app } = require('electron');
    (app.getVersion as jest.Mock).mockReturnValue('0.1.0');

    const result = await service.checkForUpdate();
    expect(result.updateAvailable).toBe(false);
  });

  it('returns no update when checked within the last hour', async () => {
    const { app } = require('electron');
    (app.getVersion as jest.Mock).mockReturnValue('0.1.0-build.10');
    mockGetUpdaterSettings.mockResolvedValue(
      makeDefaultUpdaterSettings({ lastCheckTimestamp: Date.now() - 1000 })
    );

    const result = await service.checkForUpdate();
    expect(result.updateAvailable).toBe(false);
  });

  it('detects an available update when remote build is higher', async () => {
    const { app } = require('electron');
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
    const { app } = require('electron');
    (app.getVersion as jest.Mock).mockReturnValue('0.1.0-build.20');
    mockGetUpdaterSettings.mockResolvedValue(makeDefaultUpdaterSettings());

    const { meta, release } = buildMockRelease('0.1.0-build.20', 20);
    setupHttpsMock([{ body: release }, { body: meta }]);

    const result = await service.checkForUpdate();
    expect(result.updateAvailable).toBe(false);
  });

  it('handles network error gracefully (returns no update)', async () => {
    const { app } = require('electron');
    (app.getVersion as jest.Mock).mockReturnValue('0.1.0-build.10');
    mockGetUpdaterSettings.mockResolvedValue(makeDefaultUpdaterSettings());

    const https = require('https');
    (https.get as jest.Mock).mockImplementation((_url: string, _opts: any, _callback: any) => {
      const req = { on: jest.fn((event: string, handler: any) => { if (event === 'error') handler(new Error('Network failure')); }) };
      return req;
    });

    const result = await service.checkForUpdate();
    expect(result.updateAvailable).toBe(false);
  });

  it('handles missing assets in release gracefully', async () => {
    const { app } = require('electron');
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
    const { app } = require('electron');
    (app.getVersion as jest.Mock).mockReturnValue('0.1.0-build.10');
    mockGetUpdaterSettings.mockResolvedValue(makeDefaultUpdaterSettings());

    const service = new UpdaterService(mockSettingsService);
    const { meta, release } = buildMockRelease('0.1.0-build.20', 20);
    setupHttpsMock([{ body: release }, { body: meta }]);

    const result = await service.checkForUpdate();
    expect(result.downloadUrl).toBe('https://example.com/installer.exe');

    // The offered URL must pass the pinning check (the mocked https response
    // is not a valid download stream, so only assert it gets past the guard).
    const https = require('https');
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
    const { app } = require('electron');
    (app.getVersion as jest.Mock).mockReturnValue('0.1.0-build.10');
    mockGetUpdaterSettings.mockResolvedValue(makeDefaultUpdaterSettings());

    const https = require('https');
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
});
