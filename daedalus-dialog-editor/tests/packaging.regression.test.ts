import * as fs from 'fs';
import * as path from 'path';

describe('packaging config regression guards', () => {
  const packageJsonPath = path.resolve(__dirname, '../package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

  test('declares safe-buffer as a direct runtime dependency', () => {
    expect(packageJson.dependencies).toBeDefined();
    expect(packageJson.dependencies['safe-buffer']).toBeDefined();
  });

  test('declares safer-buffer as a direct runtime dependency', () => {
    expect(packageJson.dependencies).toBeDefined();
    expect(packageJson.dependencies['safer-buffer']).toBeDefined();
  });

  test('build files list explicitly includes safe-buffer', () => {
    expect(packageJson.build).toBeDefined();
    expect(Array.isArray(packageJson.build.files)).toBe(true);
    expect(packageJson.build.files).toContain('node_modules/safe-buffer/**/*');
  });

  test('build files list explicitly includes safer-buffer', () => {
    expect(packageJson.build).toBeDefined();
    expect(Array.isArray(packageJson.build.files)).toBe(true);
    expect(packageJson.build.files).toContain('node_modules/safer-buffer/**/*');
  });

  test('build files list does not use broad dist/**/* glob', () => {
    expect(packageJson.build).toBeDefined();
    expect(Array.isArray(packageJson.build.files)).toBe(true);
    expect(packageJson.build.files).not.toContain('dist/**/*');
    expect(packageJson.build.files).toEqual(
      expect.arrayContaining([
        'dist/main/**/*',
        'dist/renderer/**/*',
        'dist/shared/**/*',
        'package.json',
      ]),
    );
  });
});
