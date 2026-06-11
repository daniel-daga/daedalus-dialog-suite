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

  constructor() {
    this.settingsPath = path.join(app.getPath('userData'), 'settings.json');
  }

  private async ensureSettingsFile(): Promise<void> {
    try {
      await fs.access(this.settingsPath);
    } catch {
      await fs.writeFile(this.settingsPath, JSON.stringify({ recentProjects: [] }, null, 2));
    }
  }

  private async readSettings(): Promise<any> {
    await this.ensureSettingsFile();
    try {
      const data = await fs.readFile(this.settingsPath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      console.error('Error reading settings file:', error);
      return { recentProjects: [] };
    }
  }

  private async writeSettings(settings: any): Promise<void> {
    try {
      await fs.writeFile(this.settingsPath, JSON.stringify(settings, null, 2));
    } catch (error) {
      console.error('Error writing settings file:', error);
    }
  }

  async getRecentProjects(): Promise<RecentProject[]> {
    const settings = await this.readSettings();
    return settings.recentProjects || [];
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
    const recentProjects = await this.getRecentProjects();
    const normalizedTarget = path.normalize(folderPath);
    return recentProjects.some(
      (project) => path.normalize(project.path) === normalizedTarget
    );
  }

  async addRecentProject(projectPath: string, projectName: string): Promise<void> {
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
  }

  async getUpdaterSettings(): Promise<UpdaterSettings> {
    const settings = await this.readSettings();
    return { ...DEFAULT_UPDATER_SETTINGS, ...(settings.updater || {}) };
  }

  async setUpdaterLastCheckTimestamp(timestamp: number): Promise<void> {
    const settings = await this.readSettings();
    settings.updater = { ...DEFAULT_UPDATER_SETTINGS, ...(settings.updater || {}), lastCheckTimestamp: timestamp };
    await this.writeSettings(settings);
  }

  async setUpdaterDismissedVersion(version: string | null): Promise<void> {
    const settings = await this.readSettings();
    settings.updater = { ...DEFAULT_UPDATER_SETTINGS, ...(settings.updater || {}), dismissedVersion: version };
    await this.writeSettings(settings);
  }

  async setUpdaterAutoCheck(enabled: boolean): Promise<void> {
    const settings = await this.readSettings();
    settings.updater = { ...DEFAULT_UPDATER_SETTINGS, ...(settings.updater || {}), autoCheckOnStartup: enabled };
    await this.writeSettings(settings);
  }
}
