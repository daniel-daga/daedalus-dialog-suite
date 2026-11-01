# Parser review — 2026-11-01, slice 5: declaration and linking passes

Slice: `src/semantic/visitors/declaration-visitor.ts`, `visitors/linking-visitor.ts`,
`visitors/error-visitor.ts`, `src/semantic/cross-references.ts`,
`src/semantic/name-utils.ts`, and the two-pass orchestration in
`src/semantic/semantic-visitor.ts`, plus the two consumers that decide what a
reference resolves to after the parse: the project merge in
`daedalus-dialog-editor/src/renderer/store/projectStore.ts` and the per-file index
in `src/main/utils/semanticMetadataUtils.ts`.

Commit reviewed: `79aa39c`. Date: 2026-11-01.

**Load assumed.** Two passes per file, every time a file is opened, on project
load (890-file Beppo corpus) and on every save re-parse, inside a forked worker;
then one merge over all files in the main process, plus repeated lookups from the
renderer while the user types. Judged against that: nothing here is per-keystroke,
so a full-dictionary scan per miss (finding 9) is a suggestion, not a problem; the
things that break under this load are the silent overwrites, which scale with the
number of files and declarations a modder pastes in.

**What this change does:** pass 1 walks the file's top-level declarations and
creates one skeleton object per name (dialog, function, instance, constant,
variable, class, prototype), pushing an entry into `declarationOrder` so the
generator can replay the file in source order. Pass 2 walks the file again, links
each dialog property and each instance property to the function it names, and
turns function bodies into typed actions and conditions, with anything the flat
model cannot spell kept verbatim as raw text. A third, separate visit records
syntax errors; `name-utils.ts` supplies the case-insensitive lookup every later
consumer uses, and `cross-references.ts` answers "who references this" for
delete/rename and for the generator's dialog clustering.

Checks run against the built `dist/` and the real native grammar: the six focused
test files named below (79 tests, all pass), plus throwaway probes for duplicate
declarations, case-only duplicates, cross-file condition functions, raw-mode
condition edits, cycle reachability and the error-reporting gap. No repo file was
edited except this report.

## The five linking rules and the test that would fail if they broke

| Rule | Test |
|---|---|
| dialog → function (`information`, `condition`) | `test/linking-visitor.test.js:9`, `:166`, `test/dialog-property-expression-options.test.js:57` |
| function → function (choice target) | `test/linking-visitor.test.js:58`, `test/cross-references.test.js:112`, `:192`, `:224` |
| action → symbol (`Info_AddChoice` third argument, raw or structured) | `test/cross-references.test.js:112`, `:192`, `test/case-sensitivity.test.js:143` |
| condition → symbol (`Npc_KnowsInfo(other, DIA_X)`) | `test/cross-references.test.js:44`, `:74`, `:249`, `test/case-sensitivity.test.js:97` |
| instance → parent (`C_NPC`/`C_ITEM`/`C_MDS` maps) | `test/semantic-global-symbols.test.js:74` |
| reachability over choices, including cycles | `test/cross-references.test.js:138`, `:154`, `:168`, `:208`, `:280` |

Every rule has a test that would fail. What is *not* tested is the duplicate and
cross-file behaviour below, and each of those findings says so.

## Must fix

1. **A duplicate declaration is only detected for functions** (`daedalus-parser/src/semantic/visitors/declaration-visitor.ts:118-127`; the unchecked stores are :151 dialogs, :171 instances, :218 classes, :239 prototypes, :493 constants, :501 variables)
   - **What this is:** Pass 1 writes every declaration into a dictionary keyed by its source name. A second declaration with the same name simply overwrites the slot; only functions call `recordDuplicateFunction` and refuse to save.
   - **Problem:** Two `instance DIA_DUP(C_INFO)` blocks are merged into one dialog, with no error: the second body's `nr = 2` wins, the first body's `important = 1` and its leading comment survive, `hasErrors` is `false`, and the save writes one dialog the user never wrote. `const int A = 1;` followed by `const int A = 2;` keeps only the second; the first line is deleted from the file on save, silently. Case-only pairs are worse: `const int A` and `const int a` are both kept as separate symbols and both emitted (the generator's dedupe key is exact-case, `codegen/generator.ts:170-190`), while every case-insensitive lookup calls them the same symbol, and `instance X(C_NPC)` plus `instance X(C_ITEM)` leaves `npcs.X` pointing at an orphan object that generation drops (`indexInstanceByParent`, `declaration-visitor.ts:290-312`). Nothing pins any of this: `test/semantic-error-handling.test.js:258-296` covers functions only.
   - **Fix:** Hoist the check functions already have into a per-kind, case-insensitive name record (`Object.create(null)` keyed on the lowercased name, the pattern `functionNameMap` already uses at :127) and flag the second declaration of every type. The refusal path already exists and already works: `generateSemanticModel` throws on `hasErrors`, so the save fails visibly instead of rewriting the file.
   - **If we skip it:** A modder who pastes a block twice, or keeps both a `C_NPC` and a `C_ITEM` instance of one name while converting, loses one of them on the next save with no error at all. Note that a flagged duplicate also drops that file's routine/spawn/exchange sites from the project index (`src/main/utils/semanticMetadataUtils.ts:468`), the same treatment as any parse error — acceptable, but it is a second reason not to leave duplicates unflagged.

2. **The discarded duplicate function's body is analysed into the function that was kept** (`daedalus-parser/src/semantic/visitors/linking-visitor.ts:169`, with `declaration-visitor.ts:118-124`)
   - **What this is:** When pass 1 rejects a second `func X`, the first stays in `functions`. Pass 2 finds its function by name, so the rejected declaration's body is walked with the *kept* function as the current one.
   - **Problem:** Two `func void Foo()` with different bodies give one kept `Foo` holding both: `actions.length === 2`, `calls === ["AI_Output","AI_Output"]`, `callSites.length === 2`, and `hasExplicitBodyContent` taken from the second. If a dialog in the same file says `condition = Foo`, `conditionFunctions` contains `Foo`, so the second body is analysed in condition mode too and both guards land on one function. The dialog editor, the simulator and the project index then show lines the file does not contain. No test covers this: the duplicate tests use empty bodies.
   - **Fix:** In `enterDeclarationContext` (:166-177), ignore a declaration that is not the object pass 1 stored: `const stored = this.functions[nameNode.text]; if (stored && stored.range?.startIndex !== node.startIndex) return;` leaving `currentFunction` null — the statement handlers already do nothing without one.
   - **If we skip it:** The model of a duplicated function is wrong in a way only a human reading the source would notice, and the project index counts its calls twice.

3. **A file can report parse errors while listing none** (`daedalus-parser/src/semantic/visitors/error-visitor.ts:48`, same rule at `src/core/parser.js:278`)
   - **What this is:** The error visit records a `missing_token` only when `node.isMissing`, and records a `syntax_error` only for a node whose type is literally `ERROR`.
   - **Problem:** `func Foo() {};` (a missing return type) and `var int;` produce `hasErrors: true` with `errors: []`. `rootNode.toString()` shows why: the missing token is a child of a zero-width node — `(identifier (MISSING "identifier_token1"))` — and that identifier reports `childCount: 0`, so the recursive walk never reaches the MISSING node. The editor enters its parse-error state and auto-save is gated off, the Problems/error list renders empty, and the save error says "0 parse error(s)" (`projectStore.ts:476`, `codegen/generator.ts:79-84`). Nothing pins this; `test/semantic-error-handling.test.js` only uses inputs whose missing token is a visible `}`.
   - **Fix:** At the end of `checkForSyntaxErrors`, if `hasErrors` and `errors` is empty, push one entry for the first zero-width node carrying `hasError` (or, failing that, one generic entry at the root). Two lines, and it survives any further binding quirk.
   - **If we skip it:** A one-character typo leaves a file that cannot be saved and nothing tells the user why, on every parse of that file.

4. **Adding a condition to a raw-mode condition function deletes the preserved body** (`daedalus-parser/src/semantic/visitors/linking-visitor.ts:352-405`; `daedalus-dialog-editor/src/renderer/components/ConditionEditor.tsx:296-308`; `daedalus-parser/src/codegen/generator.ts:584`)
   - **What this is:** A condition body the flat model cannot spell — mixed `&&`/`||`, a nested guard, a comment inside the guard header — is kept verbatim as one raw `Action` with `conditions: []`. The dialog's Conditions panel shows that text and offers "Add Condition" underneath it.
   - **Problem:** Clicking it writes `conditions: [new]` onto the same function while the raw action stays, and `generateFunction` prefers `conditions` over `actions` and never emits both. `if (Npc_IsDead(self) && A || B) { return TRUE; };` became `if (Npc_IsDead(self)) { return TRUE; };` — the `&& A || B` is gone, `hasErrors` is false, the save succeeds. `test/condition-raw-fallback.test.js` proves raw bodies are *preserved*, not that an edit keeps them.
   - **Fix:** Don't offer Add Condition while raw statements are present: the raw branch at `ConditionEditor.tsx:296-308` already renders them, so the button there is the two-line change. (Emitting `actions` after the generated guard would also work, but it changes the semantics of every raw body.)
   - **If we skip it:** One click on a common guard shape silently deletes half its logic, and the parsed model is the same before and after, so nothing warns.

## Should fix

5. **A condition function named by a dialog in another file is never recognised as one** (`daedalus-parser/src/semantic/visitors/linking-visitor.ts:107-130`, used at `:651`)
   - **What this is:** `collectConditionFunctionNames` reads the `condition` property of the C_INFO instances **in the file being parsed** and nothing else.
   - **Problem:** With `func int DIA_X_Condition() { if (Npc_KnowsInfo(other, DIA_X)) { return TRUE; }; };` in file A and `instance DIA_X(C_INFO) { condition = DIA_X_Condition; };` in file B, A's function has `conditions: 0` and one raw action; the same two declarations in one file give `1` structured condition. The merge copies A's parse per file, so the merged model is identical — it never re-derives the rule. Generation is unaffected (the reference is a plain name and resolves against whatever model it is given; merged output is byte-identical), so the loss is the structured condition view, and via finding 4 it makes the raw text one click from deletion.
   - **Fix:** Nothing cheap inside a per-file worker. Either re-derive condition functions in the editor once the merged model exists, or accept raw mode as final and gate the editor on raw actions (finding 4's fix). What is missing today is a test for the two-file case and a line in `docs/architecture/parser-fidelity.md` saying the rule is file-local.
   - **If we skip it:** A reader assumes "a condition function" is a project-wide concept and every dialog's condition editor works, which is not true across files.

6. **`findDialogReferences` cannot see a dialog reference inside a preserved body** (`daedalus-parser/src/semantic/cross-references.ts:104-112`, versus the raw sweep at `:59-63` and `:68-93`)
   - **What this is:** `findFunctionReferences` walks raw `Action` text and re-parses it to find `Info_AddChoice` targets. The dialog half reads only the structured `conditions` array.
   - **Problem:** `findDialogReferences(model, 'DIA_X')` returns `[]` for `if (Npc_KnowsInfo(other, DIA_X) && A || B) { return TRUE; };`, while the same function's choice targets are found. So the two halves of the same exported API disagree about where references hide.
   - **Fix:** Share the raw-statement sweep: one helper yielding a function's raw statement texts, used by both halves of `cross-references.ts`.
   - **If we skip it:** Any caller asking "is this dialog still referenced" is told no for every raw-mode condition function. There is no caller in this repo today, which is why this is Should fix and not Must fix.

7. **A name declared in two files resolves to two different objects in the merged model** (`daedalus-dialog-editor/src/renderer/store/projectStore.ts:1022`, merge semantics; the dialog keeps its own file's function through the callback at `declaration-visitor.ts:139`)
   - **What this is:** The merge is `Object.assign` per category in input order, so the last file that declares a name wins in `mergedModel.functions`. A `Dialog` keeps the dictionary of the model that parsed it.
   - **Problem:** File A declares `INFO` with body A and a dialog using it, file B declares `INFO` with body B, and after a merge `mergedModel.functions.INFO` holds body B while `mergedModel.dialogs.DIA.actions` holds body A — two views of one dialog, disagreeing. The same merge order decides which `instance X` survives when one file only forward-declares it: whichever merges later wins, so a later forward-only file erases `npcId`/`dailyRoutine` from the merged instance and the project index drops that NPC's schedule.
   - **Fix:** Prefer the more complete declaration when merging a name (a body beats a forward declaration, a same-named clash is at least reported), rather than relying on array order. Which object owns an instance is #353's question; the linking consequence is that "who wins" is merge order today.
   - **If we skip it:** After a merge the editor can show one function body in the dialog panel and another in the function list, and the NPC schedule of a forward-declared instance comes and goes with file load order.

## Nice to have

8. **Three near-identical body scans in pass 1** (`daedalus-parser/src/semantic/visitors/declaration-visitor.ts:360-423`)
   - **What this is:** `extractInstanceDisplayName`, `extractNpcId` and `extractDailyRoutine` each walk `body.namedChildren`, look for the first matching assignment and read the right-hand side.
   - **Problem:** They must change together (they already did: `id` was added by copying `daily_routine`), and three loops doing one job is three places to fix the next field.
   - **Fix:** One `findBodyAssignment(node, field)` returning the assignment node, and three one-line readers on top of it. Roughly 45 lines become 15.
   - **If we skip it:** The fourth field costs another copy.

9. **The ERROR/missing-token rule exists in two places** (`daedalus-parser/src/semantic/visitors/error-visitor.ts:32-62` and `src/core/parser.js:270-286`)
   - **What this is:** The semantic visitor and the CLI parser wrapper implement the same two rules over the same tree.
   - **Problem:** Finding 3 is a bug in that rule, and fixing one copy leaves the other wrong; the two lists would then disagree about the same file.
   - **Fix:** Have `collectErrors` call the `ErrorVisitor` (or the reverse) so there is one rule; it also removes ~15 lines.
   - **If we skip it:** The next change to error reporting is made in one of the two.

## Verdict

Verdict: fix 1, 2, 3 and 4 first. Findings 1 and 4 lose content on save without any error; 2 makes the model of a duplicate file wrong where no test looks; 3 is one line and stops a one-character typo from leaving a file unsaveable with an empty explanation. 5, 6 and 7 are real but narrower (cross-file and raw-mode only), and each has a cheap containment.

Lean: -60 lines possible (finding 8's three scans, finding 9's duplicate error rule).

Not checked: the 890-file Beppo corpus is not on this machine, so load was judged from the code paths and proved with the repo's 12 corpus fixtures plus synthetic inputs, not with the real corpus; and I did not run the editor's Jest or Playwright suites, so the editor half of findings 4, 5 and 7 is read from source and from parser-level probes rather than from a UI run.
