'use strict';

// Agent worktrees: one checkout per agent under .worktrees/, so two agents
// never share a working tree. See AGENTS.md, "Worktrees for parallel agents".
//
//   node tools/worktree.js new <name> [--from <ref>] [--branch <b>] [--no-install]
//   node tools/worktree.js list
//   node tools/worktree.js remove <name> [--force]

const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

// Prebuilt native addons copied into a fresh worktree before install, so the
// install hooks resolve them through node-gyp-build instead of paying for a
// ZenKit/CMake or tree-sitter compile per worktree (environment-hazards.md,
// "Building the native addon").
const SEEDS = [
  'zenkit-node/build/Release/zenkit_node.node',
  'daedalus-parser/build/Release/tree_sitter_daedalus_binding.node',
  // The ABI manifest build-zenkit.js writes; zenkit-node's suite asserts the
  // seeded addon agrees with it.
  'zenkit-node/vendor-build/zenkit/zenkit-abi.json',
];

const git = (args, opts = {}) => {
  const out = execFileSync('git', args, { encoding: 'utf8', ...opts });
  return out === null ? '' : out.trim(); // stdio: 'inherit' captures nothing
};

function mainRoot() {
  // First entry of `git worktree list` is always the main working tree.
  const first = git(['worktree', 'list', '--porcelain']).split('\n')[0];
  return first.replace(/^worktree /, '');
}

function validName(name) {
  if (!name || !/^[a-z0-9][a-z0-9._-]*$/.test(name)) {
    fail(`invalid worktree name ${JSON.stringify(name)} — use lowercase [a-z0-9._-]`);
  }
  return name;
}

function fail(msg) {
  console.error(`worktree: ${msg}`);
  process.exit(1);
}

function flag(argv, name) {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const value = argv[i + 1];
  if (!value || value.startsWith('--')) fail(`--${name} needs a value`);
  argv.splice(i, 2);
  return value;
}

function has(argv, name) {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return false;
  argv.splice(i, 1);
  return true;
}

function cmdNew(argv) {
  const from = flag(argv, 'from') || 'master';
  const branchArg = flag(argv, 'branch');
  const noInstall = has(argv, 'no-install');
  const name = validName(argv[0]);
  const branch = branchArg || `agent/${name}`;

  const root = mainRoot();
  const dir = path.join(root, '.worktrees', name);
  if (fs.existsSync(dir)) fail(`${dir} already exists`);

  const exists = spawnSync('git', ['rev-parse', '--verify', '--quiet', branch]).status === 0;
  console.log(`worktree: ${dir}\nbranch:   ${branch}${exists ? ' (existing)' : ` (new, from ${from})`}`);
  git(exists
    ? ['worktree', 'add', dir, branch]
    : ['worktree', 'add', '-b', branch, dir, from], { stdio: 'inherit' });

  for (const rel of SEEDS) {
    const src = path.join(root, rel);
    if (!fs.existsSync(src)) {
      console.log(`seed:     skipped ${rel} (not built here)`);
      continue;
    }
    const dest = path.join(dir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    console.log(`seed:     ${rel}`);
  }

  if (noInstall) {
    console.log('\nSkipped install. Run `pnpm install` in the worktree before testing.');
  } else {
    console.log('\npnpm install ...');
    const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
    const r = spawnSync(pnpm, ['install'], { cwd: dir, stdio: 'inherit' });
    if (r.status !== 0) fail('pnpm install failed — fix it in the worktree, the tree itself is fine');
  }

  console.log(`\nReady. Work in ${dir} and nowhere else.`);
}

function cmdList() {
  const root = mainRoot();
  for (const block of git(['worktree', 'list', '--porcelain']).split('\n\n')) {
    const dir = (block.match(/^worktree (.*)$/m) || [])[1];
    if (!dir) continue;
    const branch = (block.match(/^branch refs\/heads\/(.*)$/m) || [])[1] || 'detached';
    const dirty = git(['status', '--porcelain'], { cwd: dir }).split('\n').filter(Boolean).length;
    const label = path.resolve(dir) === path.resolve(root) ? '(main)' : path.basename(dir);
    console.log(`${label.padEnd(24)} ${branch.padEnd(32)} ${dirty ? `${dirty} changed` : 'clean'}`);
  }
}

function cmdRemove(argv) {
  const force = has(argv, 'force');
  const name = validName(argv[0]);
  const dir = path.join(mainRoot(), '.worktrees', name);
  if (!fs.existsSync(dir)) fail(`no worktree at ${dir}`);

  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir });
  const dirty = git(['status', '--porcelain'], { cwd: dir }).split('\n').filter(Boolean).length;
  const ahead = git(['rev-list', '--count', 'master..HEAD'], { cwd: dir });
  if (!force) {
    if (dirty) fail(`${name} has ${dirty} uncommitted change(s) — commit them, or pass --force`);
    if (ahead !== '0') fail(`${branch} is ${ahead} commit(s) ahead of master — merge it first, or pass --force`);
  }

  // `git worktree remove` stops at node_modules and the native build output it
  // does not track ("Directory not empty"), so delete the tree ourselves.
  fs.rmSync(dir, { recursive: true, force: true });
  git(['worktree', 'prune']);
  console.log(`Removed ${dir}. Branch ${branch} is kept — delete it with \`git branch -d ${branch}\`.`);
}

const [sub, ...rest] = process.argv.slice(2);
if (sub === 'new') cmdNew(rest);
else if (sub === 'list') cmdList();
else if (sub === 'remove' || sub === 'rm') cmdRemove(rest);
else {
  console.error('usage: node tools/worktree.js new <name> [--from <ref>] [--branch <b>] [--no-install]\n       node tools/worktree.js list\n       node tools/worktree.js remove <name> [--force]');
  process.exit(1);
}
