## 2026-02-01 - Monolithic State vs React Memoization
**Learning:** The `semanticModel` object is a large monolithic state that is recreated on every edit. Passing this entire object to list items like `DialogTreeItem` defeats `React.memo` unless a custom comparator is used to check only relevant sub-properties. Furthermore, callbacks like `buildFunctionTree` that depend on the entire model will break memoization of child components.
**Action:** When working with `semanticModel`, extract stable sub-properties (like `functions` map) for dependencies, and use granular checks in `React.memo` comparators to avoid O(N) re-renders on single-item updates.

## 2026-02-04 - Testing React.memo with Mocks
**Learning:** When testing `React.memo` components that consume hooks (like `useSearchStore`), simple mock functions returning values won't trigger re-renders when "state" changes in the test. You must force a re-render (e.g., by changing a prop) to verify the component updates its view based on the new hook value.
**Action:** When testing memoized components with mocked hooks, ensure the test explicitly triggers a re-render or the mock implements a subscription mechanism.
