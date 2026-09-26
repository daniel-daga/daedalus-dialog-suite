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
least a consistency check between scripts and an existing `OU.csl`"* — and the
cut between the two was taken on 2026-09-17: **check first, generate after.**

**Two things about the cost were wrong when this was written.**

First, "generating the binary is the expensive one" does not hold: ZenKit's
`CutsceneLibrary` (`zenkit/CutsceneLibrary.hh`) models a `zCCSLib` completely and
every one of its objects carries `save` beside `load`, for the binary and the
ASCII flavour both. Generating is building the library from the `AI_Output` ids
and subtitle text we already hold and calling it. What that would cost is a new
`zenkit-node` binding, which is ordinary N-API work, not a format problem.

Second, the *check* needs no native code at all. An OU database is a ZenGin
archive, and all three archive flavours already have pure-JS walkers here
(`lib/container.js`, `-ascii.js`, `-binary.js` — the last since #227). So
`zenkit-node/lib/output-units.js` reads `OU.CSL` and `OU.BIN` in JS:
`readOutputUnits(buf)` returns one `{ name, text, wav }` per `zCCSBlock`, in file
order. ASCII is read through `walkAscii`; BINARY carries no entry names at all,
so it is descended positionally against `CutsceneLibrary::load`'s read order —
note `write_enum` is one byte there and four in the other two formats.

**Its fixtures are hand-authored, and that is the open risk.** No retail OU file
is in this tree, so the reader has never met one. A disagreement with a real
`OU.BIN` is the reader's fault before it is the file's, and confirming that is a
machine with Gothic installed — the same split Gate 2 used: build in CI, witness
afterwards.

One more thing worth knowing about where it lives: `zenkit-node`'s suite runs
only in `zenkit-node.yml`, which is windows-only, path-filtered and **does not
gate a release** (`CLAUDE.md`, CI table). The reader sits beside the walkers it
depends on, which is its right home, but it is covered by weaker CI than editor
code is. Everything downstream of it is not: the rule, the main-process lookup
and the wiring are all in the editor's gated suite.

**What landed (2026-09-17).** `output-unit-stale` and `output-unit-missing` in
`src/renderer/problems/domain/rules/outputUnitDrift.ts`: every literal
`AI_Output` id in the project against the database, ids matched
case-insensitively (Daedalus is, and the writer upper-cases) and subtitles
compared verbatim (the subtitle is what the player reads, so a changed capital
is a real edit the OU has missed). An entry the database holds that no script
claims is ignored — a retail OU carries every vanilla line, and reporting those
would bury the two findings that matter.

The file comes from `src/main/services/outputUnits.ts`:
`<gothic install>/_work/Data/Scripts/content/CUTSCENE/`, `OU.BIN` before
`OU.CSL` because the binary is the one the engine loads, each path segment
matched case-insensitively because a real install's casing varies. Read once per
project open, off the critical section — a project with no install behind it
opens exactly as fast as before, and a database that will not parse leaves
`outputUnits` null rather than taking the whole scan down.

**Null is "nothing is known", never "nothing is legal"**, the same rule the
project index follows: no install, no database, no findings.

**What is NOT built:** generating or updating the OUs. That is the other half of
the cut, and until it lands the panel can tell a user their subtitles are stale
but not fix them — the GMBT quick test still passes `--noupdatesubtitles`
(§A3), so our own button still reproduces the stale subtitle rather than
exposing it.

### A2. A language mismatch has nothing to notice it (#265)

"Reparsing with the MDK's German scripts silently reverts your English text" is
the same class as A1 and needs the same data. We hold no notion of two language
variants of a line; localization export/import is `feature-suggestions.md` P3
item 11, unstarted. Worth triaging *with* A1, not separately.

### A3. A quick test that fails tells the user nothing (#266) — closed

**Closed 2026-09-26**: gmbt's output goes to a log file, and a non-zero exit
or a failed spawn opens *"The quick test failed"* with the log's tail
(`docs/plans/level-editor.md` §16.29, amended). The witness half moved to
§16.41 row 17: nobody has launched it on a real install, or seen whether
`gmbt test` exits non-zero on a failed reparse. What follows is the finding as
filed.


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

### A4. Parse errors are per-file and have no line (#267) — closed

Better than `U:PAR:` lines in Notepad — the active file's syntax errors render
in `SyntaxErrorsDisplay` and the Problems panel lints the whole project — and
the two gaps the report's complaint touched are both closed:

- ~~**Per-file parse errors are not in the Problems panel.**~~ **Closed
  2026-09-13**: the index pass already parsed every file and dropped what it
  found, so the `parse-error` rule now reports it — a broken file nobody opened
  no longer reads as clean. `docs/architecture/problems-panel.md` carries the
  decisions.
- ~~**No problem carries a line**, except that one.~~ **Closed 2026-09-13**:
  the linking visitor stamps a 1-based line on every action and condition, the
  declaration visitor on every dialog and function, and each rule fills
  `ScriptLocus.line` from the finest construct it is actually about. Nothing
  *jumps* to a line — there is still no source view — so the row shows the line
  beside the declaration the click navigates to.
  `docs/architecture/problems-panel.md` carries the decisions.

### A5. Native parser crash still takes the main process (#268) — closed

Spacer's "access violation on Reparse Scripts" had our analogue: a tree-sitter
segfault in the `worker_threads` pool killed the Electron main process. Closed
2026-09-14 — both pools now fork a child process per worker, so the segfault
kills only that child and the pool respawns it. The reasoning is in
`docs/architecture/worker-reliability.md`, "Process isolation".

---

## B. World → script references — one field left (#270)

The report's list (waypoint names, `triggerTarget`, container contents, item
instances, `scemeName`) is **closed but for one field**, and that one turned out
not to use machinery that already exists — see below.

Left:

- ~~**Script *function* names are free text.**~~ **Closed 2026-09-13**:
  `ProjectIndex.functions` is the index that was missing, and the three fields
  take `oCItem.instance`'s split — shape in `assertApplyOpsRequest`, existence
  in the renderer. The renderer's half is a **warning** rather than a refusal,
  because a dead trigger is inert where a bad instance crashes, and because the
  index goes stale the moment a function is written. `docs/architecture/level-editor.md`,
  *"A script function name stops being free text"*, carries the decision.
- **`scemeName` is not catalogued at all** — not editable, not checked, not
  readable in the grid. **And the shape this was carded as is wrong
  (2026-09-13):** it is not "one catalogue entry plus one C++ case", because
  there is no VOB field to catalogue. ZenKit models no `scemeName` on any VOB —
  `VMovableObject` and `VInteractiveObject` between them carry `focusName`,
  `hitpoints`, `damage`, `moveable`, `takeable`, `focusOverride`,
  `soundMaterial`, `visualDestroyed`, `owner`, `ownerGuild`, `isDestroyed`,
  `stateNum`, `triggerTarget`, `useWithItem`, `conditionFunc`, `onStateFunc`
  and `rewind`, and `load`/`save` read and write exactly those. The only
  `scemeName` anywhere in the dependency is `C_ITEM.SCEMENAME` in
  `addon/daedalus.hh` — a **Daedalus script** field on an item instance, which
  is the dialog editor's side of the tree and not a world VOB at all.

  So the question ahead of the work is whether a retail `.zen` carries the entry
  and ZenKit drops it, or whether ZenGin derives the scheme from the visual name
  and never stores one. The corpus round-trips clean under Plan A — whole-world
  re-serialization, with no splice for unread entries — which is evidence for
  the second, because a dropped archive entry is exactly what that gate sees.
  Evidence, not proof: nobody has looked at an `oCMobInter` in a retail world
  and listed its entries.

  That is one command against a retail world and therefore Daniel's machine
  rather than CI, like #245 and #261. If the entry is there, closing this is
  **upstream ZenKit work** — a new field with its `load`/`save`, the shape #225
  has — and not the small in-tree change this was filed as.

Not left, for the record: waypoint names both directions (the
`waypoint-not-in-world` rule plus the waypoint panel's routine/spawn list),
trigger `target`/`vobTarget` (dangling warning by `vobName`), `oCItem.instance`,
mob `item`/`key`, and `oCMobContainer.contents` (index-backed picker).

---

## C. Recovery and stability

### C1. A delete still cannot be undone (#271)

Spacer has no undo at all; we had one everywhere **except** the op the report
names first. `DeleteVob` and `DeleteWaypoint` were barriers that cleared both
stacks, so a bad drag cost no work and a bad delete still did, with the user's
own save file as the only fallback.

**Answered.** 2026-09-12 Daniel decided an undoable delete was wanted rather
than a nice-to-have; `DeleteWaypoint` gained an inverse 2026-09-13 and
`DeleteVob` 2026-09-14, and there is no barrier left in the op set. The
serializer this row expected to need was never written: the binding retains the
deleted subtree's pointer instead of describing it, and the restore puts that
same object back at its old slot. Architecture §7, *"The delete, and the restore
that inverts it"*; plan §15 for the withdrawn half of the original decision.

### C2. A malformed world crashes the reader, and says nothing about why (#272)

**Measured 2026-09-14, and both halves of this row were already out of date.**
The claim was that the VOB readers are still unbounded and that the message
carries no reason. Neither survives a look:

- **Nothing crashes the reader that this repo can reproduce.** `tools/fuzz-world.js`
  at both its documented baselines: 0 of 200 entry-stream seeds failed to throw
  cleanly, and the `--counts` sweep found 0 of 147 INTEGER entries that crashed,
  hung or loaded slowly across all four fixture variants. Fifteen bounding
  patches (`0027`, `0029`–`0043`) did that, and plan §16.11 carries the
  re-measurement with its three caveats — the fixtures are small and BinSafe, a
  sweep reaches only the fields its fixture carries, and no retail BINARY world
  is checked in. So it is the *instrument* that is silent, not the class that is
  provably closed, and the worker isolation stays load-bearing.
- **A clean throw already carries its reason all the way to the user**, and the
  reason is specific: *"hash table entry count exceeds the bytes left in the
  file"*, *"leaf node polygon index range exceeds the polygon list"*, *"reached
  the end of the archive without a mesh end chunk (0xB060)"*. Four hops could
  have flattened it to "something went wrong" — ZenKit's throw, the worker's
  `postMessage`, `world:open`'s wrapper, the renderer's `openFailed` — and a
  real-Electron spec now pins that they do not (`world-editing-ui.spec.ts`, *"a
  malformed world names what was wrong with it"*), because the browser harness
  mocks `openWorld` and can only prove the alert renders what it was handed.

What is genuinely left is narrower than the row, and is one measurement rather
than a feature: **a retail world, in the BINARY container, fuzzed with
`--file`.** That is where §16.11 says the remaining unvalidated counts live, and
it needs an install, so it is Daniel's machine's — #261's kind of row, not CI's.

The one message still without a reason is the crash path itself: *"the world
worker died (zenkit worker exited with code N) — reopen the world"* names
neither the file nor the phase it died in. The main process knows the in-flight
request and the worker could report its phase before dying, so it is
implementable — but it is diagnosis for a failure mode 347 seeded attempts could
not produce, so it is a judgement call rather than obvious work.

### C3. A world that loads but is missing assets has no report (~~#273~~)

**Closed 2026-09-13.** The scene now names what it could not resolve, not only
how many there were: `buildInstancedVisuals` carries `stats.unresolved` — one
entry per distinct visual name, the type it was used as, and how many VOBs
wanted it, most-wanted first — and the World status bar counts them and lists
them on click. Decals and particle effects are held out of both the count and
the list: they name a texture and a Daedalus instance rather than a mesh, so
every retail world counts thousands, and a bar that shouted on those would stop
being read.

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
