# Slice 3 of 7 — action and condition extraction (commit `4e72f48`, 2026-10-31)

**What this change does:** This is the layer that turns one parsed statement into
one editor action or condition. `parsers/action-parsers.ts` and
`parsers/condition-parsers.ts` dispatch on the callee name, check the argument
count, and hand anything they do not own to a verbatim generic node;
`parsers/argument-parsing.ts` and `parsers/literal-parsing.ts` read the argument
texts; `action-source.ts` and `parsers/call-identity.ts` record the original
source ranges and callee so a later edit writes back into the right slot.

I read it against `docs/architecture/parser-fidelity.md` and
`docs/reference/parser-review-2026-09-29.md`, then drove ~60 source forms
through parse → generate in both style modes (comments on and off, source style
preserved and not) and took 9 edit scenarios through a JSON cycle. All of them
round-trip token-identically: wrong arity in either direction falls back and is
never dropped, comments inside and around a call survive, `includeComments:
false` is honoured, and the guards match the source truth table over all eight
A/B/C inputs, before and after an edit. I found no case where a recognized call
or guard is lost, duplicated or reordered.

Issue #432 (`else if`) is a deliberate refusal, not a break. The grammar accepts
`else if` (`alternative: choice(block, if_statement)`); `linking-visitor.ts:687`
declines to project it because `ConditionalAction` has no else-if slot, and
`preserveUnsupportedStatement` keeps the whole statement. Verified that the raw
action round-trips byte-intact, including while a sibling action is edited.

**Must fix:** None found.

**Should fix:**

1. **Every call is parsed a second time on its own, to learn its own name**
   (`daedalus-parser/src/semantic/parsers/call-identity.ts:17-27`, called from
   `parsers/action-parsers.ts:49` and `parsers/condition-parsers.ts:29`)
   - **What this is:** after an action is built, `captureCallIdentity` renders
     that one action back to text, wraps it in `func void __call_identity() { … };`,
     and parses it with a fresh tree, only to read the callee name off the result.
   - **Problem:** it runs for every call statement and every typed condition —
     one extra full tree-sitter parse per call. Measured on synthetic dialog
     files of the same shape as a real one: 3.7 ms of 11.3 ms (33 %) at 7 KB /
     150 calls, 10.1 of 32.6 (31 %) at 22 KB / 450, 32.0 of 92.0 (35 %) at
     59 KB / 1200. The whole difference is the per-call parse. The name it
     learns is a constant the construction site already holds
     (`generateCallStatement(this, 'AI_Output', …)`), and it matters only for a
     callee whose source spelling differs from that constant (`b_beklauen`).
     The editor runs this pass per file when it indexes a project — the metadata
     pool (`src/main/utils/semanticMetadataUtils.ts:584`) and the parser worker
     (`src/main/workers/parser.worker.ts:56`) both call `pass2_analyzeAndLink`
     — so an 890-file mod pays it once per file per load, and again on every
     save re-parse. The 4,000 snippet trees a 3,000-call file leaves behind are
     never `delete()`d, so they wait for GC.
   - **Fix:** pass the generated callee name from the construction site and
     compare the two strings there; keep the parse only for the case where the
     source spelling actually differs. If the registry-free design has to stay,
     skip the parse when the source callee already case-insensitively equals
     what the action would emit.
   - **If we skip it:** a third of the extraction budget on this layer keeps
     going into re-reading text the parser has just read, on project load and on
     every save.

2. **Four dispatch entries have no test that would notice them breaking**
   (`parsers/action-parsers.ts:92`, `:100`, `:117`, `:119`)
   - **What this is:** the dispatch table for `Log_SetTopicStatus`,
     `B_SetAttitude`, `B_GiveTradeInv` and `B_StartotherRoutine` (the
     lower-cased spelling; the canonical `B_StartOtherRoutine` is covered by
     `quote-export-contract.test.js`).
   - **Problem:** nothing in `test/` parses any of these four calls from source.
     `B_SetAttitude` and `Log_SetTopicStatus` appear only in
     `semantic-code-generator.unit.test.js:207,219`, which builds the class by
     hand and never exercises extraction. The one test that parses log actions,
     `semantic-code-generator.integration.test.js:492-493`, compares a count
     between the original and the regenerated model, so both sides fall to zero
     together. Because a wrong dispatch degrades to a *verbatim* generic action,
     every round-trip and token test still passes: delete `case
     'log_settopicstatus':` and the whole suite stays green while the editor
     shows those calls as uneditable raw text. The other action families are
     covered by a failing test: `action-argument-fidelity.test.js` asserts the
     parsed type per row, `quote-export-contract.test.js:92` edits a field only
     `StartOtherRoutineAction` has, and `review-source-boundaries.test.js:152`
     edits `damage` on `B_Attack`, which a generic action could not honour.
   - **Fix:** four rows in the `action-argument-fidelity.test.js` table, each
     with the `assert.equal(action.type, …)` the other rows already use, plus a
     wrong-arity row each. That file already fails when a type is lost.
   - **If we skip it:** a fifth of the dispatch table can rot silently, and the
     first symptom is an editor bug report about uneditable actions.

3. **The condition name list is written three times and the copies disagree**
   (`parsers/condition-parsers.ts:40-55`, `:199-218`, `:254-280`)
   - **What this is:** the six condition calls are matched three times: the main
     switch on `functionName`, a hard-coded name list under `!` in
     `parseUnaryExpression`, and a hard-coded name list in
     `parseSupportedCallComparisonWithCall`.
   - **Problem:** the three lists already differ — three names under `!`, five in
     comparisons, six in the main switch. Adding a condition to the main switch
     leaves `!NewCond(...)` and `NewCond(...) >= 1` as raw text while
     `NewCond(...)` parses structurally, and nothing fails or points at the two
     other lists. That is today's state for `Npc_HasItems`,
     `Npc_GetDistToWP` and `Npc_GetTalentSkill`: `!Npc_GetTalentSkill(other, "T")`
     is a raw clause while `Npc_GetTalentSkill(other, "T") == FALSE` is
     structured. Both stay verbatim, so this is a gap in the editor's reach, not
     in fidelity.
   - **Fix:** one table `name → arity → construct(args), negatable, comparable`
     consumed by all three paths. The three lists collapse into one loop.
   - **If we skip it:** every new condition is a three-place edit that silently
     half-works, and the next reviewer has to rediscover which list is authoritative.

**Nice to have:**

4. **Dead helper** (`parsers/argument-parsing.ts:17-26`)
   - **What this is:** `parseArguments` returns the normalized argument texts.
   - **Problem:** nothing imports it — not `src/`, not `test/`, not the editor,
     and `parsers/` is not a package subpath, so it is not public API either.
     Every caller uses `parseArgumentsDetailed` or `parseRawCallArguments`.
   - **Fix:** delete it (10 lines).
   - **If we skip it:** one more near-copy of the argument reader for someone to
     pick wrongly later.

5. **A default argument that can never be reached** (`parsers/argument-parsing.ts:77-82`,
   callers at `parsers/action-parsers.ts:246,255,264,291,309`)
   - **What this is:** `parseNumericArg(raw, fallback)` returns `fallback` when
     `raw` is undefined or empty.
   - **Problem:** all five call sites sit behind `parseActionWithArgs` with an
     exact arity, so `args[i].raw` always exists, e.g. `CreateInvItems (self,
     ItMi_Gold)` never reaches the factory. The parameter invites a future
     caller to lean on a silent `1`/`300`/`1` default, which the fidelity
     contract forbids ("falsy-coercion defaults are forbidden").
   - **Fix:** drop the parameter and the guard; return the raw text in that
     branch.
   - **If we skip it:** harmless today, a trap in the next parser added.

6. **Casts that assert a two-member union from an arbitrary spelling**
   (`parsers/action-parsers.ts:350` and `:397`)
   - **What this is:** `functionName as 'B_StartOtherRoutine' |
     'B_StartotherRoutine'` and `functionName as 'Npc_RemoveInvItems' |
     'Npc_RemoveInvItem'` claim a type the source text does not have;
     `functionName` is whatever casing the mod wrote.
   - **Problem:** for `StartOtherRoutineAction` the value is only echoed back, so
     the lie is inert. For `RemoveInventoryItemsAction` the generator *branches*
     on it (`inventoryActions.ts:130`), so the model field is load-bearing while
     its type says it cannot hold `npcremoveinvitems`. A stricter type would
     force the arity and the emit shape to be decided at extraction instead of
     re-read at generation.
   - **Fix:** store the arity (or a boolean `singular`) alongside the source
     spelling, and let the generator branch on that.
   - **If we skip it:** the type system stays silent about the one field that
     decides how many arguments a save writes.

**Verdict: fix 1 first.**

**Lean: -10 lines possible.**

**Not checked:** the MDK and Beppo corpora are not on this machine, so every
number above comes from the 12-file fixture corpus and synthetic files of the
same shape — the per-call ratio is linear and stable, but the absolute project-load
seconds are an estimate, not a measurement. I could not confirm against real mod
sources whether `C_Beklauen` takes the NPC as its first argument: the extractor
treats argument 0 as `minChance` (`action-parsers.ts:341`), and if the real
signature is `C_Beklauen(other, chance)` then the editor's chance fields point at
the wrong argument (output still round-trips through `pickpocketArgs`). Engine
behaviour was not tested; the guarantee checked here is source fidelity only.
