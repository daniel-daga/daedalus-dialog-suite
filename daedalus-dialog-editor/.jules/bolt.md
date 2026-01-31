## 2024-05-22 - Optimizing Large Lists with Global State
**Learning:** When a large list depends on a global Set (e.g. `expandedChoices`), updating that Set triggers a re-render of ALL list items if they receive the Set as a prop.
**Action:** Extract the list item to a memoized component. In the custom comparison function, check if the item is collapsed. If it is collapsed, IGNORE changes to the global Set, as they don't affect the visual output of that item.

## 2024-05-24 - Optimizing Recursive Tree Rendering
**Learning:** In recursive tree components, defining the recursive render function inside the parent component prevents memoization of child nodes. When the parent re-renders (e.g., due to a state change like `expandedChoices`), the entire subtree is rebuilt.
**Action:** Extract the recursive node into a separate `React.memo` component. Implement a custom comparison function that checks `isExpanded` state derived from the global Set. If the node is collapsed, return `true` to skip re-rendering even if the global Set reference changed, pruning the re-render tree significantly.
