# Spacer problem report — what we do not solve yet (2026-09-12)

A community report on the original Spacer, read against this tree. It lists what
a modder suffers in Spacer; this file lists only the parts of it **we do not
answer today**, so each can be triaged into an issue or dropped. Nothing here is
a decision: every item below is an issue now (#264-#275), untriaged, and the
priority labels are a first guess.

The last section says which of the report's complaints are already answered or
structurally cannot apply to us, so triage does not rediscover them.

---

## A. The script pipeline — the largest block, and the least started

### A1. OutputUnits: nothing exists (#264)

Not one line in the tree reads or writes `OU.BIN`, `OU.CSL` or `OUINFO.INF`. The
report's "worst of it" — reparsing does not update the OUs, so a new dialog
compiles cleanly and is silent in game — lands on us unchanged, and our own GMBT
quick test makes it sharper: it passes `--noupdatesubtitles` by decision
(`GmbtService.ts`, plan §16.29), so a line written in this editor and tested
with our own button shows the *old* subtitle. A user who does not know the OU
mechanic reads that as our bug.

Three of the report's OU complaints are one feature (generate or update the OUs
from the project we already parse): the clean-setup ritual, the cumbersome
load→update→refresh→save window, and "you cannot add a single dialogue". We know
every `AI_Output` id and its subtitle text already.

`docs/feature-suggestions.md` P1 item 3.3 names it — *"OU generation, or at
least a consistency check between scripts and an existing `OU.csl`"* — and
nothing has landed. The consistency check is the cheap half and would catch the
beginner trap without writing a binary.

### A2. A language mismatch has nothing to notice it (#265)

"Reparsing with the MDK's German scripts silently reverts your English text" is
the same class as A1 and needs the same data. We hold no notion of two language
variants of a line; localization export/import is `feature-suggestions.md` P3
item 11, unstarted. Worth triaging *with* A1, not separately.

### A3. A quick test that fails tells the user nothing (#266)

The report's "using play-the-game from inside Spacer is itself a crash source"
is answered structurally — we launch GMBT, not an editor-hosted engine — but our
launch is fire-and-forget by decision: detached, `stdio: 'ignore'`, no exit code,
no output capture (plan §16.29). So a failed spawn, a **failed script reparse**,
or a GMBT error surfaces as nothing at all; the game simply does not appear.
That is the one place where "all-or-nothing compilation with terse errors" still
reaches our user, because the reparse the quick test triggers is GMBT's.

Also still true: **no quick test has ever been launched from that button on this
machine.** The argv and both lookup paths are covered against an injected
`spawn`; that is not a witness.

### A4. Parse errors are per-file and have no line (#267)

Better than `U:PAR:` lines in Notepad — the active file's syntax errors render
in `SyntaxErrorsDisplay` and the Problems panel lints the whole project — but two
gaps the report's complaint still touches:

- **Per-file parse errors are not in the Problems panel** (explicitly deferred,
  `docs/architecture/problems-panel.md`, *Deferred*). A project with a broken
  file the user has not opened looks clean.
- **No problem carries a line.** The semantic model keeps positions only on
  top-level declarations, so every problem points at a dialog or a function, not
  a line — there is no jump-to-line for anything the panel finds. Threading
  positions through the linking visitor is the prerequisite.

### A5. Native parser crash still takes the main process (#268)

Spacer's "access violation on Reparse Scripts" has our analogue: a tree-sitter
segfault in the `worker_threads` pool kills the Electron main process.
`utilityProcess` isolation is already written down twice
(`docs/refactoring-targets.md` §4, `feature-suggestions.md` P3 item 10) and not
done. Listed here only so triage sees it beside the rest.

---

## B. World → script references — one direction left (#269, #270)

The report's list (waypoint names, `triggerTarget`, container contents, item
instances, `scemeName`) is **mostly closed**, and the remainder is narrow and
uses machinery that already exists.

Left:

- **Script *function* names are free text.** `oCTriggerScript.function`,
  `VInteractiveObject.conditionFunction` and `.onStateChangeFunction` are
  `kind: 'string'` in the catalogue with no existence check — a typo is a
  silently dead trigger, exactly the report's complaint. The item-instance
  pattern is the template (shape check in `assertApplyOpsRequest`, existence
  check in the renderer against the project index), but it needs a **function
  index in `ProjectIndex`**, which does not exist today — the index carries
  npcs, dialogs, routines and voice ids, not functions.
- **`scemeName` is not catalogued at all** — not editable, not checked, not
  readable in the grid.

Not left, for the record: waypoint names both directions (the
`waypoint-not-in-world` rule plus the waypoint panel's routine/spawn list),
trigger `target`/`vobTarget` (dangling warning by `vobName`), `oCItem.instance`,
mob `item`/`key`, and `oCMobContainer.contents` (index-backed picker).

---

## C. Recovery and stability

### C1. A delete still cannot be undone (#271)

Spacer has no undo at all; we have one everywhere **except** the op the report
names first. `DeleteVob` and `DeleteWaypoint` are barriers that clear both
stacks, so a bad drag no longer costs work and a bad delete still does, with the
user's own save file as the only fallback.

**Decided 2026-09-12 (Daniel): this one is wanted, not a nice-to-have.** An
undoable delete is desirable and is believed possible; the barrier is a stopgap.
What it needs is a serializer for the subtree, an insert-at-index op to put it
back in its old slot, and only then the removal of the barrier — plan §15 for
the withdrawn half of the original decision, §16.42 for the design and the four
questions it leaves open.

### C2. A malformed world crashes the reader, and says nothing about why (#272)

The worker isolation holds (the app survives with *"the world worker died —
reopen the world"*), but the VOB readers are still unbounded (plan §16.11), and
the message carries no reason. The report's "you're reading zSpy to find out
why" therefore half-applies: we do not crash the app, and we do not diagnose
either.

### C3. A world that loads but is missing assets has no report (#273)

`unresolvedByType` is counted on the summary and consumed by the scene layers;
nothing shows the user "these N visuals did not resolve, here they are". For a
custom-asset map — the exact case the report says simply will not load in Spacer
— that list is the diagnosis.

Adjacent and already tracked: #245 (what the browse root looks like on a retail
install), the plan's §16.37 (the asset browser's first outside user could not
work it), #239 (per-source mount cost unmeasured).

---

## D. Unknowns we cannot cost yet

### D1. Union-added object classes (#274)

The report names this as Spacer's own gap, and it is ours too: nobody has
opened a world containing Union classes. ZenKit models the vanilla set, the
property catalogue is a fixed table, and an unknown class has no authoring path.
What actually happens — dropped, read as a base `zCVob`, or a load failure — is
**unmeasured**. This needs a measurement before it can be a work item; a Union
world and one load is the whole first step.

### D2. No in-app help or onboarding (#275)

Spacer's empty help window has our equivalent: nothing. Not a complaint we have
received in those words, but the plan's §16.37 (an outside user could not work the asset
browser unaided) is the same failure in a smaller frame.

---

## Not a gap — already answered, or cannot apply

Kept so triage does not re-open them:

| Report item | Why it is not on the list |
|---|---|
| GD3D11 / `ddraw.dll` conflict, Win10 compat flags, admin rights, DirectDraw | We are an Electron app; none of it exists here |
| BSP / world-mesh compile failures | Out of scope by decision — the Blender pipeline owns it (plan §14.3 row 3.6) |
| Copy-paste silently parenting the copy | Copies are ordinary appends; there is no hidden parenting (plan §14.1 row 1.2) |
| No undo for anything | Undo exists for every op that can describe an inverse; the exception is C1 |
| MDI windows, cryptic toolbars | Single-window app; the surface layout is settled (architecture §17) |
| Vob picking in dense scenes, no layers or filtering | Scene-tree search, per-class visibility filters and user VOB folders all landed |
| ANSI vs Unicode corrupting `.d` files | Encoding is detected per file, preserved on write, and round-trip-checked with lossy characters reported (`encodingUtils.ts`) |
| Parsing hangs the editor | Parsing is in a worker pool with a crash budget; the residue is A5 |
| Decompiler artifacts blocking a parse | Our parser reports its own errors against its own grammar; GothicSourcer output is not an input we own |
| High-framerate camera freeze, `-zmaxframerate` | An engine-hosted-editor problem; our viewport is Three.js |
| Compiling one file at a time | Our parse *is* per file and instant; producing `gothic.dat` is GMBT's job by design, and the gap in it is A3 |

One nuance under the encoding row: a `.d` file that is *already* UTF-8 or UTF-16
is preserved in that encoding rather than flagged, and the engine cannot read it.
Nobody has asked for the warning; it is a one-line judgement if triage wants it.
