# Dialog Editor - Code Review

*Reviewed against: `master` @ 5f66f1e (2026-03-26)*

## Summary

The dialog editor is a well-structured React + TypeScript application with clear separation
of concerns. The hook decomposition (`useDialogEditorCommands`, `useDialogEditorUIState`,
`useActionManagement`, `useFocusNavigation`) is well thought-out, and the action
renderer registry pattern is clean and extensible. That said, there are several
maintainability, type safety, and framework best-practice issues worth addressing.

---

## Critical Issues

### 1. `any` types in core utilities undermine TypeScript's value

**Files:** `dialogUtils.ts:9,26`, `actionFactory.ts:68,105,148-150,156-159,162,289-291`

`createEmptyFunction` returns `any`. `generateUniqueChoiceFunctionName` accepts
`semanticModel: any`. `createAction` returns `any` and accepts `ActionCreationContext`
fields typed as `any`. This is the factory code that *creates* all actions in the system
-- if it's `any`-typed, type errors downstream go undetected.

```ts
// dialogUtils.ts:26 - returns any, should return DialogFunction
export const createEmptyFunction = (functionName: string): any => { ... };

// actionFactory.ts:156-159 - returns any, context fields are any
export function createAction(
  actionType: ActionTypeId,
  context: ActionCreationContext = {}
): any { ... }
```

**Recommendation:** Return `DialogFunction` from `createEmptyFunction`, return
`DialogAction` (or `ActionType`) from `createAction`, and type `ActionCreationContext`
fields properly. The discriminated union `ActionType` already exists in `actionTypes.ts`
and should be used.

---

### 2. Property-sniffing `getActionType` is fragile and order-dependent

**File:** `actionTypes.ts:233-316`

Action type detection relies on checking for the presence of specific properties
(`hasProperty`) rather than using a discriminant field. The logic is order-dependent
(e.g., `stopProcessInfosAction` is a fallback that only matches after ruling out
*every other action type that has a `target` field*). This is fragile -- adding a new
action type with a `target` field could silently change detection behavior.

Every action already has a `type` field (e.g., `'DialogLine'`, `'Choice'`,
`'ConditionalAction'`). The `getActionType` function should use it as the primary
discriminant:

```ts
export function getActionType(action: DetectableAction): ActionTypeId {
  if ('type' in action) {
    const typeMap: Record<string, ActionTypeId> = {
      'DialogLine': 'dialogLine',
      'Choice': 'choice',
      'ConditionalAction': 'conditionalAction',
      // ...
    };
    const mapped = typeMap[(action as any).type];
    if (mapped) return mapped;
  }
  return 'customAction';
}
```

---

### 3. Duplicate action menu items list

**Files:** `ConditionalActionRenderer.tsx:21-44` vs `ActionTypeMenu` (used elsewhere)

`ConditionalActionRenderer` maintains its own hardcoded `ACTION_MENU_ITEMS` array with
labels, duplicating the `ACTION_TYPE_LABELS` map in `actionRenderers/index.tsx`. If a new
action type is added, this list must be updated in multiple places.

**Recommendation:** Derive the menu items from `ACTION_TYPE_LABELS` (the single source of
truth), or extract a shared constant.

---

## Moderate Issues

### 4. `ActionCard` debounce flush on unmount may cause stale updates

**File:** `ActionCard.tsx:78-87`

The unmount cleanup flushes the debounced update using refs:

```ts
React.useEffect(() => {
  return () => {
    if (updateTimerRef.current) {
      clearTimeout(updateTimerRef.current);
      updateActionRef.current(pathRef.current, localActionRef.current);
    }
  };
}, []);
```

This correctly uses refs to avoid stale closures, but there's a subtle race condition:
when actions are reordered (drag-and-drop), `ActionCard` unmounts and remounts at a new
index. The unmount flush fires with `pathRef.current` which may point to the *old* path
before the move was applied. If the parent has already processed the move, this flush
could overwrite the wrong action.

**Recommendation:** Consider adding a `mounted` ref flag, or skip the unmount flush if
a drag operation is in progress.

### 5. `JSON.stringify` used for path comparison is slow for hot paths

**Files:** `useActionManagement.ts:164,193,231,277`

```ts
const currentIndex = visiblePaths.findIndex(
  (candidate) => JSON.stringify(candidate) === JSON.stringify(path)
);
```

`JSON.stringify` comparison in `findIndex` over action paths is used repeatedly in
hot paths (every action add/delete/focus). The `actionPathToKey` function already
exists and does the same job faster (simple `join('.')`).

**Recommendation:** Replace all `JSON.stringify` path comparisons with `actionPathToKey`.

### 6. `setTimeout(() => focusAction(...), 0)` pattern is used everywhere

**Files:** `useDialogEditorCommands.ts:127,131`, `useActionManagement.ts:170-172,198-200,237-238,292-293,327-328`

The `setTimeout(..., 0)` is used to defer focus after state updates. This works but is
brittle -- it relies on the assumption that React will flush the state update and render
synchronously within one tick. In React 18's concurrent mode, this isn't guaranteed.

**Recommendation:** Consider using `requestAnimationFrame` or `flushSync` + immediate
focus. Alternatively, the existing `pendingFocusRequests` mechanism in `useFocusNavigation`
already handles deferred focus -- it might be possible to use it instead of `setTimeout`.

### 7. `alert()` used for validation errors

**File:** `ChoiceRenderer.tsx:92`

```ts
alert(validationError);
```

Using browser `alert()` blocks the UI thread and is inconsistent with the rest of the
application, which uses MUI Snackbar/Dialog for notifications. This also won't work well
in Electron (it shows a native dialog instead of an in-app notification).

**Recommendation:** Use the snackbar mechanism already in place, or show an inline
error state on the text field.

### 7b. New `Escape` key handler deletes any focused action (not just empty dialog lines)

**File:** `ActionCard.tsx:164-166` *(added in 39100c5)*

```ts
} else if (e.key === 'Escape') {
  e.preventDefault();
  handleDeleteAndFocusPrev();
}
```

The new Escape handler calls `handleDeleteAndFocusPrev` unconditionally for *all* action
types. Unlike the Backspace handler (which guards on `isDialogLine && !hasNonEmptyText`),
pressing Escape will immediately delete a fully-filled-out action with no confirmation.
This is destructive and easy to trigger accidentally (e.g., trying to dismiss a dropdown
or deselect). Combined with the debounce flush issue (#4), this could also cause data loss
on the previously focused action.

**Recommendation:** Either limit Escape to empty dialog lines (like Backspace), add a
confirmation, or change it to blur/defocus instead of delete.

### 8. `shallowEqual` on `ActionCard` memo won't catch nested action changes

**File:** `ActionCard.tsx:356-371`

The custom `React.memo` comparator uses `shallowEqual` on the `action` prop:

```ts
return shallowEqual(prevProps.action, nextProps.action);
```

For `ConditionalAction`, the action has nested `thenActions` and `elseActions` arrays.
`shallowEqual` only compares top-level keys with `Object.is`, so a change inside a nested
branch array won't trigger a re-render of the parent `ActionCard` unless the array
reference itself changes. This *probably* works because Immer/spread creates new references,
but it's a latent bug if any code path mutates in place.

### 8b. Default speaker logic changed but inconsistently

**File:** `useActionManagement.ts:187-188` *(changed in 0849c5c)*

The default speaker when `toggleSpeaker` is false was changed from `'self'` to `'other'`
(Hero), and the non-toggle fallback also flipped. However, the same logic in
`useDialogEditorCommands.ts:addActionToEnd` still defaults to `'other'` via the
`createAction` factory (which calls `getOppositeSpeaker` defaulting to `'other'`).
These two code paths should agree on the default speaker convention. Verify the factory
default in `actionTemplates.ts:34` (`speaker = 'other'`) is intentionally aligned.

### 9. Unused `isProjectMode` prop

**File:** `dialogTypes.ts:53`

`DialogDetailsEditorProps` declares `isProjectMode?: boolean` but it is never read in
`DialogDetailsEditor.tsx`. Dead code.

### 10. `ActionsList` custom memo comparator may swallow updates

**File:** `ActionsList.tsx:177-210`

The custom memo comparator checks action identity by ID (for dialog lines) or
`type:index` (for other actions). If an action's content changes but its type and index
don't, the comparator returns `true` (no re-render needed), relying on `ActionCard`'s
own memo to catch it. However, `ActionCard` receives `action` by value, and its memo
uses `shallowEqual`. If `ActionsList` short-circuits the re-render, `ActionCard` never
gets the updated prop at all.

The comment says "let ActionCard handle that" but `ActionCard` can't handle it if it
never receives the new props. This could cause stale action data to display after certain
edits.

**Recommendation:** When action references differ but identity matches, still return
`false` to allow the re-render to propagate to `ActionCard`.

---

## Minor Issues / Code Smells

### 11. Redundant `dialog &&` guards in `DialogDetailsEditor`

**File:** `DialogDetailsEditor.tsx:114,124`

`dialog` is checked twice in consecutive JSX blocks. Could be a single `{dialog && (...)}` wrapper.

### 12. `flattenActionPaths` called repeatedly without memoization

**File:** `DialogDetailsEditor.tsx:148`

```ts
getVisibleActionPaths={() => flattenActionPaths(currentFunction.actions || [])}
```

This creates a new closure + recomputes on every call. If called frequently (e.g., on
every Tab keypress), this is wasteful. Consider `useMemo` for the flattened paths.

### 13. Inconsistent function export style

Some files use `export default` with named `const` components, others use
`export function`. The hooks use `export function` (good), but components mix patterns.
Not a bug, but consistency aids readability.

### 14. `createAction` switch statement could be a lookup table

**File:** `actionFactory.ts:163-267`

The 24-case `switch` in `createAction` maps `ActionTypeId` to `ACTION_TEMPLATES[x]()`.
Since the template keys already match the type IDs, this could be:

```ts
const templateFn = ACTION_TEMPLATES[actionType];
if (!templateFn) throw new Error(`Unknown action type: ${actionType}`);
action = templateFn();
```

The special cases (`dialogLine`, `choice`) could be handled separately before the
general case. This would eliminate ~100 lines of boilerplate and ensure new template
additions are automatically picked up.

### 15. `generateActionId` uses `Date.now()` + `Math.random()`

**File:** `actionFactory.ts:26`

```ts
return `action_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
```

This is technically fine for a single-user desktop app, but `crypto.randomUUID()` is
available in Electron and is both simpler and more collision-resistant. Also,
`String.prototype.substr` is deprecated in favor of `substring`.

### 16. Type casting with `as` in renderers

**Files:** All renderer files (e.g., `DialogLineRenderer.tsx:17`, `ChoiceRenderer.tsx:28`)

Every renderer casts `action as SpecificActionType`. This is an `as` cast that bypasses
the type checker. Since the renderers are selected via `getRendererForAction`, the cast
is "safe" in practice, but a generic renderer pattern could enforce this at the type level:

```ts
interface TypedRendererProps<T extends DialogAction> extends Omit<BaseActionRendererProps, 'action'> {
  action: T;
}
```

---

## Architecture Observations (Positive)

- **Hook decomposition** is clean: UI state, commands, action management, and focus
  navigation are well-separated concerns.
- **Action renderer registry** pattern is extensible and avoids a massive switch in the
  render path.
- **Progressive rendering** in `ActionsList` is a smart optimization for large dialog
  trees.
- **Debounced updates** in `ActionCard` prevent excessive parent re-renders during typing.
- **Focus management** with pending requests handles the async nature of React rendering well.
- **Nested action path system** (using `ActionPath = Array<number | 'then' | 'else'>`) is
  an elegant representation for tree-structured conditional branches.
- **Zustand + Immer** is a good choice for this domain -- the immutable updates are clean
  and the store interface is well-typed.

---

## Recommended Priority

| Priority | Issue | Effort | Status |
|----------|-------|--------|--------|
| High | #7b Escape key deletes any action unconditionally | Low | FIXED |
| High | #1 Remove `any` types from factories/utils | Medium | FIXED |
| High | #2 Use `type` discriminant in `getActionType` | Low | FIXED |
| High | #10 Fix `ActionsList` memo comparator | Low | FIXED |
| Medium | #3 Deduplicate action menu items | Low | FIXED |
| Medium | #4 Fix unmount flush race condition | Medium | FIXED |
| Medium | #5 Replace `JSON.stringify` with `actionPathToKey` | Low | FIXED |
| Medium | #7 Replace `alert()` with inline error | Low | FIXED |
| Medium | #8b Verify default speaker consistency | Low | VERIFIED |
| Low | #6 Replace `setTimeout` with proper deferred focus | Medium | FIXED |
| Low | #14 Simplify `createAction` switch to lookup | Low | FIXED |
| Low | #9 Remove unused `isProjectMode` prop | Low | FIXED |
| Low | #11 Combine redundant `dialog &&` guards | Low | FIXED |
| Low | #12 Memoize `flattenActionPaths` | Low | FIXED |
| Low | #15 Use `crypto.randomUUID()` for action IDs | Low | FIXED |
| Low | #8 Shallow memo on nested actions | Low | N/A (observation) |
| Low | #13 Inconsistent export style | Low | SKIPPED (style) |
| Low | #16 Type casting with `as` in renderers | Low | SKIPPED (invasive) |

---

## Fix Log

### #7b - Escape key: opens delete confirmation dialog
**Files:** `ActionCard.tsx`, `common/DeleteConfirmDialog.tsx` (new)
Escape now opens a confirmation dialog ("Are you sure you want to delete this action?").
The confirm button is auto-focused so pressing Enter immediately confirms deletion.
Cancel returns focus to the action's main field. The `DeleteConfirmDialog` component is
reusable for any future delete confirmation needs.

### #1 - Removed `any` types from `dialogUtils.ts` and `actionFactory.ts`
**Files:** `dialogUtils.ts`, `actionFactory.ts`
- `createEmptyFunction` now returns `DialogFunction` (also fixed `returnType: 'void'`
  to `'VOID'` to match the union type).
- `generateUniqueChoiceFunctionName` now accepts `SemanticModel` instead of `any`.
- `validateChoiceFunctionName` now accepts `SemanticModel` instead of `any`.
- `createAction` now returns `DialogAction` instead of `any`.
- `createActionAfterIndex` now returns `DialogAction` instead of `any`.
- `ActionCreationContext` fields now use `DialogAction[]` and `SemanticModel` instead of `any`.
- `chooseSpeakerToken` `actions` parameter now uses `DialogAction[]`.

### #2 - `getActionType` rewritten to use `type` discriminant
**File:** `actionTypes.ts`
Replaced the fragile property-sniffing chain with a `TYPE_TO_ID` lookup map keyed on the
`type` discriminant field. Falls back to property-sniffing only for legacy actions that
lack a `type` field, and finally to `'customAction'`.

### #10 - `ActionsList` memo comparator: allow re-render on changed action references
**File:** `ActionsList.tsx`
When action references differ (even if identity matches), the comparator now returns
`false` so the updated action propagates to `ActionCard`.

### #3 - Deduplicated action menu items in `ConditionalActionRenderer`
**File:** `ConditionalActionRenderer.tsx`
Removed the hardcoded `ACTION_MENU_ITEMS` array and local `<Menu>` rendering. Replaced
with the shared `ActionTypeMenu` searchable popover component already used by `ActionCard`.
This ensures a single source of truth for action type labels and menu items.

### #4 - Fixed unmount flush race condition in `ActionCard`
**File:** `ActionCard.tsx`
Added an `actionRef` that tracks the last parent-synced action value. The unmount cleanup
now compares `localActionRef.current` against `actionRef.current` using `shallowEqual`
and only flushes if they differ. This prevents stale writes during drag-and-drop reorder
when the component unmounts and remounts at a new index.

### #5 - Replaced `JSON.stringify` path comparisons with `actionPathToKey`
**File:** `useActionManagement.ts`
Replaced 4 occurrences of `JSON.stringify(candidate) === JSON.stringify(path)` with
`actionPathToKey(candidate) === actionPathToKey(path)`. The `actionPathToKey` function
uses a simple `join('.')` which is faster and already existed for this purpose.

### #7 - Replaced `alert()` with inline error state in `ChoiceRenderer`
**File:** `ChoiceRenderer.tsx`
Replaced the blocking `alert(validationError)` with a `functionNameError` local state
that displays as `helperText` on the Function TextField with `error` styling. The error
clears on focus or when the user starts typing a new value.

### #8b - Default speaker consistency verified
**Files:** `actionTemplates.ts`, `actionFactory.ts`, `useActionManagement.ts`, `useDialogEditorCommands.ts`
Verified all code paths default to `'other'` (Hero speaks first):
- `actionTemplates.ts:34`: default parameter `speaker = 'other'` ✓
- `actionFactory.ts:169`: fallback when no current action is `'other'` ✓
- `useActionManagement.ts:188`: non-dialog-line fallback is `'other'` ✓
- `useDialogEditorCommands.ts:83-86`: `createAction` with no `currentAction` → `'other'` ✓

### #6 - Replaced `setTimeout` with direct `focusAction` calls
**Files:** `useActionManagement.ts`, `useDialogEditorCommands.ts`
Removed all `setTimeout(() => focusAction(...), 0)` wrappers. The `useFocusNavigation`
hook already handles deferred focus via `pendingFocusRequests` — if the target element
isn't registered yet (because React hasn't rendered the new component), `focusAction`
queues the request and `registerActionRef` applies it on mount.

### #9 - Removed unused `isProjectMode` prop
**Files:** `dialogTypes.ts`, `EditorPane.tsx`, `ThreeColumnLayout.tsx`
Removed `isProjectMode` from `DialogDetailsEditorProps` (never read in `DialogDetailsEditor`).
Also removed from `EditorPaneProps` and the caller in `ThreeColumnLayout` since it was only
passed through to `DialogDetailsEditor`.

### #11 - Combined redundant `dialog &&` guards
**File:** `DialogDetailsEditor.tsx`
Merged two consecutive `{dialog && (...)}` blocks into a single `{dialog && (<>...</>)}`.

### #12 - Memoized `flattenActionPaths`
**File:** `DialogDetailsEditor.tsx`
Replaced inline `() => flattenActionPaths(...)` callback and duplicate `flattenActionPaths`
call in `useEffect` with a single `useMemo` that recomputes only when `currentFunction.actions`
changes. The memoized value is passed to both `trimRefs` and `getVisibleActionPaths`.

### #14 - Simplified `createAction` switch to lookup
**File:** `actionFactory.ts`
Replaced the 24-case `switch` with a template lookup: `ACTION_TEMPLATES[actionType]()`.
Special cases (`dialogLine` needing speaker toggle, `choice` needing `dialogRef`) are
handled explicitly before the general lookup. Reduces ~100 lines to ~10 and ensures
new template additions are automatically picked up.

### #15 - Replaced `Date.now()` + `Math.random()` with `crypto.randomUUID()`
**File:** `actionFactory.ts`
`generateActionId()` now uses `crypto.randomUUID()` which is simpler, more
collision-resistant, and available in Electron's renderer process.
