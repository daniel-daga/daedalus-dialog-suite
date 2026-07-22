# Feature Suggestions

Prioritized feature backlog, grounded in a survey of the codebase (editor feature
surface, parser capabilities), the docs (`architecture/`, `reference/`,
`release-checklist.md`, `refactoring-targets.md`), and the full GitHub issue
history (#111–#183 — all closed, dominated by authoring-QOL requests from real
Gothic 2 modders).

Priority tiers:

- **P1** — do next: highest user value relative to effort, builds on what exists
- **P2** — proven demand or trust-building; schedule after P1
- **P3** — audience growth and foundation; larger or less urgent

---

## P1 — Close the modding loop

The tool round-trips `.d` files, but a modder still needs external tooling to get
from a written dialog to something testable. Nothing in `src` touches CSL, voice
files, or the game itself — these are the largest confirmed gaps.

### 1. Dialog playthrough simulator

An in-editor "play this conversation" mode: step through a dialog's info
function, render lines by speaker, present choices as clickable options, follow
`Info_AddChoice`/`Info_ClearChoices` into sub-functions, and track a scratch
state of `MIS_*` variables and known infos so conditions evaluate live.

- **Why now:** the semantic model already contains everything needed
  (`DialogLine`, `Choice`, condition types, quest state) — this is pure renderer
  work, no engine integration. Lets writers test branching logic without ever
  starting the game.
- **Extension:** "simulate this quest path" from the quest graph.
- **Effort:** medium (renderer-only; state machine over existing model).

### 2. ✅ Project-wide "Problems" panel (first cut implemented)

`ValidationService` validated the active file at save time; there was no
cross-file lint surface. A fourth left-sidebar view now aggregates project-wide
problems into a navigable list (see `docs/architecture/problems-panel.md`).
Shipped lints:

- ✅ dialog references an NPC instance that doesn't exist
- ✅ `Npc_KnowsInfo` pointing at a deleted dialog
- ✅ choices with no `ClearChoices` path (reachability-aware)
- ✅ orphaned functions no dialog references
- ✅ duplicate/malformed `AI_Output` voice IDs
- undeclared `MIS_`/`TOPIC_` identifiers (the #174 confusion class) — deferred
  (raw condition/action text needs string scanning)
- dialogs whose condition can never be true — deferred (only simple AND/OR
  bodies are structurally analyzable)

**Why now:** turns the editor into the thing that catches mistakes VS Code
can't; compounds the value of every other feature. **Effort:** medium
(incremental — each lint ships independently).

### 3. Voice/subtitle pipeline support

`AI_Output` IDs (`DIA_Alrik_Teach_15_00`) are the contract between scripts, the
cutscene library (`OU.csl`/`OU.bin`), and WAV files — and the editor knows every
line and its subtitle text. Independently shippable pieces, in order:

1. ✅ **Implemented** — project-wide duplicate/malformed voice-ID validation
   (warnings-only step in `ValidationService` fed by a `ProjectIndex.voiceIds`
   index; surfaced via the validation dialog, including after successful saves)
2. voice-actor script export: all lines grouped by NPC/voice number to
   CSV/XLSX, with a "WAV exists" column when pointed at the sound folder
3. OU generation, or at least a consistency check between scripts and an
   existing `OU.csl`

**Effort:** small (1) → medium (2) → large (3).

---

## P2 — Proven demand and trust

### 4. ✅ Extend the teacher scaffolder (implemented)

#147 explicitly asked for "Kampfskills, Jagd, Alchemie", but `TEACHER_SKILLS`
(`utils/teacherDialogTemplate.ts`) shipped with only 1H/2H/Bow/Crossbow; the
docs note other categories use different teach builtins. Natural next entries:

- attribute trainers (`B_TeachAttributePoints` — STR/DEX/mana)
- hunting (`B_TeachPlayerTalentTakeAnimalTrophy`)
- alchemy, thief talents (sneak, lockpicking, pickpocket)

**Effort:** small–medium per category (template machinery exists).

### 5. ✅ Merchant/trader scaffolder (implemented)

Same pattern as the teacher: a "Create Trader Dialog" that emits the standard
`B_GiveTradeInv` setup and trade dialog instance. The other NPC archetype every
mod needs; reuses the `teacherDialogTemplate.ts` pattern. **Effort:** small.

### 6. ✅ On-disk diff before save / after external change (implemented)

#150 ("tool scrambles my file") was a trust breaker; #121 asked for VS Code
coexistence. The only diff surface today is `QuestDiffPreviewDialog`. A general
before/after diff (Monaco's built-in diff editor is already bundled) shown in
the external-change conflict dialog and available as "review changes" pre-save
makes the round-trip pipeline's fidelity *visible* instead of asserted.
**Effort:** small–medium.

### 7. Dialog flow graph view

litegraph.js and dagre auto-layout are already vendored for quests. Reuse the
canvas to render a *conversation*: info function as root, choices as branch
nodes, `KnowsInfo` links between dialogs. Gives writers the whole-conversation
overview that #111 (accordion choices) was groping toward, at a scale the
accordion can't reach. **Effort:** medium.

---

## P3 — Audience growth and foundation

### 8. Ship the parser as an editor-agnostic language tool

The tree-sitter grammar + semantic model is valuable outside the app: a
published VS Code extension (syntax highlighting from the grammar is nearly
free; diagnostics/go-to-definition via a thin LSP over the semantic model)
serves the modders who live in VS Code and funnels them toward the suite. The
feature that grows the project's audience rather than deepening it.
**Effort:** medium (highlighting) → large (LSP).

### 9. Structurally model local `var` declarations

Currently preserved only as verbatim raw `Action` entries
(`docs/reference/parser-roundtrip-scope.md`). This is the main blocker for
richer structural editing of condition/info functions and keeps biting features
like the if/else editor (#145). **Effort:** medium (parser + editor).

### 10. Native parser process isolation

Already documented in `docs/refactoring-targets.md` §4: a tree-sitter segfault
in a `worker_threads` pool kills the whole Electron main process. Move the
native parser into a `utilityProcess` so a crash kills only the child. Worth
doing before a public release rather than after the first crash report.
**Effort:** large (new process boundary + IPC).

### 11. Localization export/import

Subtitle text lives in `AI_Output` trailing comments; mods get translated. An
export/import round trip (CSV/XLSX of all line texts keyed by voice ID) enables
translation workflows without touching scripts by hand. Pairs with item 3's
export. **Effort:** small–medium.

---

## Housekeeping

Both items done: the `parser-roundtrip-scope.md` `class`/`prototype` row now
matches `parser-fidelity.md`, and the Row-Tab navigation helper is wired into
every flat multi-field action renderer (see
`docs/reference/dialog-authoring-automations.md`).
