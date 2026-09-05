# Workflow

Work is tracked in **GitHub issues**:
<https://github.com/daniel-daga/daedalus-dialog-suite/issues>.

Read the open issues at the start of a session; file what you learned before it
ends. This file holds the two things the tracker cannot: how an issue is meant
to be written, and the state of the tree.

Everything else already has a home, and repeating it is what made the old
handovers cost an hour a session:

| Looking for | It is in |
|---|---|
| what is in flight, and who owns it | the open issues |
| what landed, and why | `git log` — the commit messages carry the reasoning |
| **the long form of an open issue** | `docs/plans/level-editor.md` **§16**, for a level-editor issue |
| the settled architecture | `docs/architecture/level-editor.md` §3-§10, §13 |
| a decision or a measurement | `docs/architecture/level-editor.md` §7 |
| build and test commands | `CLAUDE.md`, and each workspace's `README.md` |
| machine and toolchain hazards | `docs/reference/environment-hazards.md` |
| a known wart nobody is fixing yet | `docs/refactoring-targets.md` |
| the Gate 2 checklist | `zenkit-node/docs/engine-acceptance-2026-08-25.md` §8 |
| **work a run can take unattended** | the `agent-ready` label |
| a 2026-08-29 review finding | `docs/plans/world-editor-review-2026-08-29.md` |
| **a 2026-09-04 review finding** — the second pass the 08-29 review never got | `docs/plans/level-editor-review-2026-09-04.md` |
| a dialog-simulator finding | `docs/plans/dialog-simulator-review-findings.md` |
| a production-readiness finding | `docs/plans/production-readiness-review-findings.md` |
| a 2026-07 code-review item | `docs/plans/code-review-2026-07-remediation.md` |
| the VOB folders design | `docs/plans/vob-folders.md` |

## How an issue is written

**An issue is a title, a few lines of diagnosis, and a pointer to where its long
form lives** — §16 for a level-editor issue, otherwise the file the routing
table names. The prose that explains a finding belongs at that pointer, not in
the issue body, because the pointer is what the next reader of the code finds.
A long issue is the handover prompt coming back.

**An issue closes only when its tests and its linter pass.** Close it from the
commit that finishes it (`Closes #123` in the message) — `git log` is then the
permanent record and the closed issue is the index into it. Nothing is copied
back here.

**A closed issue takes its §16 subsection with it.** Route the forward facts,
delete the rest. `npm run docs:check` (root, and CI) fails while a subsection
still declares itself *closed* or *landed*, and fails a `§N` pointer that
resolves to no heading.

## The labels

| Label | What it means |
|---|---|
| `P1` / `P2` / `P3` | priority. **Lowest number first, then oldest** — that order is the priority, not a filing convention |
| `agent-ready` | an unattended run may take this. **It takes the first one it is allowed to take**, and may not re-prioritise, split, or file new issues |
| `blocked` | cannot proceed; the body says what would unblock it |
| `deferred` | a human deprioritised it. Outside the pick path — moving it back is a human decision |
| `triage` | too big for one issue, or the cut is a person's call. Outside the pick path |
| `needs-decision` | waiting on Daniel, not on work |
| `area:*` | `level-editor`, `editor`, `parser`, `zenkit` |
| `user-feedback` | reported from outside the repo; the body quotes the report verbatim |

`deferred` and `triage` are read and emptied by a person, never by a run. They
exist so deprioritised work stays visible as a decision rather than a silent
drop.

## The rules that outlive any tracker

**Anything said about future work is written down before the session ends.**
Every caveat, every "worth remembering next time", every open question, every
defect noticed and not fixed — if it would change what somebody does next, it
goes in a file or an issue, not in a chat reply. A finding that exists only in a
conversation is lost the moment the conversation is, and the next session pays
to rediscover it. Route it by the table above: a fact about the code to the
plan, a fact about this machine to `environment-hazards.md`, a piece of work to
a new issue. Say where it went, so the routing can be corrected.

**A doc that has gone stale is a defect.** When work invalidates something a
file asserts, fix it in the same change — including comments that record a
constraint the work has just removed. The claim to check hardest is the one that
was true for so long nobody re-reads it.

**Always commit at the end of a session.** Never leave finished work sitting in
the working tree: this file points at `git log` for what landed and why, and
uncommitted work is invisible to it. Split unrelated work into separate commits.
Stage with `git add -A -- . ':!zenkit-node/vendor/ZenKit'` — the submodule is
the applied patch series and is never committed.

---

## State of the tree

- `master` is where work lands and is **pushed to `origin/master`**;
  `feature/level-editor` was merged and is no longer where work happens.
  Every `board-loop*` branch is now **spent** — `master` contains all five, and
  work lands on `master` directly, and is pushed as it lands — it was level with
  `origin/master` on 2026-08-30. A push is not a release — see the merge note
  below.
  No HEAD hash and no count here — a file committed at HEAD cannot name either,
  and a number goes stale the moment anything lands. `git status -sb` answers it.
- **`zenkit-node/vendor/ZenKit` is permanently dirty** and is **never**
  committed: it is the applied patch series, and `patches/` is what that series
  actually is. Since 2026-08-30 the entry carries `ignore = dirty`, so the dirt
  no longer shows in `git status` — a moved submodule *commit* still does,
  which is the change worth seeing. Stage with
  `git add -A -- . ':!zenkit-node/vendor/ZenKit'`, or name paths explicitly.
  Anything else showing is unfinished work — `reports/` used to be the one
  exception and the root `.gitignore` now catches it.
- **Merged to `master` 2026-08-28.** The "deliberately unmerged until an engine
  verdict" rule is retired — Gate 2 passed for the ops it tested (§16.2) and the
  merge was a clean fast-forward, so backing it out is a `git reset --hard` to
  the merge's first parent. Merging is not releasing: `build-windows.yml` is
  `workflow_dispatch:` and nothing else, so a push to master builds no
  installer, cuts no release and touches no update feed. Anything about shipping
  is the dispatch's decision, not this one. The release-gate gaps that used to
  be named here are **all closed** — the addon is asserted present and unpacked,
  the packaged app now opens a world in CI, and a real-Electron spec now watches
  the World surface draw (`world-render.spec.ts`). **Gate 2b closed
  2026-08-30**: every op has been seen doing its work in the engine; the
  unwitnessed remainder is the acceptance record's list under *"What is still
  not witnessed"*.
- **This machine is fully built; every other machine and CI must rebuild** —
  the addon has changed in nearly every recent session, and `git log` says what
  and when. The recipe and every trap in it — `build-zenkit.js` before
  `node-gyp rebuild`, never `build`, `zen-world` before the editor typechecks,
  the full `build` for `verify-world-edit.js` — are in
  `environment-hazards.md`, *"Building the native addon"*, along with why a
  stale `.node` is **silent**: the editor's Jest suites fake the worker, so
  every suite stays green against a binary missing whatever the ops have
  gained since it was built. Do not repeat any of it here.
- `daedalus-dialog-editor/dist/` holds a packaged app (`win-unpacked`, the
  installer) **re-packaged 2026-09-03** for the parse smoke, so it is fresh as
  of that commit — and goes stale again with the next one, because every
  session that only compiles leaves it behind. `.gitignore`d, and it only
  matters if you are about to trust a package already sitting there:
  re-package before you do.

---

## The migration off the board

`docs/BOARD.md` was this file's kanban predecessor. Its open cards became
issues #220–#227 on 2026-09-05; its Done section was already flushed, and
`git log` holds it. Nothing else moved: the routing table above is the board's,
and the rules under it are the board's rules with the card-line budget dropped —
a tracker does not need one.
