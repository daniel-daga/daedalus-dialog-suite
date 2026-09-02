import { execFileSync } from 'child_process';
import * as path from 'path';

/**
 * Repo-hygiene guard (production-readiness §2 #5): the editor's workspace
 * root holds the package manifest, configs and `src/` — not one-off debug
 * scripts or encoding samples. Those either live under `tests/fixtures/` or
 * are not tracked at all.
 */

const WORKSPACE_DIR = path.join(__dirname, '..');

const trackedRootFiles = (): string[] =>
  execFileSync('git', ['ls-files', '--', '.'], { cwd: WORKSPACE_DIR, encoding: 'utf8' })
    .split('\n')
    .filter((entry) => entry && !entry.includes('/'));

describe('repo-hygiene guard', () => {
  test('neither debug_file.ts nor win1250.d is tracked at the editor root', () => {
    const tracked = trackedRootFiles();
    expect(tracked).not.toContain('debug_file.ts');
    expect(tracked).not.toContain('win1250.d');
  });
});
