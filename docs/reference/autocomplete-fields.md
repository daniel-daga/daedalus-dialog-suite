# Autocomplete Fields Reference

Implementation source of truth: `daedalus-dialog-editor/src/renderer/components/common/autocompletePolicies.ts`.

## Core `VariableAutocomplete` Rules

Suggestions are built from:

1. Constants from local semantic model, then merged project model.
2. Variables from local semantic model, then merged project model.
3. Instances only when `showInstances` is enabled.
4. Dialogs from project `dialogIndex` only when `showDialogs` is enabled.

Filtering behavior:

- `typeFilter` is case-insensitive and must match option type.
- `namePrefix` is case-insensitive and must match option prefix.
- Duplicates are removed by lowercase name.
- Dialog suggestions are tagged with type `C_INFO`.

Large list behavior:

- If options exceed `2000` and input length is `< 2`, normal suggestions are withheld.
- In that case, only `Add "..."` is shown (if creation is enabled).
- `Follow reference` appears only when the current value exactly matches a known option.

## Condition Editor Mapping (`ConditionCard`)

Autocomplete-enabled condition fields:

- `NpcKnowsInfoCondition`
  - `NPC`: instances filtered to `C_NPC`.
  - `Dialog`: instances + dialogs, filtered to `C_INFO` and prefix `DIA_`.
- `VariableCondition`
  - `Variable Name`: filtered to `int|string|float`.
- `NpcHasItemsCondition`
  - `NPC`: `C_NPC` instances.
  - `Item`: instances (no explicit type filter).
- `NpcIsInStateCondition`
  - `NPC`: `C_NPC` instances.
- `NpcIsDeadCondition`
  - `NPC`: `C_NPC` instances.
- `NpcGetDistToWpCondition`
  - `NPC`: `C_NPC` instances.
- `NpcGetTalentSkillCondition`
  - `NPC`: `C_NPC` instances.

Condition type without autocomplete:

- Generic `Condition` uses plain text input.

## Dialog Properties Mapping

- Dialog `NPC` property: instances filtered to `C_NPC`.
- Dialog `Description` property: string symbols prefixed by `DIALOG_`.

## Action Renderer Mapping

Autocomplete-enabled action fields:

- `AttackActionRenderer`: attacker + target as `C_NPC`.
- `CreateInventoryItemsRenderer`: NPC `C_NPC`, item `C_ITEM`.
- `CreateTopicRenderer`: topic `string` with prefix `TOPIC_`.
- `ExchangeRoutineRenderer`: NPC `C_NPC`.
- `GiveInventoryItemsRenderer`: source and target NPC `C_NPC`, item `C_ITEM`.
- `LogEntryRenderer`: topic `string` with prefix `TOPIC_`.
- `LogSetTopicStatusRenderer`: topic `string` with prefix `TOPIC_`.
- `PlayAniActionRenderer`: NPC `C_NPC`.
- `SetAttitudeActionRenderer`: NPC `C_NPC`, attitude `int`.
- `SetVariableActionRenderer`: variable `int|string|float`.
- `StopProcessInfosActionRenderer`: NPC `C_NPC` (symbol-table suggestions only).

Intentional exception:

- `PlayAniActionRenderer` also uses symbol-table-only `C_NPC` suggestions (`showInstances` disabled).

## Project Mode Dependency

Merged project suggestions require project mode data (`dialogIndex` and merged semantic symbols). In single-file mode, suggestions are limited to the local semantic model.
