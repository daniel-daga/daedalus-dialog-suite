## 2024-05-22 - Optimizing Large Lists with Global State
**Learning:** When a large list depends on a global Set (e.g. `expandedChoices`), updating that Set triggers a re-render of ALL list items if they receive the Set as a prop.
**Action:** Extract the list item to a memoized component. In the custom comparison function, check if the item is collapsed. If it is collapsed, IGNORE changes to the global Set, as they don't affect the visual output of that item.
