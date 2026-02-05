import { SettingsService } from '../src/main/services/SettingsService';
import * as fs from 'fs/promises';
import * as path from 'path';
import { app } from 'electron';

jest.mock('electron', () => ({
  app: {
    getPath: jest.fn().mockReturnValue('./test-userData')
  }
}));

describe('SettingsService', () => {
  let settingsService: SettingsService;
  const testUserDataPath = './test-userData';
  const settingsPath = path.join(testUserDataPath, 'settings.json');

  beforeEach(async () => {
    settingsService = new SettingsService();
    try {
      await fs.mkdir(testUserDataPath, { recursive: true });
    } catch (e) {}
  });

  afterEach(async () => {
    try {
      await fs.rm(testUserDataPath, { recursive: true, force: true });
    } catch (e) {}
  });

  it('should return empty list if no settings file exists', async () => {
    const projects = await settingsService.getRecentProjects();
    expect(projects).toEqual([]);
  });

  it('should add a recent project', async () => {
    await settingsService.addRecentProject('/path/to/project', 'TestProject');
    const projects = await settingsService.getRecentProjects();
    
    expect(projects).toHaveLength(1);
    expect(projects[0].name).toBe('TestProject');
    expect(projects[0].path).toBe('/path/to/project');
    expect(projects[0].lastOpened).toBeDefined();
  });

  it('should move existing project to top when re-added', async () => {
    await settingsService.addRecentProject('/path/1', 'Proj1');
    await settingsService.addRecentProject('/path/2', 'Proj2');
    
    let projects = await settingsService.getRecentProjects();
    expect(projects[0].name).toBe('Proj2');
    expect(projects[1].name).toBe('Proj1');

    await settingsService.addRecentProject('/path/1', 'Proj1');
    projects = await settingsService.getRecentProjects();
    
    expect(projects).toHaveLength(2);
    expect(projects[0].name).toBe('Proj1');
    expect(projects[1].name).toBe('Proj2');
  });

  it('should limit the number of recent projects', async () => {
    for (let i = 0; i < 15; i++) {
      await settingsService.addRecentProject(`/path/${i}`, `Proj${i}`);
    }
    
    const projects = await settingsService.getRecentProjects();
    expect(projects).toHaveLength(10);
    expect(projects[0].name).toBe('Proj14');
  });
});
