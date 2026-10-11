import { app } from 'electron';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { spawn } from 'child_process';
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

const MAX_REDIRECTS = 5;

// Metadata responses are tiny; cap the buffered body so a hostile/faulty
// endpoint cannot exhaust memory (N4).
const MAX_METADATA_BYTES = 1024 * 1024; // 1 MiB

// Treat all standard HTTP redirect codes as redirects. 303/307/308 were
// previously unhandled and would fail the request if GitHub/S3 ever emitted
// them (307/308 are the modern method-preserving forms).
function isRedirect(statusCode: number | undefined): boolean {
  return statusCode === 301 || statusCode === 302 || statusCode === 303
    || statusCode === 307 || statusCode === 308;
}

function httpsGet(url: string, redirectsLeft: number = MAX_REDIRECTS): Promise<string> {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': 'daedalus-dialog-editor',
        'Accept': 'application/vnd.github+json',
      }
    };
    https.get(url, options, (res) => {
      if (isRedirect(res.statusCode)) {
        if (res.headers.location && redirectsLeft > 0) {
          resolve(httpsGet(res.headers.location, redirectsLeft - 1));
          return;
        }
        reject(new Error(`HTTP ${res.statusCode}: too many redirects`));
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      let data = '';
      let bytes = 0;
      res.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > MAX_METADATA_BYTES) {
          res.destroy();
          reject(new Error('Response body exceeds 1 MiB cap'));
          return;
        }
        data += chunk;
      });
      res.on('end', () => resolve(data));
      res.on('error', reject);
    }).on('error', reject);
  });
}

export class UpdaterService {
  private settingsService: SettingsService;

  /**
   * The installer download URL offered by the most recent checkForUpdate.
   * downloadUpdate only accepts this exact URL so a compromised renderer
   * cannot drive a download from an arbitrary host.
   */
  private offeredDownloadUrl: string | null = null;

  /**
   * The full UpdateMetadata offered by the most recent checkForUpdate. The
   * whole object is pinned (not just the URL) so the expected sha256/size are
   * fixed at offer time and cannot be re-supplied by a later caller.
   *
   * Integrity limitation (N5): an in-release sha256 protects against
   * truncation, CDN/proxy tampering, and local temp-file swaps — NOT against
   * an attacker who can rewrite the release itself (both the installer and
   * update-meta.json live on the same mutable tag). Only code signing (or an
   * out-of-band pinned key) defends against a release-level attacker.
   */
  private offeredMeta: UpdateMetadata | null = null;

  /**
   * The path of the last successfully downloaded installer. installUpdate
   * only executes this exact path so the renderer cannot run an arbitrary
   * file that happens to sit in the temp directory.
   */
  private downloadedInstallerPath: string | null = null;

  /**
   * The sha256 digest computed while streaming the last successful download.
   * Used as the expected digest at install time when the offered metadata
   * carried no sha256 (R1 tolerance window).
   */
  private downloadedSha256: string | null = null;

  constructor(settingsService: SettingsService) {
    this.settingsService = settingsService;
  }

  async checkForUpdate(): Promise<UpdateCheckResult> {
    const currentVersion = app.getVersion();

    // Skip if this is a dev build (no -build. suffix)
    if (parseBuildNumber(currentVersion) === null) {
      return { updateAvailable: false, currentVersion };
    }

    // The only caller is the renderer's startup check (App.tsx's timer), so
    // the persisted opt-out is honoured here rather than in the renderer — the
    // setting stays a main-process fact and needs no channel of its own.
    const updaterSettings = await this.settingsService.getUpdaterSettings();
    if (!updaterSettings.autoCheckOnStartup) {
      return { updateAvailable: false, currentVersion };
    }

    // Rate-limit: skip if checked within the last hour
    const now = Date.now();
    if (
      updaterSettings.lastCheckTimestamp !== null &&
      now - updaterSettings.lastCheckTimestamp < CHECK_INTERVAL_MS
    ) {
      return { updateAvailable: false, currentVersion };
    }

    // The timestamp is stamped only once the check has actually reached a
    // conclusion (4.13): stamping it here would let one network blip burn the
    // whole hour, so every failed fetch leaves the next startup free to retry.
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
      // The release itself was fetched, so this is an answer, not a blip.
      await this.settingsService.setUpdaterLastCheckTimestamp(now);
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

    await this.settingsService.setUpdaterLastCheckTimestamp(now);

    // A version the user dismissed is not offered again; a version newer than
    // the dismissed one is, because the exact-match comparison stops applying.
    const updateAvailable =
      isNewerVersion(meta.version, currentVersion) &&
      meta.version !== updaterSettings.dismissedVersion;

    // Pin the installer URL and the whole metadata so downloadUpdate can only
    // fetch what we offered and verify against the digest/size we saw here.
    this.offeredDownloadUrl = updateAvailable ? installerAsset.browser_download_url : null;
    this.offeredMeta = updateAvailable ? meta : null;

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
    // Only download the installer URL offered by the most recent check.
    if (!this.offeredDownloadUrl || url !== this.offeredDownloadUrl) {
      throw new Error('downloadUpdate: URL not offered by the last update check');
    }

    const meta = this.offeredMeta;
    const currentVersion = app.getVersion();
    const tempDir = app.getPath('temp');
    const destPath = path.join(tempDir, `daedalus-update-${currentVersion}.exe`);

    return new Promise<string>((resolve, reject) => {
      const failAndUnlink = (err: Error) => {
        fs.unlink(destPath, () => reject(err));
      };

      const doRequest = (requestUrl: string, redirectsLeft: number) => {
        const options = {
          headers: { 'User-Agent': 'daedalus-dialog-editor' }
        };
        https.get(requestUrl, options, (res) => {
          if (isRedirect(res.statusCode)) {
            if (res.headers.location && redirectsLeft > 0) {
              doRequest(res.headers.location, redirectsLeft - 1);
              return;
            }
            reject(new Error(`Download failed with HTTP ${res.statusCode}: too many redirects`));
            return;
          }
          if (res.statusCode !== 200) {
            reject(new Error(`Download failed with HTTP ${res.statusCode}`));
            return;
          }

          const totalStr = res.headers['content-length'];
          const hasContentLength = totalStr !== undefined;
          const total = hasContentLength ? parseInt(totalStr as string, 10) : 0;
          let downloaded = 0;

          // Hash the bytes as they stream to the file so we can verify
          // integrity without a second read pass.
          const hash = crypto.createHash('sha256');
          const fileStream = fs.createWriteStream(destPath);

          res.on('data', (chunk: Buffer) => {
            downloaded += chunk.length;
            hash.update(chunk);
            if (total > 0) {
              onProgress(Math.round((downloaded / total) * 100));
            }
          });
          res.pipe(fileStream);
          fileStream.on('finish', () => {
            fileStream.close(() => {
              // Reject truncated/mismatched downloads before anyone can run them.
              if (hasContentLength && downloaded !== total) {
                failAndUnlink(new Error(
                  `Download size mismatch: expected ${total} bytes (content-length), got ${downloaded}`
                ));
                return;
              }
              if (typeof meta?.size === 'number' && downloaded !== meta.size) {
                failAndUnlink(new Error(
                  `Download size mismatch: expected ${meta.size} bytes (metadata), got ${downloaded}`
                ));
                return;
              }

              const digest = hash.digest('hex');
              if (meta?.sha256) {
                if (digest !== meta.sha256.toLowerCase()) {
                  failAndUnlink(new Error(
                    `Download sha256 mismatch: expected ${meta.sha256}, got ${digest}`
                  ));
                  return;
                }
              } else {
                // R1 tolerance branch — DELETE IN R2: once every install runs a
                // verifier that has seen at least one hashed release, a missing
                // sha256 must become a hard failure. Until then, tolerate it so a
                // rebuild of an old-schema release does not brick auto-update.
                console.warn(
                  '[UpdaterService] update-meta.json has no sha256; skipping hash verification (R1 tolerance)'
                );
              }

              // Record the exact path + digest so installUpdate can re-verify.
              this.downloadedInstallerPath = path.normalize(destPath);
              this.downloadedSha256 = digest;
              resolve(destPath);
            });
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
      doRequest(url, MAX_REDIRECTS);
    });
  }

  installUpdate(installerPath: string): void {
    // Security: verify the path is within temp directory
    const tempDir = path.normalize(app.getPath('temp'));
    const normalizedInstaller = path.normalize(installerPath);
    if (!normalizedInstaller.startsWith(tempDir + path.sep) && normalizedInstaller !== tempDir) {
      throw new Error(`installUpdate: path outside temp directory is not allowed: ${installerPath}`);
    }

    // Security: only run the installer we actually downloaded, not any file
    // the renderer points us at.
    if (!this.downloadedInstallerPath || normalizedInstaller !== this.downloadedInstallerPath) {
      throw new Error(`installUpdate: path is not the downloaded installer: ${installerPath}`);
    }

    // Security (N2): re-hash the file on disk immediately before spawning it.
    // The temp path is predictable and there is arbitrary user think-time
    // between download-finish and clicking Install, so a local process could
    // swap the file. Verifying here (not only after download) closes that
    // TOCTOU window. Prefer the pinned metadata digest; fall back to the
    // digest computed during download for the R1 missing-hash tolerance window.
    const expectedDigest = this.offeredMeta?.sha256
      ? this.offeredMeta.sha256.toLowerCase()
      : this.downloadedSha256;
    if (expectedDigest) {
      const actualDigest = crypto
        .createHash('sha256')
        .update(fs.readFileSync(normalizedInstaller))
        .digest('hex');
      if (actualDigest !== expectedDigest) {
        try { fs.unlinkSync(normalizedInstaller); } catch { /* best effort */ }
        throw new Error(
          `installUpdate: installer sha256 mismatch (file tampered): expected ${expectedDigest}, got ${actualDigest}`
        );
      }
    }

    const child = spawn(installerPath, ['/S'], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    app.quit();
  }
}
