# Plan: OR Conditions for Dialog Conditions

**Date:** 2026-04-04
**Scope:** daedalus-parser + daedalus-dialog-editor
**Status:** Draft

---

## Objective

Add support for OR-grouped conditions in the dialog condition system. Currently, all conditions in a `DialogFunction.conditions` array are implicitly AND-combined. This plan introduces a way to express "condition A OR condition B" alongside the existing AND logic, across the parser semantic model, code generator, editor UI, and quest graph integration.

---

## Current State

### How conditions work today

1. **Grammar** (`daedalus-parser/grammar.js:152-194`): The tree-sitter grammar already supports both `&&` and `||` operators with correct precedence (`||` at prec 1, `&&` at prec 2).

2. **Semantic model** (`daedalus-parser/src/semantic/semantic-model.ts:657`): `DialogFunction` stores `conditions: DialogCondition[]` -- a flat array. All entries are implicitly AND-combined.

3. **Condition types** (`daedalus-parser/src/semantic/conditionTypes.ts`): Nine concrete condition classes (`NpcKnowsInfoCondition`, `VariableCondition`, `NpcHasItemsCondition`, etc.) plus a generic `Condition` fallback. No grouping/logical wrapper type exists.

4. **Parsing** (`daedalus-parser/src/semantic/parsers/condition-parsers.ts:61-94`): `parseBinaryExpression()` only handles comparison operators (`==`, `!=`, `<`, `>`, `<=`, `>=`). When encountering `||` or `&&`, the function returns null, and the expression falls through to the generic `Condition` class (raw text).

5. **Linking visitor** (`daedalus-parser/src/semantic/visitors/linking-visitor.ts:186-221`): `handleConditionNode()` walks binary expressions. If the operator is logical (`&&`), it recurses into left/right children, collecting individual conditions into the flat array. If the operator is `||`, the entire expression becomes a raw `Condition`.

6. **Code generation** (`daedalus-parser/src/codegen/generator.ts:421-446`): `generateConditionBody()` joins multiple conditions with `&&` (hardcoded at line 439). No mechanism for `||`.

7. **Editor types** (`daedalus-dialog-editor/src/shared/types.ts:303-326`): Mirror of the parser types. `DialogFunction.conditions` is a flat `DialogCondition[]`.

8. **Editor UI** (`daedalus-dialog-editor/src/renderer/components/ConditionCard.tsx:66-72`): Displays an "AND" chip between conditions. No "OR" chip exists. The `ConditionEditor.tsx:275` shows "ALL must be true".

9. **Quest graph codec** (`daedalus-dialog-editor/src/renderer/components/QuestEditor/commands/conditionExpressionCodec.ts:173-182`): When `||` is detected during expression parsing, the entire expression falls back to generic (raw text) mode -- structured condition information is lost.

10. **Quest graph types** (`daedalus-dialog-editor/src/renderer/types/questGraph.ts:51`): Already has `operator?: 'AND' | 'OR'` field on node data, suggesting this was anticipated.

### What happens with OR today

```
Input:   if (Npc_KnowsInfo(other, DIA_X) || MIS_Quest == LOG_RUNNING) { return TRUE; };
Result:  Single Condition({ type: 'Condition', condition: 'Npc_KnowsInfo(other, DIA_X) || MIS_Quest == LOG_RUNNING' })
```

The structured information is lost. The condition renders as raw text in the editor.

---

## Design

### Core Decision: Condition Groups

Introduce a **condition group** model where `DialogFunction` holds an ordered list of **groups**, and each group has a **logical operator** (`AND` or `OR`) that specifies how the conditions *within* that group relate to each other. Groups themselves are combined with AND (matching the most common Daedalus patterns).

This gives us the expressiveness to represent:

- **All AND** (current behavior): single group with AND operator
- **All OR**: single group with OR operator
- **Mixed**: `(A && B) || (C && D)` via two AND-groups, with inter-group OR

However, **Phase 1** keeps it simple: a single flat list of conditions with a **top-level logical operator** (`AND` or `OR`) that determines how all conditions in the list are combined. This covers the majority of real-world Daedalus dialog conditions while requiring minimal structural changes.

### Phase 1 Data Model (Top-level operator)

```typescript
// Parser: semantic-model.ts
export class DialogFunction {
  public conditions: DialogCondition[];
  public conditionOperator: 'AND' | 'OR';  // NEW - defaults to 'AND'
  // ...
}
```

```typescript
// Editor: types.ts
export interface DialogFunction {
  conditions: DialogCondition[];
  conditionOperator?: 'AND' | 'OR';  // NEW - undefined treated as 'AND'
  // ...
}
```

### Phase 2 Data Model (Condition groups -- future)

```typescript
export interface ConditionGroup {
  operator: 'AND' | 'OR';
  conditions: DialogCondition[];
}

export class DialogFunction {
  public conditionGroups: ConditionGroup[];
  // conditions remains for backward compat during migration
}
```

Phase 2 is out of scope for this plan but the Phase 1 design is forward-compatible: a single group with an operator field maps directly to `ConditionGroup[]` later.

---

## Implementation Phases

### Phase 1: Parser Semantic Model + Serialization

**Goal:** The semantic model can represent AND or OR condition semantics and round-trips correctly through serialization.

**Files to modify:**

| File | Change |
|------|--------|
| `daedalus-parser/src/semantic/semantic-model.ts` | Add `conditionOperator: 'AND' \| 'OR'` to `DialogFunction`, default `'AND'` in constructor |
| `daedalus-parser/src/semantic/conditionTypes.ts` | No change needed (individual conditions are unchanged) |

**Tests:**
- Verify `DialogFunction` serialization/deserialization includes `conditionOperator`
- Verify default value is `'AND'` for backward compatibility

**Done criteria:** `DialogFunction` has `conditionOperator` field; existing tests pass unchanged.

---

### Phase 2: Parser -- Detect OR in Condition Parsing

**Goal:** When parsing a condition function body, detect whether conditions are joined by `||` and set `conditionOperator` to `'OR'`.

**Files to modify:**

| File | Change |
|------|--------|
| `daedalus-parser/src/semantic/visitors/linking-visitor.ts` | In `handleConditionNode()`: when top-level binary expression has `\|\|` operator, set `conditionOperator = 'OR'` on the current function, then recurse into left/right to collect individual conditions (same as AND path today) |
| `daedalus-parser/src/semantic/parsers/condition-parsers.ts` | No structural change needed -- the individual conditions within an OR are the same types |

**Key logic change in `linking-visitor.ts:186-221`:**

```
Current: 
  if operator is &&  → recurse left, recurse right (collect conditions)
  if operator is ||  → fall through to generic Condition (raw text)

New:
  if operator is &&  → recurse left, recurse right; conditionOperator stays 'AND'
  if operator is ||  → recurse left, recurse right; set conditionOperator = 'OR'
```

**Edge cases to handle:**
- Mixed `&&` and `||` at the same top level: fall back to raw `Condition` (preserves current behavior for complex expressions). Only pure-OR or pure-AND top-level expressions get structured parsing.
- Nested expressions: `(A || B) && C` -- detect the mix and fall back to raw.

**Tests:**
- Parse `if (A || B) { return TRUE; }` → 2 structured conditions, `conditionOperator = 'OR'`
- Parse `if (A && B) { return TRUE; }` → 2 structured conditions, `conditionOperator = 'AND'` (unchanged)
- Parse `if (A || B && C) { return TRUE; }` → raw fallback (mixed operators at different precedence)
- Parse `if (A && B || C) { return TRUE; }` → raw fallback

**Done criteria:** OR-connected conditions in `_condition` functions are parsed into structured `DialogCondition[]` with `conditionOperator = 'OR'`.

---

### Phase 3: Code Generator -- Emit OR

**Goal:** When generating condition function bodies, use `||` when `conditionOperator` is `'OR'`.

**Files to modify:**

| File | Change |
|------|--------|
| `daedalus-parser/src/codegen/generator.ts` | `generateConditionBody()` (lines 421-446): read `conditionOperator` and use `\|\|` instead of `&&` when appropriate |

**Change detail:**

```typescript
// generator.ts:generateConditionBody - updated
private generateConditionBody(
  conditions: DialogCondition[], 
  lines: string[], 
  indent: string,
  conditionOperator: 'AND' | 'OR' = 'AND'  // NEW parameter
): void {
  // ... existing empty/single-condition cases unchanged ...
  
  const joiner = conditionOperator === 'OR' ? '|| ' : '&& ';
  const condCodes = conditions.map(c => this.generateCondition(c));
  lines.push(`${indent}if (${condCodes[0]}`);
  for (let i = 1; i < condCodes.length; i++) {
    lines.push(`${indent}${joiner}${condCodes[i]}`);
  }
  // ...
}
```

The caller of `generateConditionBody()` needs to pass `func.conditionOperator`.

**Tests:**
- Round-trip: OR conditions parse and regenerate correctly
- Round-trip: AND conditions continue to work identically
- Corpus tests pass (`npm run test:roundtrip-corpus`)

**Done criteria:** `npm test` and `npm run test:roundtrip-corpus` green; OR conditions round-trip.

---

### Phase 4: Editor Types + Store

**Goal:** Editor can store and propagate the `conditionOperator` field.

**Files to modify:**

| File | Change |
|------|--------|
| `daedalus-dialog-editor/src/shared/types.ts` | Add `conditionOperator?: 'AND' \| 'OR'` to `DialogFunction` interface |
| `daedalus-dialog-editor/src/renderer/store/fileStore.ts` | No structural changes needed -- the field flows through the semantic model |

**Done criteria:** TypeScript compiles; existing editor tests pass.

---

### Phase 5: Editor UI -- Condition Operator Toggle

**Goal:** User can toggle between AND and OR for a dialog function's conditions.

**Files to modify:**

| File | Change |
|------|--------|
| `daedalus-dialog-editor/src/renderer/components/ConditionEditor.tsx` | Add AND/OR toggle button group near the "ALL must be true" text (line 275). Toggling updates `localFunction.conditionOperator`. |
| `daedalus-dialog-editor/src/renderer/components/ConditionCard.tsx` | Change hardcoded "AND" chip (line 68) to display the current operator (`AND` or `OR`). Use different chip color for OR (e.g., `color="secondary"`). |

**UI design:**

```
Conditions (2)    [AND | OR]     +
─────────────────────────────────
  Npc_KnowsInfo: other knows DIA_X
       OR
  Quest State: MIS_Quest == LOG_RUNNING
```

- Toggle button group: `ToggleButtonGroup` from MUI with `AND` and `OR` options
- Chip between conditions: reflects current operator
- Status text: "ALL must be true" vs "ANY must be true"

**Tests:**
- Component test: toggle changes `conditionOperator`
- Component test: chip displays correct operator
- Component test: status text updates

**Done criteria:** User can visually switch between AND/OR in the condition editor.

---

### Phase 6: Quest Graph Integration

**Goal:** Quest graph condition expression codec handles OR conditions structurally instead of falling back to raw mode.

**Files to modify:**

| File | Change |
|------|--------|
| `daedalus-dialog-editor/src/renderer/components/QuestEditor/commands/conditionExpressionCodec.ts` | Remove the early-return fallback for `\|\|` at line 173-182. Instead, parse OR expressions into structured conditions and set `conditionOperator = 'OR'` on the result. |
| `daedalus-dialog-editor/src/renderer/components/QuestEditor/commands/setConditionExpression.ts` | Pass `conditionOperator` through to the semantic model update |
| `daedalus-dialog-editor/src/renderer/components/QuestEditor/Nodes/ConditionNode.tsx` | Display operator in condition node visualization |

**Done criteria:** Typing `A || B` in the quest graph condition expression input produces structured conditions with OR operator.

---

## Design Decisions

| Concern | Decision | Rationale |
|---------|----------|-----------|
| Grouping model | Single top-level operator per function (Phase 1) | Covers 95%+ of real Daedalus patterns; avoids premature complexity of nested groups |
| Mixed operators | Fall back to raw `Condition` | `(A && B) \|\| C` requires groups (Phase 2); keep Phase 1 simple |
| Default operator | `'AND'` | Backward compatible; existing conditions without the field behave identically |
| Serialization | Optional field, absent = AND | Zero migration cost; old models load unchanged |
| UI placement | Toggle button in ConditionEditor header | Visible, discoverable, non-disruptive to existing layout |

---

## Backward Compatibility

- **Semantic model serialization:** `conditionOperator` is optional. Absent field is treated as `'AND'`. No migration step needed.
- **Code generation:** Existing `&&`-joined output is unchanged when field is absent or `'AND'`.
- **Editor UI:** Default state shows "AND" (unchanged appearance for existing dialogs).
- **Parser:** Existing AND-condition files parse identically. OR-condition files that previously fell back to raw text will now gain structured parsing (improvement, not breakage).

---

## Risk and Mitigations

| Risk | Mitigation |
|------|------------|
| Mixed `&&`/`||` expressions lose structure | Explicit detection + raw fallback preserves current behavior |
| Existing round-trip tests break | `conditionOperator` defaults to `'AND'`; no output change for existing inputs |
| Quest graph codec regression | Targeted tests for both AND and OR expression parsing |
| Serialization format change breaks saved files | Field is optional with default; old files load without change |

---

## Testing Strategy

Following the TDD workflow required by AGENTS.md:

1. **Parser unit tests** (`daedalus-parser/test/condition-parsing.test.js`):
   - OR condition extraction: `if (A || B) { return TRUE; }`
   - Mixed operator fallback: `if (A && B || C) { return TRUE; }`
   - `conditionOperator` field value assertions

2. **Code generation tests** (`daedalus-parser/test/`):
   - OR round-trip: parse OR conditions, regenerate, verify `||` in output
   - AND round-trip: unchanged behavior

3. **Corpus round-trip** (`npm run test:roundtrip-corpus`):
   - Full corpus must stay green after all changes

4. **Editor component tests** (`daedalus-dialog-editor/src/renderer/components/__tests__/`):
   - ConditionEditor toggle behavior
   - ConditionCard chip rendering
   - Store propagation of `conditionOperator`

5. **Quest graph codec tests**:
   - OR expression parsing produces structured conditions
   - AND expression parsing unchanged

---

## Implementation Sequence

```
Phase 1 (model) → Phase 2 (parsing) → Phase 3 (codegen)
          ↓                                    ↓
      Phase 4 (editor types) ──────→ Phase 5 (editor UI)
                                           ↓
                                   Phase 6 (quest graph)
```

Phases 1-3 are in `daedalus-parser` and can be completed as a single PR.
Phases 4-6 are in `daedalus-dialog-editor` and depend on the parser changes.

---

## Files Summary

### daedalus-parser (modify)

| File | Phase |
|------|-------|
| `src/semantic/semantic-model.ts` | 1 |
| `src/semantic/visitors/linking-visitor.ts` | 2 |
| `src/codegen/generator.ts` | 3 |
| `test/condition-parsing.test.js` | 1, 2, 3 |

### daedalus-dialog-editor (modify)

| File | Phase |
|------|-------|
| `src/shared/types.ts` | 4 |
| `src/renderer/components/ConditionEditor.tsx` | 5 |
| `src/renderer/components/ConditionCard.tsx` | 5 |
| `src/renderer/components/QuestEditor/commands/conditionExpressionCodec.ts` | 6 |
| `src/renderer/components/QuestEditor/commands/setConditionExpression.ts` | 6 |
| `src/renderer/components/QuestEditor/Nodes/ConditionNode.tsx` | 6 |

### No new files required
