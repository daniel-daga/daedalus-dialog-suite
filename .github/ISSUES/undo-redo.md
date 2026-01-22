# Feature: Undo/Redo support for dialog edits

## Summary
Currently there is no history management for dialog edits. Users can't undo changes they make to dialogs.

## Problem
When users accidentally delete an action, modify text incorrectly, or make any unwanted change, there's no way to revert it without manually re-entering the data or reloading the file (losing all changes).

## Proposed Solution
Implement an undo/redo system with the following capabilities:

- Track changes to dialog actions (add, delete, modify, reorder)
- Track changes to dialog properties
- Keyboard shortcuts: `Ctrl+Z` for undo, `Ctrl+Shift+Z` or `Ctrl+Y` for redo
- Visual indicator showing undo/redo availability
- Consider using a library like `zustand/middleware` with `temporal` or implementing a custom history stack

## Implementation Notes
- Could use the Command pattern to encapsulate changes
- History should be per-file to avoid confusion when switching between files
- Consider a reasonable history limit (e.g., 50-100 actions) to prevent memory issues

## Acceptance Criteria
- [ ] Users can undo the last change with Ctrl+Z
- [ ] Users can redo an undone change with Ctrl+Shift+Z
- [ ] Undo/redo buttons visible in the UI
- [ ] History is maintained per-file
- [ ] History is cleared when file is saved or closed
