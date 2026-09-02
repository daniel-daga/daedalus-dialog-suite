/**
 * What the production renderer bundle must not carry.
 *
 * `mockAPI.ts` is the browser-harness stand-in for the main process — 600+
 * lines of fake parser, fake codegen and a localStorage file system. It is
 * only ever installed when `window.editorAPI` is missing, which in a packaged
 * Electron app never happens, so it has no business in the shipped bundle
 * (production-readiness §3 P3). `main.tsx` pulls it in behind
 * `import.meta.env.DEV`, which Vite replaces with a constant at build time so
 * Rollup drops the whole branch, dynamic import included.
 *
 * This builds the renderer into a scratch directory and reads the emitted
 * JavaScript, so it costs a real Vite build — but a grep over `dist/` from
 * some earlier build would prove nothing about the tree under test.
 *
 * @jest-environment node
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const editorRoot = path.resolve(__dirname, '..');

// A name only mockAPI.ts defines: the window hook the harness specs use to
// inject a file-watcher event. The positive check below keeps the marker
// honest — if it is ever renamed, the test fails instead of passing vacuously.
const MOCK_ONLY_MARKER = '__mockEmitFileChange';

function emittedJs(outDir: string): string {
  const assetsDir = path.join(outDir, 'assets');
  return fs
    .readdirSync(assetsDir)
    .filter((name) => name.endsWith('.js'))
    .map((name) => fs.readFileSync(path.join(assetsDir, name), 'utf8'))
    .join('\n');
}

describe('bundleContents', () => {
  let outDir: string;

  beforeAll(() => {
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dde-renderer-bundle-'));
    const viteBin = path.join(
      path.dirname(require.resolve('vite/package.json', { paths: [editorRoot] })),
      'bin/vite.js'
    );
    execFileSync(process.execPath, [viteBin, 'build', '--outDir', outDir], {
      cwd: editorRoot,
      // Jest sets NODE_ENV=test, and Vite only defaults it to production when
      // it is unset — under `test` the build keeps `import.meta.env.DEV` true
      // and the shim ships. Build what `npm run build` builds.
      env: { ...process.env, NODE_ENV: 'production' },
      stdio: 'pipe',
      timeout: 5 * 60 * 1000,
    });
  }, 6 * 60 * 1000);

  afterAll(() => {
    fs.rmSync(outDir, { recursive: true, force: true });
  });

  it('the marker still names something in mockAPI.ts', () => {
    const source = fs.readFileSync(
      path.join(editorRoot, 'src/renderer/utils/mockAPI.ts'),
      'utf8'
    );
    expect(source).toContain(MOCK_ONLY_MARKER);
  });

  it('mockAPI is not in the built renderer', () => {
    // A boolean, not `toContain`: a failure must not print the bundle.
    expect(emittedJs(outDir).includes(MOCK_ONLY_MARKER)).toBe(false);
  });
});
