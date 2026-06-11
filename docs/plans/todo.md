# Prioritized To-Do

## P1 — Foundation (blocks other work)

1. **Parser API contract alignment**
   - Audit `index.d.ts` vs `src/core/parser.js` and exported TS modules
   - Remove/fix declarations that don't match runtime; add missing fields
   - Add regression tests for typed API usage

2. **Parser CLI reliability**
   - Replace `npx ts-node` scripts with deterministic local execution
   - Verify `semantic` and `format` CLI commands work in a clean environment

## P2 — OR Conditions (cross-cutting feature)

3. **Semantic model: add `conditionOperator` field**
   - Add `conditionOperator: 'AND' | 'OR'` to `DialogFunction`, default `'AND'`

4. **Parser: detect `||` in condition functions**
   - `linking-visitor.ts`: recurse into `||` expressions instead of raw-fallback
   - Handle mixed `&&`/`||` edge cases with raw fallback

5. **Code generator: emit `||`**
   - `generateConditionBody()` reads `conditionOperator` and joins with `||` or `&&`
   - Round-trip corpus tests green

6. **Editor types + store**
   - Add `conditionOperator?: 'AND' | 'OR'` to `shared/types.ts`

7. **Editor UI: AND/OR toggle**
   - `ConditionEditor.tsx`: toggle button group near "ALL must be true"
   - `ConditionCard.tsx`: chip reflects current operator

8. **Quest graph codec: OR support**
   - Remove `||` early-return fallback in `conditionExpressionCodec.ts`
   - Pass `conditionOperator` through `setConditionExpression.ts`
   - Display operator in `ConditionNode.tsx`

## P3 — In-App Updater

9. **CI: generate and upload `update-meta.json`**

10. **`UpdaterService.ts`**: check/download/install logic

11. **IPC wiring**: handlers in `main.ts`, bridge in `preload.ts`

12. **`UpdateNotification.tsx`**: footer chip + download dialog + startup check

13. **Settings persistence for updater preferences**

14. **Security: path validation for downloaded installer**

## P4 — E2E Coverage

15. **Core editing specs**: dialog properties, choice editing, action deletion, undo/redo, action type insertion (~15–20 tests)

16. **Navigation & project specs**: view switching, search, variable manager, action reordering (~15–20 tests)

17. **Polish specs**: theme switching, source view, reload confirmation, quest editor (~10–15 tests)

## P5 — Housekeeping

18. **Parser docs sync**: fix stale README examples, dead links, update test count
