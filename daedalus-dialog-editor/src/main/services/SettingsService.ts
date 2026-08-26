import { app } from 'electron';
import * as path from 'path';
import { promises as fs } from 'fs';
import { RecentProject } from '../../shared/types';
import { UpdaterSettings } from '../../shared/updater-types';

const MAX_RECENT_PROJECTS = 10;

const DEFAULT_UPDATER_SETTINGS: UpdaterSettings = {
  autoCheckOnStartup: true,
  lastCheckTimestamp: null,
  dismissedVersion: null,
};

export class SettingsService {
  private settingsPath: string;
  // Serializes all read-modify-write operations so concurrent setters cannot
  // interleave and drop one another's fields. Every public method that touches
  // the file routes through `enqueue`.
  private queue: Promise<unknown> = Promise.resolve();

  constructor() {
    this.settingsPath = path.join(app.getPath('userData'), 'settings.json');
  }

  /**
   * Chain `op` onto the serialization queue so operations run one at a time in
   * FIFO order. A rejection from one op does not break the chain for the next.
   */
  private enqueue<T>(op: () => Promise<T>): Promise<T> {
    const run = this.queue.then(op, op);
    // Keep the chain alive even if this op rejects; callers still see the error.
    this.queue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  private async readSettings(): Promise<any> {
    let data: string;
    try {
      data = await fs.readFile(this.settingsPath, 'utf8');
    } catch {
      // No settings file yet.
      return { recentProjects: [] };
    }
    try {
      return JSON.parse(data);
    } catch (error) {
      // Preserve the corrupt file as evidence before falling back to defaults:
      // settings seed the path whitelist, so a silent reset destroys evidence.
      const corruptPath = `${this.settingsPath}.corrupt-${Date.now()}`;
      try {
        await fs.rename(this.settingsPath, corruptPath);
        console.error(
          `Settings file was corrupt and could not be parsed. Preserved at ${corruptPath}; falling back to defaults.`,
          error
        );
      } catch (renameError) {
        console.error(
          'Settings file was corrupt and could not be parsed, and preserving it failed; falling back to defaults.',
          error,
          renameError
        );
      }
      return { recentProjects: [] };
    }
  }

  /**
   * Atomic write: serialize to a sibling temp file, best-effort fsync, then
   * rename over the real file. A crash/ENOSPC mid-write leaves the previous
   * settings.json intact rather than a torn file. Errors are not swallowed.
   */
  private async writeSettings(settings: any): Promise<void> {
    const tmpPath = `${this.settingsPath}.tmp`;
    const data = JSON.stringify(settings, null, 2);
    const handle = await fs.open(tmpPath, 'w');
    try {
      await handle.writeFile(data);
      // Best-effort durability; not fatal if the platform rejects it.
      try {
        await handle.sync();
      } catch {
        // ignore
      }
    } finally {
      await handle.close();
    }
    await fs.rename(tmpPath, this.settingsPath);
  }

  async getRecentProjects(): Promise<RecentProject[]> {
    return this.enqueue(async () => {
      const settings = await this.readSettings();
      return settings.recentProjects || [];
    });
  }

  /**
   * Whether `folderPath` matches a persisted recent project (compared as
   * normalized paths). Used to gate renderer-initiated path whitelisting so a
   * compromised renderer cannot whitelist arbitrary directories.
   */
  async isKnownRecentProject(folderPath: string): Promise<boolean> {
    if (typeof folderPath !== 'string' || folderPath.trim() === '') {
      return false;
    }
    return this.enqueue(async () => {
      const settings = await this.readSettings();
      const recentProjects: RecentProject[] = settings.recentProjects || [];
      const normalizedTarget = path.normalize(folderPath);
      return recentProjects.some(
        (project) => path.normalize(project.path) === normalizedTarget
      );
    });
  }

  async addRecentProject(projectPath: string, projectName: string): Promise<void> {
    return this.enqueue(async () => {
      const settings = await this.readSettings();
      const recentProjects: RecentProject[] = settings.recentProjects || [];

      // Remove if already exists (to move it to top)
      const filtered = recentProjects.filter(p => p.path !== projectPath);

      const newProject: RecentProject = {
        path: projectPath,
        name: projectName,
        lastOpened: Date.now()
      };

      const updated = [newProject, ...filtered].slice(0, MAX_RECENT_PROJECTS);

      settings.recentProjects = updated;
      await this.writeSettings(settings);
    });
  }

  async getUpdaterSettings(): Promise<UpdaterSettings> {
    return this.enqueue(async () => {
      const settings = await this.readSettings();
      return { ...DEFAULT_UPDATER_SETTINGS, ...(settings.updater || {}) };
    });
  }

  async setUpdaterLastCheckTimestamp(timestamp: number): Promise<void> {
    return this.enqueue(async () => {
      const settings = await this.readSettings();
      settings.updater = { ...DEFAULT_UPDATER_SETTINGS, ...(settings.updater || {}), lastCheckTimestamp: timestamp };
      await this.writeSettings(settings);
    });
  }

  async setUpdaterDismissedVersion(version: string | null): Promise<void> {
    return this.enqueue(async () => {
      const settings = await this.readSettings();
      settings.updater = { ...DEFAULT_UPDATER_SETTINGS, ...(settings.updater || {}), dismissedVersion: version };
      await this.writeSettings(settings);
    });
  }

  async setUpdaterAutoCheck(enabled: boolean): Promise<void> {
    return this.enqueue(async () => {
      const settings = await this.readSettings();
      settings.updater = { ...DEFAULT_UPDATER_SETTINGS, ...(settings.updater || {}), autoCheckOnStartup: enabled };
      await this.writeSettings(settings);
    });
  }

  /**
   * The Gothic installation the World surface mounts assets from. Machine-local
   * and non-committed by design (level-editor.md §9): the project file records
   * the worlds and the target version, the install path belongs to the machine.
   *
   * It doubles as a path-whitelist seed, exactly like recent projects: only a
   * main-process folder dialog ever writes it, so a compromised renderer cannot
   * whitelist a directory by claiming it is the Gothic install.
   */
  async getGothicInstallPath(): Promise<string | null> {
    return this.enqueue(async () => {
      const settings = await this.readSettings();
      return typeof settings.gothicInstallPath === 'string' ? settings.gothicInstallPath : null;
    });
  }

  async setGothicInstallPath(installPath: string): Promise<void> {
    return this.enqueue(async () => {
      const settings = await this.readSettings();
      settings.gothicInstallPath = installPath;
      await this.writeSettings(settings);
    });
  }
}
