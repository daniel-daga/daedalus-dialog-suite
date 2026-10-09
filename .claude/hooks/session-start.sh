#!/bin/bash
# Installs the monorepo's dependencies in a Claude Code cloud session so the
# parser, zen-world and editor tests, lint and typecheck run out of the box.
# The traps behind each step are in docs/reference/environment-hazards.md.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# CI=1 makes zenkit-node's install hook skip the native ZenGin source build,
# which otherwise fails (no submodule) and takes the whole install down.
CI=1 pnpm install --frozen-lockfile

# The workspaces' postinstalls build zen-world/dist, daedalus-parser/dist and
# the parser's tree-sitter binding, which the editor consumes instead of sources.

# CI=1 also skips Electron's binary download; Electron then fetches it on first
# require, which races under parallel Jest. Fetch it now so it is cached.
pnpm --filter daedalus-dialog-editor exec node -e "require('electron')"
