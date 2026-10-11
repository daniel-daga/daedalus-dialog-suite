# Contributing

Thanks for helping. Bug reports, ideas, docs fixes and code are all welcome.

## Reporting

- **Bugs and ideas:** [open an issue](https://github.com/daniel-daga/daedalus-dialog-suite/issues/new/choose).
  For a bug, include the app version, what you did, what happened and what you
  expected. A minimal `.d` snippet that reproduces a parse or save problem is
  the most useful thing you can attach. Never attach game files you are not
  allowed to share.
- **Security issues:** see [SECURITY.md](SECURITY.md) — not a public issue.

## Setting up a checkout

You need Node.js 20+, [pnpm](https://pnpm.io) 10 and git. The editor targets
Windows; the parser, `zen-world` and most editor tests also run on Linux and
macOS.

```bash
git clone --recurse-submodules https://github.com/daniel-daga/daedalus-dialog-suite.git
cd daedalus-dialog-suite
scripts/setup.sh                      # pnpm install + the builds the editor consumes
git config core.hooksPath .githooks   # strips AI attribution trailers from commits
```

`scripts/setup.sh` skips the native ZenKit build, which the world editor needs.
To build it, check out the submodule and set `ZENKIT_NODE_FORCE_BUILD=1`; see
[`zenkit-node/README.md`](zenkit-node/README.md) and
[`docs/reference/environment-hazards.md`](docs/reference/environment-hazards.md)
for the traps.

Run the editor with `pnpm --filter daedalus-dialog-editor dev`.

## Making a change

1. **Find or open an issue** first for anything bigger than a small fix, so the
   approach can be agreed before you write it. [`docs/WORKFLOW.md`](docs/WORKFLOW.md)
   says how issues are written and what the labels mean.
2. **Test first.** Every behaviour change starts with a failing test: Jest for
   logic, stores and components, a Playwright spec under
   `daedalus-dialog-editor/tests/e2e/` for a new UI workflow, `node --test` in
   the parser. A test must fail without your change.
3. **Keep it focused.** One concern per PR, matching the surrounding code's
   style. No drive-by refactors.
4. **Run what you touched** before opening the PR: the tests you wrote or
   changed, plus lint and typecheck for that workspace, for example
   `pnpm --filter daedalus-dialog-editor test -- <file>`,
   `pnpm --filter daedalus-dialog-editor lint`,
   `pnpm --filter daedalus-parser typecheck`. The full suites run in CI
   (`all-tests.yml`); a maintainer starts it on your PR.
5. **Update the docs** that describe what you changed, in the same PR. If the
   change is user-facing, add a line to `RELEASE_NOTES.md`
   (`- #123: Short description`).

## Where things are

- [`AGENTS.md`](AGENTS.md) — the full developer map: workspaces, key source
  paths, commands, CI, conventions. It doubles as the instructions for coding
  agents, whichever tool you use.
- [`docs/`](docs/README.md) — architecture decisions, behaviour references and
  active plans.
- [`daedalus-parser/README.md`](daedalus-parser/README.md) and
  [`API.md`](daedalus-parser/API.md) — using the parser on its own.

## Commits and AI tools

You may use AI coding tools. Commits are authored under your own name, and
messages carry no AI attribution (no `Co-Authored-By:` trailers for models or
tools, no session links). The `.githooks/commit-msg` hook removes them for you.
You are responsible for what you submit.

## License

By contributing you agree that your contribution is licensed under the
project's [MIT license](LICENSE).
