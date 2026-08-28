#!/usr/bin/env bash
# Work through docs/BOARD.md with `claude -p`, one card per fresh session.
#
# Each iteration: Claude reads the board, picks the next *unowned, actionable*
# card in Next, moves it to Now, implements it TDD-style until tests and lint
# pass, moves it to Done, commits, and ends its reply with one sentinel line:
#
#   BOARD_LOOP: CARD <title>      a card landed (loop continues)
#   BOARD_LOOP: BLOCKED <reason>  the chosen card could not be finished
#   BOARD_LOOP: DONE              nothing actionable is left (loop exits)
#
# Usage:  scripts/board-loop.sh [-n MAX_ITERATIONS] [-m MODEL]
# Env:    CLAUDE_FLAGS   extra flags for `claude -p`
#                        (default: --permission-mode auto — the loop is
#                        unattended, so a prompt that needs answering would fail)
#         ALLOW_DIRTY=1  start even with uncommitted work in the tree
#         MAX_BLOCKED    consecutive BLOCKED/failed runs before giving up (default 2)
#         RETRY_WAIT     seconds to sleep when a run dies on a usage/rate limit
#                        before retrying the same iteration (default 1800);
#                        MAX_LIMIT_WAITS caps how often (default 12)
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

MAX=20
MODEL=""
while getopts "n:m:h" opt; do
  case "$opt" in
    n) MAX="$OPTARG" ;;
    m) MODEL="$OPTARG" ;;
    *) sed -n '2,18p' "$0"; exit 0 ;;
  esac
done

CLAUDE_FLAGS="${CLAUDE_FLAGS:---permission-mode auto}"
MAX_BLOCKED="${MAX_BLOCKED:-2}"
RETRY_WAIT="${RETRY_WAIT:-1800}"
MAX_LIMIT_WAITS="${MAX_LIMIT_WAITS:-12}"
LIMIT_PATTERN='usage limit|rate limit|limit reached|resets at|overloaded|429'
LOG_DIR="$REPO/.claude/board-loop"   # .claude/* is gitignored
mkdir -p "$LOG_DIR"

# The board's own rule: uncommitted work is unfinished work. Each iteration
# commits with `git add -A`, so stray edits would be swept into a card's commit.
if [[ "${ALLOW_DIRTY:-0}" != 1 ]] && \
   [[ -n "$(git status --porcelain -- . ':!zenkit-node/vendor/ZenKit')" ]]; then
  echo "Working tree is dirty. Commit or stash first, or set ALLOW_DIRTY=1." >&2
  git status --short -- . ':!zenkit-node/vendor/ZenKit' >&2
  exit 1
fi

read -r -d '' PROMPT <<'PROMPT_EOF' || true
You are one iteration of an unattended loop that works through docs/BOARD.md.
Follow CLAUDE.md and AGENTS.md as usual (read BOARD.md and the root AGENTS.md
first, then the workspace AGENTS.md for whatever you touch).

Do exactly ONE card this session:

1. If the "Now" section holds a card, that is your card (a previous iteration
   left it unfinished). Otherwise take the FIRST card in "Next" that is
   actionable by you, reading top-down: skip cards owned by Daniel, marked
   "Daniel's call", "no code", "dropped from scope", or "not a gap to close",
   and skip cards whose long form (docs/plans/level-editor.md §16, or the file
   the card points at) says they wait on a decision or a measurement only a
   human can make. Never take a card from "Deferred" or "Triage" — those
   sections are outside the pick path.

   Next is ordered by priority and the order is deliberate. Take the first
   actionable card even if a later one looks smaller or better specified;
   preferring an easier card further down is how the loop ends up setting its
   own priorities.
2. Move the card to "Now" with owner "board-loop".
3. Implement it TDD-style: failing test first, minimal implementation, then
   run the affected workspace's full test suite, lint and typecheck. The card
   is not done until they all pass.
4. Move the card to "Done" with a one-line note, keep the board under its
   80-line card budget, and update any doc the change made stale.
5. Commit everything with a descriptive message, staging with
   `git add -A -- . ':!zenkit-node/vendor/ZenKit'`. Never commit the submodule.
   Do not push.

You may NOT create work for yourself. Do not add a card to "Next", do not split
your card into parts and file them, and do not open a new card for a defect you
noticed on the way. Landing your card and recording what you found is the whole
job; deciding what gets done next is not yours.

If the card is too big for one session — it decomposes into parts that each want
their own test run, or finishing it would mean opening a defect nobody has
assessed — stop. Put the diagnosis in the card's long form as usual, add ONE
line to the board's "Triage" section naming the card and what you found, leave
the card where it was in "Next", commit that, and report BLOCKED. A human
decides whether the parts are worth doing and in what order.

If the card turns out to be blocked for any other reason, write down why (route
it by the board's table — plan section, environment-hazards, or the card
itself), move the card back to "Next" with a one-line "blocked:" note so the
next iteration does not pick it again, commit that, and report BLOCKED.

The very last line of your reply must be exactly one of:
  BOARD_LOOP: CARD <card title>
  BOARD_LOOP: BLOCKED <one-line reason>
  BOARD_LOOP: DONE
Report DONE only when no actionable card remains in Now or Next.
PROMPT_EOF

blocked=0
limit_waits=0
for ((i = 1; i <= MAX; i++)); do
  log="$LOG_DIR/$(date +%Y%m%d-%H%M%S)-$i.log"
  echo "=== iteration $i/$MAX  (log: $log)"

  args=(-p "$PROMPT" --output-format text)
  [[ -n "$MODEL" ]] && args+=(--model "$MODEL")
  # shellcheck disable=SC2086
  if claude "${args[@]}" $CLAUDE_FLAGS 2>&1 | tee "$log"; then :; else
    echo "claude exited non-zero" | tee -a "$log" >&2
  fi

  sentinel="$(grep -E '^BOARD_LOOP: ' "$log" | tail -n 1 || true)"
  case "$sentinel" in
    "BOARD_LOOP: DONE")
      echo "=== board has no actionable cards left; stopping."
      exit 0 ;;
    "BOARD_LOOP: CARD "*)
      blocked=0
      echo "=== landed: ${sentinel#BOARD_LOOP: CARD }" ;;
    *)
      # No sentinel and the run died on a usage/rate limit: the card is still in
      # Now (and any partial edits in the tree), so wait for the window to reset
      # and rerun this iteration instead of burning the blocked budget.
      if [[ -z "$sentinel" ]] && grep -qiE "$LIMIT_PATTERN" "$log"; then
        limit_waits=$((limit_waits + 1))
        if (( limit_waits > MAX_LIMIT_WAITS )); then
          echo "=== hit a usage limit $MAX_LIMIT_WAITS times; stopping." >&2
          exit 1
        fi
        echo "=== usage limit hit ($limit_waits/$MAX_LIMIT_WAITS); sleeping ${RETRY_WAIT}s before retrying iteration $i" >&2
        sleep "$RETRY_WAIT"
        i=$((i - 1))
        continue
      fi
      blocked=$((blocked + 1))
      echo "=== ${sentinel:-no sentinel in output} ($blocked/$MAX_BLOCKED)" >&2
      if (( blocked >= MAX_BLOCKED )); then
        echo "=== $MAX_BLOCKED consecutive blocked/failed iterations; stopping." >&2
        exit 1
      fi ;;
  esac
done
echo "=== reached $MAX iterations; stopping."
