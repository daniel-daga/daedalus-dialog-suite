const { test } = require('node:test');
const { strict: assert } = require('node:assert');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const workspaceDir = path.resolve(__dirname, '..');

// npm sets `npm_execpath`; pnpm (`pnpm --filter daedalus-parser test`) does
// not, so fall back to `npm` on PATH rather than spawning `.../undefined`.
function runNpmScript(scriptName) {
  const execpath = process.env.npm_execpath;
  const [command, args] = execpath
    ? [process.execPath, [execpath, 'run', scriptName, '--', '--help']]
    : ['npm', ['run', scriptName, '--', '--help']];
  return spawnSync(command, args, {
    cwd: workspaceDir,
    encoding: 'utf8',
    timeout: 120000,
    shell: !execpath
  });
}

test('semantic CLI help succeeds', () => {
  const result = runNpmScript('semantic');
  assert.equal(result.status, 0, `semantic script failed: ${result.stderr || result.error?.message}`);
  assert.ok(result.stdout.includes('Usage:'), 'semantic help output should include usage text');
});

test('format CLI help succeeds', () => {
  const result = runNpmScript('format');
  assert.equal(result.status, 0, `format script failed: ${result.stderr || result.error?.message}`);
  assert.ok(result.stdout.includes('Usage:'), 'format help output should include usage text');
});
