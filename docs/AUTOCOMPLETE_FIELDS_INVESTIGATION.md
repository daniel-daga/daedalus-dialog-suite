# Autocomplete field conditions investigation

This document maps where `VariableAutocomplete` is used and what conditions determine which suggestions appear.

Implementation source of truth: `daedalus-dialog-editor/src/renderer/components/common/autocompletePolicies.ts`.

## Core suggestion logic (`VariableAutocomplete`)

Suggestions are built from:

1. Constants from the local semantic model first, then merged project model.
2. Variables from the local semantic model first, then merged project model.
3. Instances only when `showInstances` is enabled.
4. Dialogs from project `dialogIndex` only when `showDialogs` is enabled.

Filtering behavior:

- `typeFilter` must match the option type (case-insensitive).
- `namePrefix` must match beginning of the option name (case-insensitive).
- Duplicates are removed by lowercase name.
- Dialog suggestions are tagged as type `C_INFO`.

UX behavior:

- If options > 2000 and input length < 2, normal suggestions are withheld.
- In that large-list case, only an `Add "..."` creation suggestion is shown (if creation is enabled).
- A `Follow reference` navigation icon appears only when the current value exactly matches a known option.

## Condition editor (`ConditionCard`) autocomplete mapping

Condition types using autocomplete:

- `NpcKnowsInfoCondition`
  - `NPC` field: instances filtered to `C_NPC`.
  - `Dialog` field: instances + dialogs, filtered to `C_INFO` and prefix `DIA_`.
- `VariableCondition`
  - `Variable Name` filtered to `int|string|float`.
- `NpcHasItemsCondition`
  - `NPC` filtered to `C_NPC` instances.
  - `Item` from instances (no explicit type filter).
- `NpcIsInStateCondition`
  - `NPC` filtered to `C_NPC` instances.
- `NpcIsDeadCondition`
  - `NPC` filtered to `C_NPC` instances.
- `NpcGetDistToWpCondition`
  - `NPC` filtered to `C_NPC` instances.
- `NpcGetTalentSkillCondition`
  - `NPC` filtered to `C_NPC` instances.

Condition type not using autocomplete:

- Generic `Condition` uses a plain text field.

## Dialog properties section autocomplete mapping

- Dialog `NPC` property uses instances filtered to `C_NPC`.
- Dialog `Description` uses string symbols prefixed by `DIALOG_`.

## Action renderer autocomplete mapping

Autocomplete-enabled actions and field constraints:

- `AttackActionRenderer`: attacker + target as `C_NPC` instances.
- `CreateInventoryItemsRenderer`: NPC as `C_NPC`, item as `C_ITEM`.
- `CreateTopicRenderer`: topic as `string` with prefix `TOPIC_`.
- `ExchangeRoutineRenderer`: NPC as `C_NPC`.
- `GiveInventoryItemsRenderer`: source NPC `C_NPC`, target NPC `C_NPC`, item `C_ITEM`.
- `LogEntryRenderer`: topic as `string` with prefix `TOPIC_`.
- `LogSetTopicStatusRenderer`: topic as `string` with prefix `TOPIC_`.
- `PlayAniActionRenderer`: NPC as `C_NPC`.
- `SetAttitudeActionRenderer`: NPC as `C_NPC`, attitude as `int`.
- `SetVariableActionRenderer`: variable as `int|string|float`.
- `StopProcessInfosActionRenderer`: NPC as `C_NPC` (without `showInstances`, so it resolves from symbol tables only).

Intentional exception:

- `PlayAniActionRenderer` also uses `C_NPC` without `showInstances` (symbol-table-only suggestions).

## Project mode dependency

In project mode, autocomplete quality depends on merged model composition:

- When selecting an NPC, the app parses NPC dialog files and merges only:
  - that NPC's files, plus
  - global files not tied to any NPC dialogs.

So autocomplete options can differ per selected NPC in project mode.
