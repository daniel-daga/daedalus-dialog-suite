#!/usr/bin/env bash
# Installs the monorepo's dependencies so the parser, zen-world and editor
# tests, lint and typecheck run out of the box. Any fresh checkout uses it: a
# person, a CI runner, or an agent harness's cloud environment setup.
# The traps behind each step are in docs/reference/environment-hazards.md.
set -euo pipefail

cd "$(dirname "$0")/.."

# CI=1 makes zenkit-node's install hook skip the native ZenGin source build,
# which otherwise fails without the submodule and takes the whole install down.
# Set ZENKIT_NODE_FORCE_BUILD=1 (with the submodule checked out) to build it.
CI=1 pnpm install --frozen-lockfile

# The workspaces' postinstalls build zen-world/dist, daedalus-parser/dist and
# the parser's tree-sitter binding, which the editor consumes instead of sources.

# CI=1 also skips Electron's binary download; Electron then fetches it on first
# require, which races under parallel Jest. Fetch it now so it is cached.
pnpm --filter daedalus-dialog-editor exec node -e "require('electron')"
