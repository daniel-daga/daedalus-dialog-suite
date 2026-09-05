# AGENTS.md

Generic instructions for coding agents working in this repository.

## Repository Scope

This is a monorepo with four workspaces:

- `daedalus-dialog-editor/` - Electron + React visual editor
- `daedalus-parser/` - Tree-sitter parser + semantic/codegen library
- `zenkit-node/` - N-API binding around ZenKit, plus the `zen-roundtrip` fidelity harness
- `zen-world/` - pure TS level-editor domain (no React/MUI/Electron/native imports)

Use package-local instructions when working inside a workspace:

- `daedalus-dialog-editor/AGENTS.md`
- `daedalus-parser/AGENTS.md`
- `zenkit-node/README.md`, `zen-world/README.md`

## Tracking Work

Work is tracked in GitHub issues, not in a file. Read the open ones at the start
of a session and file what you learned before it ends;
[`docs/WORKFLOW.md`](docs/WORKFLOW.md) says how an issue is written, which
labels mean what, and which of them an unattended run may take.

## Core Working Rules

1. Use TDD for feature work and bug fixes:
   - add or update a failing test first
   - implement the minimal fix
   - run relevant tests and confirm green
2. Prefer existing test infrastructure over ad-hoc scripts or temp files.
3. Keep changes focused and minimal; do not add unnecessary docs or scaffolding.
4. Verify with workspace-level commands before claiming completion.

## Worktrees for Parallel Agents

**One agent, one worktree.** Two agents in the same checkout collide — on the
working tree, on `git stash`, on a full-suite run that reads a neighbour's
half-written file. Unless a human tells you otherwise, do not work in the main
checkout while another agent is active; take a worktree of your own.

```
npm run wt:new  -- <name>     # .worktrees/<name> on branch agent/<name>, installed
npm run wt:list               # every worktree, its branch, whether it is dirty
npm run wt:rm   -- <name>     # refuses while dirty or ahead of master
```

- `wt:new` branches from `master` (`--from <ref>` to change it), copies the
  prebuilt native addons out of the main checkout, and runs `pnpm install` —
  about a minute, and **no ZenKit or tree-sitter compile**, because the seeded
  `.node` files satisfy `node-gyp-build` before either install hook builds.
  `--no-install` skips the install; `--branch <b>` overrides `agent/<name>`.
- The seeded addons are a *copy of whatever the main checkout last built*. They
  go stale exactly as described in `docs/reference/environment-hazards.md`,
  "Building the native addon" — rebuild inside your worktree if you touch the
  binding or the grammar.
- Land your work by merging `agent/<name>` into `master` from the main checkout,
  then `npm run wt:rm -- <name>`. The branch survives the removal.
- Never edit files in another agent's worktree, and never `git stash` — it takes
  the whole tree, which in a shared checkout is somebody else's work.
- Working directories are per-agent but the git *repository* is shared: a branch
  name, a `git gc`, and a rebase of `master` are still visible to everyone.

## Useful Root Commands

- `npm run build` - build all workspaces
- `npm run test` - run tests across workspaces
- `npm run test:roundtrip-corpus` - parser corpus roundtrip check
- `npm run wt:new -- <name>` - a worktree of your own (see above)

## Sandbox Notes (Codex)

- In Codex sandbox, `npm run build --workspace daedalus-dialog-editor` can fail during Vite startup with `Error: spawn EPERM` (from `esbuild` process spawn).
- If this happens, rerun the same build command with elevated permissions; the build succeeds outside sandbox.
