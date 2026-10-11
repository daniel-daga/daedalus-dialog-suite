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

  test('unpacks the zenkit-node native addon from the asar', () => {
    // node-gyp-build dlopens build/Release/zenkit_node.node. Inside app.asar it
    // is not a real file on disk, so the World surface has no addon behind it.
    expect(packageJson.build).toBeDefined();
    expect(Array.isArray(packageJson.build.asarUnpack)).toBe(true);
    expect(packageJson.build.asarUnpack).toContain('**/node_modules/zenkit-node/**/*.node');
  });

  test('declares zenkit-node and zen-world as direct runtime dependencies', () => {
    expect(packageJson.dependencies['zenkit-node']).toBeDefined();
    expect(packageJson.dependencies['zen-world']).toBeDefined();
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
