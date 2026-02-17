# Quest Editor Corpus Gap Plan

## Purpose
Capture corpus-driven gaps in the Quest Editor and convert them into an executable backlog with clear acceptance criteria.

## Scope
- Parser semantic extraction for quest-relevant actions and conditions
- Quest analysis and project-mode quest slicing
- Quest flow graph behavior and guardrails
- Regression and corpus-validation coverage

## Corpus Baseline (Current)
Review scope and counts used for this plan:

- Dialog corpus root: `mdk/Content/Story/Dialoge`
- `*.d` files in dialog corpus: `352`
- `Info_AddChoice` hits: `3752`
- `Log_SetTopicStatus` lines: `293`
- `B_LogEntry` hits (dialog corpus): `765`
- `Log_AddEntry` hits (dialog corpus): `41` across `17` files
- `MIS == ...` comparisons: `989`
- `MIS != ...` comparisons: `112`
- `MIS <, >, <=, >= ...` comparisons: `12`
- `MIS = LOG_RUNNING` assignments: `190`
- `MIS = LOG_SUCCESS` assignments: `186`
- `MIS = LOG_FAILED` assignments: `31`
- `MIS = LOG_OBSOLETE` assignments: `31`

Identifier/casing observations:

- Topic constants in `mdk/Content/Story`: `125` (`TOPIC_*` + `Topic_*`)
- `Topic_*` constants: `11` (8 are actively used in log APIs)
- Known casing mismatches between constant and usage exist (example: `TOPIC_RescueBennet` vs `TOPIC_RESCUEBENNET`)

## Problem Summary
1. `Log_AddEntry` is not parsed as quest log action, so quest analysis/flow misses entries.
2. Topic identity matching is inconsistent across `TOPIC_*`, `Topic_*`, and case variants.
3. Quest completion/failure detection is overly tied to `Log_SetTopicStatus`; corpus uses `MIS_*` transitions heavily.
4. Project-mode `getQuestUsage` misses functions that write quest state via `MIS_*` but do not touch topic actions.
5. Guardrails do not fully account for `MIS_*` assignment-based quest transitions/failure paths.
6. Graph requires-links are mostly `==` only; corpus has meaningful `!=` and range-style checks.

## Workstreams

### QEC-01 Parse `Log_AddEntry` as `LogEntry`
Status: `done`

Goal:
- Treat `Log_AddEntry(topic, text)` as first-class log entry action, equivalent to `B_LogEntry`.

Primary files:
- `daedalus-parser/src/semantic/parsers/action-parsers.ts`
- `daedalus-parser/test/*` (new/updated parser tests)

Acceptance:
- `Log_AddEntry` appears as `LogEntry` in semantic model.
- Quest references and flow include entries sourced from `Log_AddEntry`.
- Regression tests include real corpus-like snippets.

Task breakdown:
- [x] Add `Log_AddEntry` case in `ActionParsers.parseSemanticAction`.
- [x] Add parser semantic test verifying `Log_AddEntry -> LogEntry` mapping.
- [x] Add round-trip test to ensure semantic stability after generation.
- [x] Run `daedalus-parser` test suite and confirm no regressions.

### QEC-02 Canonical Topic Identity Resolution
Status: `done`

Goal:
- Resolve topic identifiers case-insensitively and style-insensitively (`TOPIC_*` / `Topic_*`) while preserving source text for codegen.

Primary files:
- `daedalus-dialog-editor/src/renderer/components/QuestEditor/questAnalysis.ts`
- `daedalus-dialog-editor/src/renderer/components/QuestList.tsx`
- `daedalus-dialog-editor/src/renderer/store/projectStore.ts`

Acceptance:
- Quests are not dropped due to casing differences.
- Used/not-used status aligns with corpus usage.
- `Topic_*` note topics can be explicitly included/excluded by policy, not by accidental prefix filtering.

Task breakdown:
- [x] Introduce canonical topic key helper (case-insensitive identity).
- [x] Apply canonical matching in `questAnalysis` action/condition scans.
- [x] Apply canonical matching in `projectStore.getQuestUsage`.
- [x] Update `QuestList` filtering policy to support `Topic_*` handling by explicit rule.
- [x] Add regression tests for `TOPIC_RescueBennet` vs `TOPIC_RESCUEBENNET`.
- [x] Add regression tests for `Topic_*` note handling policy.

### QEC-03 Lifecycle Inference from `MIS_*` Transitions
Status: `done`

Goal:
- Infer quest progress and terminal states from `MIS_*` assignments in addition to topic status calls.

Primary files:
- `daedalus-dialog-editor/src/renderer/components/QuestEditor/questAnalysis.ts`
- `daedalus-dialog-editor/src/renderer/components/QuestDetails.tsx`

Acceptance:
- Implemented/WIP/not-started classification remains stable on corpus-like fixtures where topic status is sparse.
- `LOG_SUCCESS`, `LOG_FAILED`, `LOG_OBSOLETE` via `MIS_*` are reflected in quest state analysis.

Task breakdown:
- [x] Extend lifecycle signals to include `SetVariableAction` on quest `MIS_*`.
- [x] Define precedence when topic status and MIS state disagree.
- [x] Update detail chips/messages in `QuestDetails`.
- [x] Add tests covering MIS-only completion/failure/obsolete transitions.

### QEC-04 Include `MIS_*` Writers in Project Quest Usage
Status: `done`

Goal:
- Include functions that write quest `MIS_*` variables even when topic actions/conditions are absent.

Primary files:
- `daedalus-dialog-editor/src/renderer/store/projectStore.ts`

Acceptance:
- Quest usage model contains writer functions that only perform `MIS_* = ...`.
- Known corpus examples (for example `DIA_Addon_Fisk_GivePaket_Info`) are included.

Task breakdown:
- [x] Update relevance detection to include MIS writers (`SetVariableAction` on quest MIS var).
- [x] Keep dialog inclusion pass aligned with expanded relevant functions.
- [x] Add focused tests for writer-only functions with no topic actions/conditions.

### QEC-05 Guardrails Extended to `MIS_*`-Driven Flows
Status: `done`

Goal:
- Detect risky changes when failure/obsolete paths are represented by `MIS_*` assignments, not only `Log_SetTopicStatus`.

Primary files:
- `daedalus-dialog-editor/src/renderer/components/QuestEditor/questGuardrails.ts`
- `daedalus-dialog-editor/tests/questGuardrails.regression.test.ts`

Acceptance:
- Guardrail warnings cover both topic-status and MIS-assignment failure semantics.
- Existing blocking behavior remains deterministic in diff preview.

Task breakdown:
- [x] Update `touchesQuest` logic to include quest MIS writes.
- [x] Extend failure/obsolete path detection to include MIS assignment transitions.
- [x] Ensure delta-warning logic catches removal of MIS failure paths.
- [x] Add regression tests for MIS-driven failure/obsolete path preservation.

### QEC-06 Graph Support for Non-Equality MIS Conditions
Status: `pending`

Goal:
- Represent and safely edit/remove `!=` conditions, and show range comparisons as at least read-only explicit edges.

Primary files:
- `daedalus-dialog-editor/src/renderer/components/QuestEditor/questGraphUtils.tsx`
- `daedalus-dialog-editor/src/renderer/components/QuestEditor/Inspector/QuestInspectorPanel.tsx`
- `daedalus-dialog-editor/src/renderer/components/QuestEditor/commands/*`

Acceptance:
- `MIS != VALUE` requires edges are visible and distinguishable.
- Unsupported comparison forms are visibly read-only with explicit reason.

Task breakdown:
- [ ] Add `!=` dependency edge generation in quest graph utils.
- [ ] Surface operator in edge metadata/labels.
- [ ] Extend inspector for editable/removeable simple `!=` links.
- [ ] Keep `<, >, <=, >=` read-only with explicit UX explanation.
- [ ] Add graph/inspector regression coverage for mixed operators.

### QEC-07 Regression + Corpus Validation Harness
Status: `pending`

Goal:
- Lock behavior with targeted tests and periodic corpus scans.

Primary files:
- `daedalus-dialog-editor/tests/*quest*.test.ts*`
- `daedalus-parser/test/*`
- `daedalus-parser/scripts/roundtrip-corpus.js`

Acceptance:
- New tests cover each workstream and selected corpus fixtures.
- Sample corpus run shows no regression in semantic idempotence and no new parser breakages.

Task breakdown:
- [ ] Add fixture-driven tests for case/canonicalization and MIS-only flows.
- [ ] Add parser tests for `Log_AddEntry` and related action typing.
- [ ] Add command/guardrail tests for MIS failure-path handling.
- [ ] Establish a repeatable corpus sample command and result format.
- [ ] Track before/after metrics in this document.

## Execution Order
1. `QEC-01` Parser parity (`Log_AddEntry`)
2. `QEC-02` Topic identity normalization
3. `QEC-03` Lifecycle inference updates
4. `QEC-04` Project usage inclusion of MIS writers
5. `QEC-05` Guardrail expansion
6. `QEC-06` Graph/inspector/command support for non-equality
7. `QEC-07` Finalize tests + corpus validation

## Iteration Plan
Current iteration: `Sprint B` (active)

Objectives:
- Start `QEC-06` non-equality MIS graph support.
- Prepare `QEC-07` corpus validation pass with updated fixtures.

Deliverables:
- Graph/inspector handling for `!=` plus explicit read-only states for range operators.
- Consolidated corpus-validation run notes in this document.

Status tracker:
- `QEC-01`: `done`
- `QEC-02`: `done`
- `QEC-03`: `done`
- `QEC-04`: `done`
- `QEC-05`: `done`
- `QEC-06`: `pending`
- `QEC-07`: `pending`

## Progress Log
- `2026-02-17`: Completed `QEC-01`.
  - Parser now maps `Log_AddEntry` to `LogEntry` in `daedalus-parser/src/semantic/parsers/action-parsers.ts`.
  - Added tests in `daedalus-parser/test/log-add-entry.test.js`.
  - Verified with `npm test --workspace daedalus-parser -- log-add-entry.test.js`.
- `2026-02-17`: Started `QEC-02`.
  - Added case-insensitive quest topic / MIS matching in:
    - `daedalus-dialog-editor/src/renderer/components/QuestEditor/questAnalysis.ts`
    - `daedalus-dialog-editor/src/renderer/store/projectStore.ts`
    - `daedalus-dialog-editor/src/renderer/components/QuestList.tsx` (used-filter matching)
  - Added regression test in `daedalus-dialog-editor/tests/questAnalysis.test.ts`.
  - Verified with `npm test --workspace daedalus-dialog-editor -- questAnalysis.test.ts`.
- `2026-02-17`: Completed `QEC-02`, `QEC-03`, and `QEC-04`.
  - Added shared quest identity/lifecycle helpers in:
    - `daedalus-dialog-editor/src/renderer/utils/questIdentity.ts`
  - Updated topic/MIS canonical handling and lifecycle inference in:
    - `daedalus-dialog-editor/src/renderer/components/QuestEditor/questAnalysis.ts`
    - `daedalus-dialog-editor/src/renderer/components/QuestList.tsx`
    - `daedalus-dialog-editor/src/renderer/store/projectStore.ts`
    - `daedalus-dialog-editor/src/renderer/components/QuestDetails.tsx`
  - Added regression tests:
    - `daedalus-dialog-editor/tests/questAnalysis.test.ts`
    - `daedalus-dialog-editor/tests/projectStore.questUsage.test.ts`
  - Verified with `npm test --workspace daedalus-dialog-editor -- questAnalysis.test.ts projectStore.questUsage.test.ts`.
- `2026-02-17`: Completed `QEC-05`.
  - Extended guardrails for MIS-driven quest flows in:
    - `daedalus-dialog-editor/src/renderer/components/QuestEditor/questGuardrails.ts`
  - Added MIS failure-path regressions in:
    - `daedalus-dialog-editor/tests/questGuardrails.test.ts`
    - `daedalus-dialog-editor/tests/questGuardrails.regression.test.ts`
  - Verified with `npm test --workspace daedalus-dialog-editor -- questGuardrails.test.ts questGuardrails.regression.test.ts questAnalysis.test.ts projectStore.questUsage.test.ts`.

## Validation Commands
Run from repo root:

```powershell
# Dialog corpus shape checks
rg -n "\bInfo_AddChoice\b" mdk/Content/Story/Dialoge -g "*.d" | Measure-Object
rg -n "\b(B_LogEntry|Log_AddEntry)\b" mdk/Content/Story/Dialoge -g "*.d" | Measure-Object
rg -n "\bMIS_[A-Za-z0-9_]+\s*!=\s*" mdk/Content/Story/Dialoge -g "*.d" | Measure-Object

# Parser + editor tests
npm test --workspace daedalus-parser
npm test --workspace daedalus-dialog-editor

# Roundtrip sample
node daedalus-parser/scripts/roundtrip-corpus.js --root mdk/Content/Story/Dialoge --max-files 200 --no-strict
```

## Definition of Done
- All workstreams completed with passing tests.
- Quest list/details/flow reflect corpus quest behavior without casing artifacts.
- Diff preview guardrails remain explicit and reliable for branch-heavy edits.
