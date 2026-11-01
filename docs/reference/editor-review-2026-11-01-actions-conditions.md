# Editor review — 2026-11-01, slice 5: actions and conditions (the surface that writes code)

Slice: `src/renderer/components/ActionCard.tsx`, `ActionsList.tsx`, `actionFactory.ts`,
`actionTemplates.ts`, `actionTypeRegistry.tsx`, `actionTypes.ts`,
`actionRenderers/` (all 34 files), `nestedActionUtils.ts`, `InlineChoiceEditor.tsx`,
`ChoiceTreeItem.tsx`, `ConditionEditor.tsx`, `ConditionCard.tsx`,
`ConditionSection.tsx`, `conditions/` (all 10 files), `components/common/`, and
`components/hooks/` — with the save-time validators and code generator read on the
other side of the boundary, because that is where a UI write is either kept or lost.

Commit reviewed: `62fdb8b`. Date: 2026-11-01.

**Load assumed.** A dialog with dozens of lines, several nested `if`/choice levels
and 2–4 condition cards; every keystroke of every field is a 300 ms-debounced
model write, and every blur is an immediate one; a project of hundreds of dialogs
feeds each autocomplete; the file is saved by hand or by auto-save while edits are
in flight. Judged against that: the debounce/stale-path machinery holds up
badly-verified but correctly (each of its five guards has a test), so this review
spends its findings on the two things that load makes expensive — a wrong value
that reaches the file, and a *shape* the model cannot spell.

**What this surface does.** `ActionsList` renders one `ActionCard` per action.
Each card keeps a local copy of its action and writes it back 300 ms after the
last keystroke, on blur, on unmount, and on save (through the pending-edit
flusher). Paths (`[index, 'then', index, …]`) address nested lists, so a write
into an `if` branch or a choice's sub-function goes through
`useActionManagement` → `editorStore.updateFunction*` → history → save
generation. Conditions have their own three-layer equivalent (`ConditionEditor` →
`ConditionCard` → `useConditionUpdate`), and the Add Action menu, the factory and
the templates decide what a freshly inserted action carries.

Everything below was checked against the parser's real generator
(`dist/codegen/generator.js` + `dist/semantic/*`) and with focused Jest runs, not
by reading the UI alone.

## What already holds, and the test that would fail if it broke

| Invariant | Test |
|---|---|
| A debounced edit never lands on a sibling after a delete/reindex | `tests/ActionCard.debounceStalePath.test.tsx`, `useConditionUpdate.interleave.test.tsx` |
| A save inside the debounce window serializes the newest keystroke | `tests/pendingEditFlush.test.tsx` |
| A card unmounted by a drag does not re-add the dragged action | `tests/ActionCard.test.tsx`, `ActionsList.test.tsx` |
| Path arithmetic for `if`/`else` nesting (update, insert, delete, move) | `tests/nestedActionUtils.test.ts` |
| A new Choice gets a seeded sub-dialog line and mirrors its text | `tests/choiceAutoSeedLine.test.ts`, `InlineChoiceEditor.test.tsx` |
| A quest step card's edits land on all of the step's lines | `tests/questSteps.test.ts` |
| A restored file round-trips through the editor save pipeline | `tests/saveFidelityCorpus.test.ts` |
| Panel re-render and autocomplete subscription budgets | `tests/ConditionEditor.rerender.test.tsx`, `useVariableOptions.pool.test.tsx` |

All of the named suites pass at this commit. What none of them covers is a *read→
edit→generate* round trip for the action shapes below, which is why each finding
names its own missing test.

## Must fix

1. **Flipping a dialog line's speaker leaves `AI_Output`'s listener behind** (`daedalus-dialog-editor/src/renderer/components/actionRenderers/DialogLineRenderer.tsx:29`, plus the id rewrite at `components/hooks/useActionManagement.ts:126-167`; the editor's `DialogLineAction` has no `listener` field at all, `src/shared/types.ts:263-270`)
   - **What this is:** A parsed line carries both arguments the parser read — `speaker` and `listener` (`daedalus-parser/src/semantic/dialogActions.ts:14-27`). The Speaker select writes `{...typedAction, speaker: value}` and nothing else; the id rewrite next door regenerates the voice id but not the listener.
   - **Problem:** The parser sets `listener` for every line it reads, so the generator's derived fallback (`this.listener ?? (speaker === 'other' ? 'self' : 'other')`) never applies. Render `DIA_Test_08_00` (`AI_Output (self, other, …)`), pick "Hero" and the file gets `AI_Output (other, other, "DIA_Test_15_00")` — the hero speaks to himself. Verified through the real component: the renderer wrote `{"speaker":"other","listener":"other"}`, and the parser's generator emitted `AI_Output (other, other, …)`. The UI shows Speaker = Hero and the text unchanged; only the source view reveals it, so nothing warns.
   - **Fix:** Flip the listener with the speaker in the same write: `listener: typedAction.listener === 'self' ? 'other' : 'self'` (fall back to `getOppositeSpeaker(value)` when absent), and add `listener?: 'self' | 'other'` to `DialogLineAction`.
   - **Test missing:** a renderer test that flips the select on a line with `listener: 'other'` and asserts the written action's listener, plus a generator assertion on the resulting `AI_Output` call.
   - **If we skip it:** one dropdown change on the most common action type writes code that is wrong in the engine (the speaking NPC turns to itself and the engine's dialogue camera target is the speaker), and the editor shows nothing.

2. **Anything inside an `if`/`else` branch escapes save-time validation** (`daedalus-dialog-editor/src/main/services/ValidationService.ts:326` choice targets, `:408` quoted strings, `:526` required fields — each iterating `func.actions` top-level only; the recursion already exists in `:439` `validateVoiceIds`)
   - **What this is:** The validator that runs before every write has five rules over a function's actions, and three of them read `func.actions` with `forEach` and never descend into `ConditionalAction.thenActions`/`elseActions`. The voice-id rule in the same file does descend, so the two disagree about what "an action" is.
   - **Problem:** `Info_AddChoice (DIA_X, "More", DIA_Typo)` nested in a branch is syntactically valid Daedalus, so it survives the round-trip syntax check, and `validateChoiceTargets` never sees it. Probed with the service itself: the same dangling choice is refused at the top level (`isValid: false`, "references missing target function 'DoesNotExist'") and **accepted nested** (`isValid: true`, no errors). The same hole swallows a required field that generation happens to tolerate (an empty `id` on a nested `DialogLine` emits `AI_Output (self, other, "");`, and the comment in `:439` says empty ids are "already reported by the DialogLine required-field validator" — for nested lines they are not).
   - **Fix:** Walk the list recursively in all four rules — one `walkActions(actions, visit)` helper used by `validateActions`, `validateChoiceTargets`, `validateStringContent` and `validateVoiceIds`, reporting `then`/`else` in the message.
   - **Test missing:** a `ValidationService` case per rule with the offending action inside `thenActions`, asserting the same error the top-level case produces (the suite has exactly one nested test today, and it is the voice-id rule).
   - **If we skip it:** the branch is the first place users put a choice (that is what an `if` is for), and a typo there saves a script that fails to compile in the game — the failure mode the validators exist to prevent, available only inside blocks.

3. **"Add Action" from an empty branch is broken for Choice and the quest-step entries** (`components/hooks/useActionManagement.ts:441-477`, versus the top-level path at `:350-374`; the throw is `actionFactory.ts:225-229`)
   - **What this is:** `ConditionalActionRenderer.tsx:174-188` offers "Add Action" on an empty branch and routes it to `addActionToBranchEnd`, which calls `createAction(type, { dialogName, currentAction, actions })` for every type. `insertAction` — the path every *other* entry point uses — special-cases two kinds before reaching the factory: quest steps (`actionType in QUEST_STEP_MENU_KINDS`) and Choice (generate a unique target function, seed a line, write the function into the model).
   - **Problem:** Two failures off one button. Picking "Start Quest"/"Complete Quest"/"Note" throws `Unknown action type: questStepId` inside a click handler — React error boundaries do not catch handler errors, so the menu closes and nothing is inserted (verified: `createAction('questStart')` throws). Picking "Choice" inserts `{targetFunction: ''}` with no sub-dialog (verified: `{"targetFunction":""}`), so the branch choice can never be filled until the user invents a target name — and by finding 2 a name that does not exist still saves.
   - **Fix:** give `addActionToBranchEnd` the same two branches `insertAction` has (or teach `insertAction` to append at a branch end and call it), so choice creation and quest-step line building exist once.
   - **Test missing:** a `ConditionalActionRenderer`/`useActionManagement` test that adds each addable type to an empty branch and asserts no throw, plus "a Choice added to an empty branch has a non-empty target and a function in the model".
   - **If we skip it:** the empty branch is exactly the state a user starts from, and half the menu silently does nothing there.

## Should fix

4. **The Teach arguments field cannot gain an argument by typing** (`components/actionRenderers/TeachActionRenderer.tsx:39-46` with `splitDaedalusArguments.ts:13-18`)
   - **What this is:** The field is fully controlled: its value is `teachArgs.join(', ')` and every keystroke re-splits the text to rebuild `teachArgs`. The splitter drops empty arguments (`if (argument.trim()) args.push(argument)`).
   - **Problem:** Typing a comma at the end of the list produces a trailing empty argument, which the splitter discards, so the comma disappears and the next character glues onto the previous argument. Replayed: from `self, other, SPL_LIGHT`, typing `, other` yields `self, other, SPL_LIGHTo`, `…LIGHTot`, … No argument can be added; only pasting a whole list works.
   - **Fix:** keep the raw text in local state (the shape `VariableAutocomplete` already uses) and split only on commit; or stop dropping empty slots.
   - **Test missing:** a renderer test that types `1, 2` into an empty arguments field and asserts `teachArgs` becomes `['1','2']`.
   - **If we skip it:** `B_Teach*` calls with more than the three template arguments cannot be authored in the editor at all.

5. **Blurring a condition field writes the condition back unchanged** (`components/hooks/useConditionUpdate.ts:35-41`)
   - **What this is:** `flushUpdate` clears the timer and then calls `updateCondition(index, localCondition)` unconditionally — no "did it change" check, unlike `ActionCard`'s `flushUpdate`, which compares against the parent-synced action first.
   - **Problem:** `updateCondition` rebuilds the condition object, so the write is always a new reference: `historyStore.pushSnapshotTransactional` only rolls a snapshot back when the *model* reference is unchanged, and `fileStore.updateFunctionWithUpdater` sets `isDirty = true` unconditionally. Verified: render `ConditionEditor`, click a condition field, click away without typing — `onUpdateFunction` is called once. So merely tabbing through the Conditions panel marks the file modified (auto-save rewrites it, close-guard asks to save) and pushes undo steps that change nothing, which makes Ctrl+Z appear dead for as many presses as fields were visited.
   - **Fix:** mirror ActionCard's guard — `if (shallowEqual(localConditionRef.current, conditionRef.current)) return;` before writing.
   - **Test missing:** focus + blur with no edit asserts `onUpdateFunction` is not called.
   - **If we skip it:** every visit to the Conditions panel dirties the file and pollutes undo history.

6. **"Insert condition template" silently changes the meaning of a `||` condition** (`components/actionRenderers/ConditionalActionRenderer.tsx:66-71`)
   - **What this is:** The template menu appends ` && <snippet>` to whatever is in the Condition field.
   - **Problem:** With `A || B` in the field, one click writes `A || B && C`, which parses as `A || (B && C)` — not the "also require this" the menu promises. The field does show the new text, so a reader who knows Daedalus precedence can catch it; a modder will not.
   - **Fix:** parenthesise the existing expression when it contains a top-level `||`: `(A || B) && C`.
   - **Test missing:** insert a template into a `||` condition and assert the written string is parenthesised.
   - **If we skip it:** the affordance quietly narrows the condition for exactly the expressions the raw-mode editor exists to protect.

7. **An expanded choice cannot show a target function that lives in another file** (`components/InlineChoiceEditor.tsx:55-63` versus `components/actionRenderers/ChoiceRenderer.tsx:44-45`)
   - **What this is:** Two resolvers for the same name. `ChoiceRenderer` uses `useResolvedFunction`, which falls back to the merged project model; `InlineChoiceEditor` uses `fileModel ?? stub`, i.e. the active file only, and renders "Function … not found" when the name is absent there.
   - **Problem:** In a project, a choice targeting a function declared in another file shows the expand toggle (merged lookup found it) and then "Function 'X' not found" when expanded, with no way to edit the sub-dialog inline. Nothing is lost on save; the editing affordance is.
   - **Fix:** resolve through `useResolvedFunction` here too, and call `setFunction` with the file that actually owns the function (the store already keys functions per file).
   - **Test missing:** an `InlineChoiceEditor` case where the target exists only in the merged model, asserting the sub-dialog renders instead of the "not found" line.
   - **If we skip it:** cross-file choice chains look broken in project mode while the pencil button proves the function exists.

8. **A choice that targets the function being edited freezes its sub-dialog's first line** (`components/hooks/useActionManagement.ts:240-252`)
   - **What this is:** Issue #181 mirrors a Choice's text into the first line of its target function. The mirror reads `semanticModel.functions[targetFunction]` — the closure's copy from the last render — and writes the whole function back through `onUpdateSemanticModel`, after `setFunction` has already written this keystroke's choice text.
   - **Problem:** When the target *is* the function being edited (`Info_AddChoice (DIA_X, "More", DIA_X_Info)`, a loop back into the same dialog), the write is stale: it reverts this keystroke's choice text and advances the seed line by only one keystroke. The `firstLine.text === previousText` guard then sees the seed line drift away from the choice text and stops mirroring, so the file keeps a first line one edit behind the choice.
   - **Fix:** read the target function inside the same `setFunction` updater (both writes are in one model), or skip the mirror when `targetFunction === currentFunctionName`.
   - **Test missing:** a `useActionManagement` test with a self-targeting choice asserting the seed line and the choice text end up equal.
   - **If we skip it:** the one dialog pattern where a choice re-enters its own function saves a mismatched first line, and the mismatch is invisible (the mirror is silent by design).

## Verdict

Verdict: fix 1, 2 and 3 first. Finding 1 is one dropdown click on the most common action and writes an `AI_Output` that is wrong in the game with nothing on screen to show it; finding 2 is the same class of silent wrong write one nesting level down, in the place users put choices; finding 3 makes the first button a user presses in an empty branch either do nothing or insert an action that cannot be completed. Findings 4–8 are real but containable, and each has a one- or two-line fix.

Lean: -50 lines possible — `UnknownActionRenderer` (45 lines plus its registry entry) is unreachable, since `getActionType` maps every unknown type to `customAction` and every `ActionTypeId` has a renderer; `ExchangeRoutineRenderer`'s `target`-vs-`npc` branch (`:26-36`) is unreachable too, because the parser only ever emits `target` (`parsers/action-parsers.ts:282`).

Not checked: no Playwright run, so the keyboard/drag flows are judged from their tests and code, not by driving the app. The 890-file Beppo corpus is not on this machine, so autocomplete load was judged from the pool caches and their suites rather than measured. I did not review the conditions' *parser* side (raw-guard extraction, `else if`) beyond the API they expose — that is `docs/reference/parser-review-2026-11-01-model.md`, and #446/#432/#436 already cover the raw-mode and `else if` cases I would otherwise have filed.
