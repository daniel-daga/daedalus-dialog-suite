const { test } = require('node:test');
const { strict: assert } = require('node:assert');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const workspaceDir = path.resolve(__dirname, '..');

// npm sets `npm_execpath` to its JS entry; pnpm may set it to a native
// `pnpm.exe` (not runnable through node) or leave it unset. Run a JS entry
// through node, an executable directly, and fall back to `npm` on PATH.
function runNpmScript(scriptName) {
  const execpath = process.env.npm_execpath;
  const scriptArgs = ['run', scriptName, '--', '--help'];
  const isJs = Boolean(execpath) && /\.[cm]?js$/i.test(execpath);
  const [command, args] = isJs
    ? [process.execPath, [execpath, ...scriptArgs]]
    : [execpath || 'npm', scriptArgs];
  return spawnSync(command, args, {
    cwd: workspaceDir,
    encoding: 'utf8',
    timeout: 120000,
    shell: !isJs
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
