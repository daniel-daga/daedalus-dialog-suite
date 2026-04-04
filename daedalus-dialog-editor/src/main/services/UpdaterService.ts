import { app } from 'electron';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import { UpdateMetadata, UpdateCheckResult } from '../../shared/updater-types';
import { SettingsService } from './SettingsService';

const GITHUB_API_URL = 'https://api.github.com/repos/daniel-daga/daedalus-dialog-suite/releases/tags/windows-latest';
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

export function parseBuildNumber(version: string): number | null {
  const match = version.match(/-build\.(\d+)$/);
  return match ? parseInt(match[1], 10) : null;
}

export function isNewerVersion(remote: string, local: string): boolean {
  const remoteBuild = parseBuildNumber(remote);
  const localBuild = parseBuildNumber(local);

  if (remoteBuild !== null && localBuild !== null) {
    return remoteBuild > localBuild;
  }

  // Fallback: base version comparison (handles 0.2.0 > 0.1.0)
  const r = remote.split('-')[0].split('.').map(Number);
  const l = local.split('-')[0].split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((r[i] || 0) > (l[i] || 0)) return true;
    if ((r[i] || 0) < (l[i] || 0)) return false;
  }
  return false;
}

function httpsGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': 'daedalus-dialog-editor',
        'Accept': 'application/vnd.github+json',
      }
    };
    https.get(url, options, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        if (res.headers.location) {
          resolve(httpsGet(res.headers.location));
          return;
        }
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
      res.on('error', reject);
    }).on('error', reject);
  });
}

export class UpdaterService {
  private settingsService: SettingsService;

  constructor(settingsService: SettingsService) {
    this.settingsService = settingsService;
  }

  async checkForUpdate(): Promise<UpdateCheckResult> {
    const currentVersion = app.getVersion();

    // Skip if this is a dev build (no -build. suffix)
    if (parseBuildNumber(currentVersion) === null) {
      return { updateAvailable: false, currentVersion };
    }

    // Rate-limit: skip if checked within the last hour
    const updaterSettings = await this.settingsService.getUpdaterSettings();
    const now = Date.now();
    if (
      updaterSettings.lastCheckTimestamp !== null &&
      now - updaterSettings.lastCheckTimestamp < CHECK_INTERVAL_MS
    ) {
      return { updateAvailable: false, currentVersion };
    }

    await this.settingsService.setUpdaterLastCheckTimestamp(now);

    let releaseJson: any;
    try {
      const body = await httpsGet(GITHUB_API_URL);
      releaseJson = JSON.parse(body);
    } catch (error) {
      console.error('[UpdaterService] Failed to fetch release metadata:', error);
      return { updateAvailable: false, currentVersion };
    }

    // Find update-meta.json asset
    const assets: any[] = releaseJson.assets || [];
    const metaAsset = assets.find((a: any) => a.name === 'update-meta.json');
    const installerAsset = assets.find((a: any) => a.name === 'daedalus-dialog-editor-windows-latest.exe');

    if (!metaAsset || !installerAsset) {
      console.warn('[UpdaterService] update-meta.json or installer not found in release assets');
      return { updateAvailable: false, currentVersion };
    }

    let meta: UpdateMetadata;
    try {
      const metaBody = await httpsGet(metaAsset.browser_download_url);
      meta = JSON.parse(metaBody);
    } catch (error) {
      console.error('[UpdaterService] Failed to fetch update-meta.json:', error);
      return { updateAvailable: false, currentVersion };
    }

    const updateAvailable = isNewerVersion(meta.version, currentVersion);

    return {
      updateAvailable,
      currentVersion,
      latestVersion: meta.version,
      latestBuildNumber: meta.buildNumber,
      downloadUrl: installerAsset.browser_download_url,
      releaseUrl: releaseJson.html_url,
    };
  }

  async downloadUpdate(url: string, onProgress: (percent: number) => void): Promise<string> {
    const currentVersion = app.getVersion();
    const tempDir = app.getPath('temp');
    const destPath = path.join(tempDir, `daedalus-update-${currentVersion}.exe`);

    return new Promise((resolve, reject) => {
      const doRequest = (requestUrl: string) => {
        const options = {
          headers: { 'User-Agent': 'daedalus-dialog-editor' }
        };
        https.get(requestUrl, options, (res) => {
          if (res.statusCode === 301 || res.statusCode === 302) {
            if (res.headers.location) {
              doRequest(res.headers.location);
              return;
            }
          }
          if (res.statusCode !== 200) {
            reject(new Error(`Download failed with HTTP ${res.statusCode}`));
            return;
          }

          const totalStr = res.headers['content-length'];
          const total = totalStr ? parseInt(totalStr, 10) : 0;
          let downloaded = 0;

          const fileStream = fs.createWriteStream(destPath);
          res.on('data', (chunk: Buffer) => {
            downloaded += chunk.length;
            if (total > 0) {
              onProgress(Math.round((downloaded / total) * 100));
            }
          });
          res.pipe(fileStream);
          fileStream.on('finish', () => {
            fileStream.close();
            resolve(destPath);
          });
          fileStream.on('error', (err) => {
            fs.unlink(destPath, () => {});
            reject(err);
          });
          res.on('error', (err) => {
            fs.unlink(destPath, () => {});
            reject(err);
          });
        }).on('error', reject);
      };
      doRequest(url);
    });
  }

  installUpdate(installerPath: string): void {
    // Security: verify the path is within temp directory
    const tempDir = path.normalize(app.getPath('temp'));
    const normalizedInstaller = path.normalize(installerPath);
    if (!normalizedInstaller.startsWith(tempDir + path.sep) && normalizedInstaller !== tempDir) {
      throw new Error(`installUpdate: path outside temp directory is not allowed: ${installerPath}`);
    }

    const { spawn } = require('child_process');
    const child = spawn(installerPath, ['/S'], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    app.quit();
  }
}
