# Parser review — NPC patch-in-place

Slice 6 of 7: `daedalus-parser/src/semantic/npc-definition.ts` (`extractNpcDefinition`,
`applyNpcEdits` and their helpers), reviewed at commit `79aa39c` on 2026-11-01.

## What this change does:

`extractNpcDefinition` re-parses one instance declaration and returns its body statements
(a field assignment, a call, or an opaque "other") with their source ranges; `applyNpcEdits`
turns a list of `set`/`remove`/`setCall`/`removeCall`/`addCall` edits into text splices over
those original ranges and returns the new instance source, which the editor stores as the
instance's `sourceText` and saves through the ordinary generator. It is the parser's only
writer that patches existing text instead of regenerating from the model, so it carries the
whole "the user's file is the document" promise.

Both closed findings still hold. #332 (insertion after an anchor whose line also holds `};`)
is fixed by the `lineEnd >= closingBraceIndex` branch and pinned by
`test/npc-definition.test.js:166`; #343 (overlapping edits) is fixed by the duplicate-target
and overlap checks and pinned by `test/npc-edit-conflicts.test.js`; `level += 1;` stays an
`other` statement (`npc-definition.test.js:181`). I could not break the body boundary: the
closing brace comes from the parse tree, never from a text scan, so a `}` inside a string, a
`//` comment or a `/* */` comment is never mistaken for it (probed). Line endings survive an
edit byte for byte, including CRLF inserts and CRLF whole-line removals (probed). A syntax
error produced by an edit is caught before the write by
`daedalus-dialog-editor/src/main/services/ValidationService.ts:141,190`, so a *broken* edit
does not reach disk; a syntactically valid but wrong edit does.

## Must fix

1. **A save that deletes the line it inserts beside is refused, and the NPC editor always sends one batch**
   (`daedalus-parser/src/semantic/npc-definition.ts:208-222,245-251`, caller
   `daedalus-dialog-editor/src/renderer/components/NpcEditorDialog.tsx:373-379`)
   - **What this is:** A new field is inserted after the *last* field, and a new call after the
     *last* statement (or the last call of its name). The overlap check then rejects any batch
     whose insertion point sits on a line another edit removes.
   - **Problem:** The NPC dialog builds one edit list from the form diff and applies it in one
     call, so the two changes a user makes in one visit collide. Clearing the daily routine and
     filling any empty control in the same save throws
     `Conflicting NPC edits 0 and 1: duplicate target or overlapping source ranges; apply
     sequential changes in separate calls`. Verified against `dist/` for
     `{name, guild, id, daily_routine}` with `[remove daily_routine, set flags]`, for
     `[addCall EquipItem, remove daily_routine]`, and for `CreateNpcDialog`'s copy edits
     (`daedalus-dialog-editor/src/renderer/npc/npcTemplate.ts:32-40`) when the template lacks
     `guild`. The advice to "apply sequential changes in separate calls" cannot be followed from
     the dialog, which has one Save button; the user must guess to save twice.
   - **Fix:** Choose the insertion anchor from the statements this batch does *not* remove: the
     last surviving field, else the last surviving statement, else the closing brace. About four
     lines in `applyNpcEdits`, the overlap check unchanged. `applyNpcEdits` already knows both
     sets, so nothing new is needed.
   - **If we skip it:** A normal edit fails with an error naming edit indices, and the user has
     no way to see what to split.

## Should fix

2. **Editing a call silently deletes any comment inside its parentheses**
   (`daedalus-parser/src/semantic/npc-definition.ts:147-155,227-233`)
   - **What this is:** `args` is built from the argument nodes with comments filtered out, and
     `setCall` replaces the whole span from `(` to `)`.
   - **Problem:** `EquipItem (self, /* the mace */ ItMw_1h);` becomes
     `EquipItem (self, ItRw_Bow);` — the note is gone, and the editor never showed it, because
     the same filter hid it from the form. `B_GiveNpcTalents (/* all */);` behaves the same. A
     multi-line call is also collapsed to one line, by design.
   - **Fix:** Cheapest honest option is one `shortcut:` comment naming the limit plus a test that
     pins it, since per-argument splicing is a bigger change than the value lost. Do that unless
     comments inside calls turn out to be common in the corpus.
   - **If we skip it:** Every call edit is a small silent loss in the user's file, which is the
     one thing this writer exists to prevent.

3. **No test covers an edit on a body with no statements**
   (`daedalus-parser/src/semantic/npc-definition.ts:296-303`)
   - **What this is:** The branch that inserts before `}` when the body holds no statements at
     all, with a tab when the brace is alone on its line and inline ` text ` when it is not.
   - **Problem:** Both shapes work (`instance A (C_Npc) {};` and the three-line empty body with
     LF or CRLF, probed), but no test in `test/npc-definition.test.js`,
     `test/npc-edit-conflicts.test.js` or `test/review-source-boundaries.test.js` reaches them.
     A stubbed NPC written by hand is exactly the case that hits this.
   - **Fix:** One test, two sources, one `set` each, asserting the output parses and the value
     landed.
   - **If we skip it:** The first branch a hand-written stub NPC takes is the only untested one.

## Nice to have

4. **Unreachable removal branch** (`daedalus-parser/src/semantic/npc-definition.ts:318-319`)
   - **What this is:** The `newline === -1` case of a statement alone on the last line.
   - **Problem:** An instance always closes with `}` after its last statement, so the suffix
     check (`:316`) can never match when there is no following newline: the branch is dead. If it
     ever were reached, `Math.max(lineStart - 1, 0)` would also eat the previous newline.
   - **Fix:** Delete the two lines and let the `newline + 1` form stand.
   - **If we skip it:** Two lines of code nobody can exercise, in a file where readers are asked
     to trust the range arithmetic.

5. **An inserted line inherits column 0 when the anchor shares the `{` line**
   (`daedalus-parser/src/semantic/npc-definition.ts:274-275`)
   - **What this is:** Indentation is copied from the anchor's own line.
   - **Problem:** `instance A (C_Npc) { level = 1;` with a later statement, plus `set voice`,
     produces `voice = 7;` at column 0 among tab-indented neighbours (probed). Valid, ugly.
   - **Fix:** When the anchor's line prefix also holds `{`, take the indentation of the nearest
     following statement instead of the line's.
   - **If we skip it:** One odd-looking line in a rarely compact instance; no correctness cost.

Verdict: fix 1 first.

Lean: -2 lines possible.

Not checked: whether the renderer can reload a file's model behind an open NPC dialog — if it
can, `NpcEditorDialog` applies edits computed from the `definition` it parsed at open to a
`sourceText` read at save time (`NpcEditorDialog.tsx:373-379`), and a shifted `occurrence`
would silently address another `EquipItem`. I did not trace the watcher path to decide whether
that is reachable, so it is not a finding. Separately, my whole-file probe showed a CRLF file
losing `\r` on `};` and blank lines when saved through `SemanticCodeGenerator` — the writer is
clean (verified in isolation), so that belongs to the code-generation slice, not this one.
