import { app } from 'electron';
import * as path from 'path';
import { promises as fs } from 'fs';
import { RecentProject } from '../../shared/types';

const MAX_RECENT_PROJECTS = 10;

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

  async getRecentProjects(): Promise<RecentProject[]> {
    await this.ensureSettingsFile();
    try {
      const data = await fs.readFile(this.settingsPath, 'utf8');
      const settings = JSON.parse(data);
      return settings.recentProjects || [];
    } catch (error) {
      console.error('Error reading settings file:', error);
      return [];
    }
  }

  async addRecentProject(projectPath: string, projectName: string): Promise<void> {
    await this.ensureSettingsFile();
    try {
      const data = await fs.readFile(this.settingsPath, 'utf8');
      const settings = JSON.parse(data);
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
      await fs.writeFile(this.settingsPath, JSON.stringify(settings, null, 2));
    } catch (error) {
      console.error('Error writing settings file:', error);
    }
  }
}
