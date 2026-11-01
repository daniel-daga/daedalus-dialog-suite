# Parser review — slice 2 of 7: code generation and formatting

Review of `daedalus-parser` emission at commit `4e72f48`, 2026-10-31 (review date
2026-10-31). Scope: `src/codegen/generator.ts`, `src/semantic/action-codegen.ts`,
`src/semantic/code-formatting.ts`, `src/semantic/declaration-source.ts`, and the
per-declaration emitter methods the model classes own in
`src/semantic/semantic-model.ts` (they own their leading comments and their own
`generateCode`).

**What this change does:** This slice turns a parsed semantic model back into
Daedalus source. `generateByDeclarationOrder` replays `declarationOrder` and
asks each declaration for its own text: globals and C_INFO bodies from verbatim
`sourceText`, functions from their header, actions and conditions, with comments
patched in from captured source ranges. It runs on every editor save
(`SaveFileFlow.ts:71`/`:102` writes the output unconditionally, with
`preserveSourceStyle: true`) and in batch over a whole mod's script base
(890 files for the Beppo corpus).

**Where #397 comes from:** in this slice, not in a caller. Three emitters rewrite
layout they had the data to keep: the action loop drops the `line` number every
action already carries (finding 2), declarations are always placed on their own
new line (finding 3), and every structural join uses `'\n'` so a CRLF file is
rewritten entirely (finding 1). The save path and the corpus script only pass
the result through; nothing downstream compensates — and one thing upstream,
the corpus, hides part of it (finding 5).

**Load assumed:** one full-model regeneration per save, and a batch pass over
hundreds to thousands of files. Generation itself is not the problem here:
0.22 ms for a 452-line real file, 32 declarations (measured, `generateSemanticModel`
only); parse dominates (13.8 ms with a fresh parser, so ~12 s for 890 files).
No quadratic concatenation, no repeated whole-model scan per declaration, no
per-declaration re-tokenizing of the file.

## Must fix

1. **Every CRLF file is rewritten with LF line endings** (`daedalus-parser/src/codegen/generator.ts:142`, also `:159`, `:276`, `:479`, `:615`)
   - **What this is:** All structural text the generator invents is joined with
     `'\n'`; only verbatim `sourceText` keeps its own bytes.
   - **Problem:** A CRLF source comes back with LF for every header, brace,
     action, blank line and terminator, while a preserved instance body keeps
     CRLF — so the file is not just converted, it ends up mixed. Measured on a
     4-line CRLF dialog: 42 bytes in, 38 out, every `\r` gone. Nothing in the
     editor records or restores the file's line ending (`FileService`'s encoding
     handling covers bytes, not EOL), so this fires on the first save of any
     CRLF file with no edit at all.
   - **Fix:** Read the line ending once from the parse (the first `\r\n` in the
     source, or a model field set by the visitor) and use it at the six join
     points instead of the literal `'\n'`.
   - **If we skip it:** Every Windows-authored script in the corpus shows a
     whole-file diff on its first save, which is exactly the noise #397 is about.

2. **The action emitter throws away the source line numbers it already has**
   (`daedalus-parser/src/codegen/generator.ts:589-594`)
   - **What this is:** `func.actions` is emitted as one entry per line, in order,
     with no reference to where the entry was in the source.
   - **Problem:** Three different layout losses, all from the same loop, and the
     model already records what is needed: every action and comment carries
     `line`, and it survives IPC hydration (verified: `A(); // note` → Action
     line 3, CommentAction line 3). So: (a) a blank line inside a body is lost —
     `DIA_Arog_SLD_99005.d` has 12 of them and drops to 450 lines from 468;
     (b) two statements on one line are split — `examples/DIA_Arog_SLD_99005.d:45`
     `var c_npc Arog;    Arog = Hlp_GetNpc(...);` becomes two lines;
     (c) a trailing `//` moves to its own line — `test/fixtures/corpus/comments.d:6`
     `Npc_SetRefuseTalk (self, 300); // trailing note` and
     `examples/DIA_Arog_SLD_99005.d:48`. Only `AI_Output` subtitle comments stay
     inline, because that one case is modelled.
   - **Fix:** In the loop, compare each entry's `line` with the previous entry's
     last emitted line (start line plus newlines in what was emitted for it):
     a gap of one or more emits that many empty lines, a gap of zero appends to
     the previous line. About 10 lines, all inside `generateFunction`.
   - **If we skip it:** This is the largest single contributor to the 765 of 890
     files that change on save. Grouped statements and section blank lines are
     how mod authors write.

3. **Two declarations sharing a source line are split onto two lines** (`daedalus-parser/src/codegen/generator.ts:157-161`)
   - **What this is:** `emitOrdered` always ends a declaration with `'\n'` and can
     only add blank lines before the next one, never zero.
   - **Problem:** This is #397's own sample. `const int HP = 25; const int HP_E = 50;`
     in `IT_Potions.d` comes back as two lines. The order record cannot express
     it either: `blankLinesBefore` (`declaration-visitor.ts:79`) is a row gap
     clamped at 0, so "same line" and "next line with no gap" are the same value.
     The position data that would settle it is already there —
     `GlobalConstant.position.startColumn/endColumn` gives 1..17 and 18..34 for
     those two constants, and it survives IPC hydration (verified).
   - **Fix:** Before adding the newline, compare the current declaration's
     `position.startLine` with the previous one's `position.endLine`; when they
     are equal, join instead of breaking.
   - **If we skip it:** The one case #397 names stays broken even after findings
     1 and 2 are fixed, so the issue cannot be closed.

## Should fix

4. **Blank lines inside a `C_INFO` property list are dropped** (`daedalus-parser/src/codegen/generator.ts:452-467`)
   - **What this is:** Properties are emitted one per line from
     `dialog.properties`; nothing records the spacing between them.
   - **Problem:** `instance DIA_X (C_INFO) { npc = self; <blank> nr = 1; };` comes
     back with the blank line removed. Unlike actions, properties have no `line`
     field, so this cannot be rebuilt at emit time from what is stored.
   - **Fix:** Record the gap the way #286 did for declarations — a small
     `propertyBlankLinesBefore` map filled by the linking visitor, read by this
     loop.
   - **If we skip it:** Dialog instance blocks reflow on every save; it is the
     same defect as finding 2 in a place the current model cannot see.

5. **The corpus normalizes line endings before it compares bytes, so findings 1–4 cannot fail CI** (`daedalus-parser/scripts/roundtrip-corpus.js:311`)
   - **What this is:** Tier-2 byte fidelity is computed on
     `normalizeLineEndings(source) !== normalizeLineEndings(generatedText)`, is
     reported but never failing, and the smoke test's `BYTE_EXACT_FIXTURES`
     (`test/roundtrip-corpus-smoke.test.js:58-68`) pins only 9 of 12 fixtures.
   - **Problem:** The normalization hides CRLF loss completely (finding 1).
     `comments.d` and `quoting.d` are byte-different today — the inline comment
     moves, the log calls gain blank lines — and both tests are green, so no test
     fails for findings 1–4 or 6–9. Constructs that *are* covered: declaration
     order and blank lines between declarations (`blank-lines.d`), globals and
     instances (`items-npcs-mds.d`), class/prototype
     (`class-prototype-roundtrip.test.js`), dialog expressions
     (`dialog-property-expression-options.test.js`), header comments
     (`review-source-boundaries.test.js:172`), the EOF-comment newline
     (`comment-preservation.test.js:184`).
   - **Fix:** Add a CRLF fixture to the corpus and compare bytes before
     normalization, or promote `comments.d` to `BYTE_EXACT_FIXTURES` once
     finding 2 lands. One fixture per finding is enough.
   - **If we skip it:** The 765-file regression is measured on every run and can
     never turn red, so the next one is invisible too.

6. **A property written with no spaces around `=` gains a tab and a space** (`daedalus-parser/src/semantic/visitors/linking-visitor.ts:527-528`, read at `generator.ts:483`)
   - **What this is:** The captured spacing goes through `match[1] || '\t'` and
     `match[2] || ' '`, so an empty capture falls back to the Gothic default.
   - **Problem:** Zero width is a legitimate capture. `nr=1;` is stored as
     `{ beforeEquals: '\t', afterEquals: ' ' }` (checked on the model) and is
     emitted as `nr<TAB>= 1;` — the source spelling is lost at capture, before
     the emitter ever sees it, even though `preserveSourceStyle` is on. The
     fidelity doc forbids exactly this falsy-coercion default for numeric
     literals; spacing has the same shape.
   - **Fix:** Delete both `||` fallbacks. `match[1]`/`match[2]` are always
     strings when the regex matched, and the default only belongs in the branch
     where no match exists.
   - **If we skip it:** Compact property lists (common in older scripts) reflow
     on save and the model claims it preserved the style.

7. **Every call gains a space before `(`** (`daedalus-parser/src/semantic/call-identity.ts:24`)
   - **What this is:** `generateCallStatement` calls
     `generateCallExpression(..., spaceBeforeParen = true)` for every action and
     condition call, and the source's own spacing is not consulted.
   - **Problem:** `AI_Output(self, other, "...")` in the editor's own fixture
     `daedalus-dialog-editor/tests/fixtures/sample-dialog.d:20-22` is emitted as
     `AI_Output (self, other, ...)`, and a tab before `(` becomes a space
     (`examples/DIA_DEV_2130_Szmyk.d:22`). No edit, three call sites changed.
   - **Fix:** Capture "was there whitespace before `(`" on the parsed call next
     to the existing `callIdentity` source name, and pass that instead of the
     hardcoded `true`.
   - **If we skip it:** Files written in the no-space style diff on every call
     line, which for a dialogue file is most lines.

8. **Statement indentation is regenerated from the editor setting, so the source's depth and indent character are lost** (`daedalus-parser/src/semantic/code-formatting.ts:30`, called from `generator.ts:592`)
   - **What this is:** Each emitted line is stripped of the source indent
     (`sourceIndent`) and prefixed with the configured unit, one level for a
     body.
   - **Problem:** The unit is intentional (the editor sends `indentChar: tab` by
     default, `fileStore.ts:366`), but the *depth* is not: `examples/DIA_Arog_SLD_99005.d`
     is space-indented, so 74 lines change, and
     `reference/SLD_99003_Farim.d:50-51` indents its body two tabs deep and comes
     back one deep.
   - **Fix:** Reuse the `sourceIndent` already captured: when it is present, emit
     it instead of building one unit, and let the setting apply only to new code.
   - **If we skip it:** Every space-indented corpus file is a whole-file diff, and
     the authors' alignment is silently thrown away.

9. **A declaration header keeps its spacing only when it contains a comment** (`daedalus-parser/src/semantic/declaration-source.ts:59-62`)
   - **What this is:** `captureDeclarationHeader` returns `undefined` unless a
     comment sits before the body, so a comment-free header is emitted from the
     canonical string.
   - **Problem:** `func  void   foo ()`, `func void foo (var int arr[ 10 ])` and
     `instance DIA_X ( C_INFO )` all normalize (`arr[ 10 ]` → `arr[10]`), while
     the same header with `/* c */` in it round-trips byte for byte. Two
     behaviours for one construct, chosen by trivia.
   - **Fix:** Capture the header unconditionally (drop the `comments.length > 0`
     test) and keep the existing patch-in-place logic; the `fields` list already
     covers what an edit can change.
   - **If we skip it:** Hand-aligned headers reflow; the rare case is fine to
     defer, but then say so where the comment rule is documented.

## Nice to have

10. **Dead `preservedBody` parameter** (`daedalus-parser/src/codegen/generator.ts:549`, branch at `:576-581`, guard at `:568`)
    - **What this is:** `generateFunction(func, preservedBody)` has a second
      argument, a trim/split/indent branch for it, and no caller: every call
      site (five in `generator.ts`) and every test pass one argument.
    - **Problem:** It is unreachable code that looks like a supported path and
      would need reviewing on every emitter change.
    - **Fix:** Delete the parameter and the branch.
    - **If we skip it:** Someone will pass a body and be surprised that leading
      comments and `conditionSource` are skipped for it anyway (`:568`).

11. **A missing final newline is invented** (`daedalus-parser/src/codegen/generator.ts:159`)
    - **What this is:** `emitOrdered` appends `'\n'` when the text does not end
      with one, so the file always gains a trailing newline.
    - **Problem:** `reference/LOG_Constants_Beppo.d` has no final newline and
      grows from 37 to 38 lines with no edit. The reverse case is already
      handled on purpose (`renderTrailingComments`, `:735-741`), so the two
      rules disagree about the end of the file.
    - **Fix:** Record whether the source ended with a newline on the model and
      use it for the last section.
    - **If we skip it:** A one-character diff at the bottom of every file that
      lacks the newline.

12. **Trailing spaces are dropped from statement and declaration lines** (`daedalus-parser/src/semantic/semantic-model.ts:425`)
    - **What this is:** Raw actions are `trimEnd()`ed, and a global's
      `sourceText` stops at the statement's last token.
    - **Problem:** `reference/IT_Beppo_Misc.d:3` `const int\<TAB>Value_Rohdiamant\<TAB>\<TAB> = 900; ` comes
      back without the trailing space; a statement line's trailing spaces are
      lost the same way. Comments are the only trivia with an explicit
      "keep trailing whitespace" rule (`CommentAction.generateCode`, `:451-454`).
    - **Fix:** Nothing to build — this only matters if byte fidelity becomes a
      gate; drop it from scope if it does not.
    - **If we skip it:** Whitespace-only diff lines, usually stripped by editors
      anyway.

13. **Two copies of the fallback ordering** (`daedalus-parser/src/codegen/generator.ts:83-143` and `:206-269`)
    - **What this is:** The no-order path and the leftover path in the ordered
      path each loop over dialogs, functions, constants, variables and instances
      and emit them, with slightly different header handling.
    - **Problem:** Any fidelity change (findings 2, 3, 11) has to be made twice,
      and only the ordered path is exercised by parsed models, so the other one
      drifts unobserved.
    - **Fix:** Have the ordered path fall back to the existing no-order emitter
      for the leftovers instead of copying it.
    - **If we skip it:** A fix lands in one copy; hand-built models keep the old
      behaviour and nobody notices.

## Verdict

Verdict: fix 1, 2 and 3 first. They are the cause of #397, and 2 alone accounts
for most of the 765 files.

Lean: -9 lines possible (finding 10).

Not checked: the Beppo corpus is not on this machine, so I could not confirm that
CRLF (finding 1) is present in it or that findings 1–3 account for the exact
765 of 890; the real-file evidence comes from `daedalus-parser/reference/`,
`daedalus-parser/examples/` and the 12 fixture files, all LF-encoded except where
noted. No Gothic engine run and no Electron UI run.
