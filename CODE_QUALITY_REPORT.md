# Code Quality & Maintainability Report

## Executive Summary

The `daedalus-dialog-editor` and `daedalus-parser` project demonstrates a solid architectural foundation with a clear separation of concerns between the parsing logic and the editor UI. The "Semantic Model" abstraction is a significant strength. However, the project shows signs of growing technical debt in state management, frontend performance, and type safety, which could hinder future development and maintenance.

## 1. Architecture & Maintainability

### Strengths
*   **Monorepo Structure:** Clear separation between `daedalus-parser` (core logic) and `daedalus-dialog-editor` (UI).
*   **Semantic Abstraction:** The parser exposes a high-level `SemanticModel` rather than a raw AST, insulating the editor from grammar changes.
*   **Service Isolation:** File I/O and parsing are isolated in the main process, exposed via `editorAPI`.

### Weaknesses
*   **Coupling in Parser:** `SemanticModelBuilderVisitor` is responsible for parsing, linking, *and* analyzing logic. As the language support grows, this file will become unmaintainable.
*   **Manual Serialization:** `semantic-model.ts` relies on repetitive `fromJSON` and `toJSON` methods. This boilerplate is error-prone and hard to maintain as the model evolves.
*   **Tangled UI Logic:** `QuestGraph.tsx` and `QuestEditor.tsx` mix UI presentation with complex data transformation logic (`questGraphUtils.tsx`).

## 2. Code Quality & Style

### Type Safety
*   **Excessive `any` Usage:** `questGraphUtils.tsx` frequently casts to `any` (e.g., `(action as any).variableName`) to access properties of union types. This defeats TypeScript's safety guarantees and risks runtime errors if the model structure changes.
*   **Duck Typing:** `deserializeAction` in `semantic-model.ts` uses property existence checks (e.g., `if ('speaker' in json)`) to determine types. This is fragile; a discriminated union with a `type` field (e.g., `{ type: 'DialogLine', ... }`) would be robust.

### Complexity
*   **Graph Layout Logic:** `questGraphUtils.tsx` contains a custom, complex layout algorithm with "magic numbers" (e.g., `LEVEL_WIDTH = 350`). This logic is hard to test and debug.
*   **State Updates:** `editorStore.ts` performs deep, manual immutability updates (e.g., `{ ...state, semanticModel: { ...model, dialogs: ... } }`). This pattern is verbose and easy to get wrong.

## 3. Performance

### Issues
*   **Frequent Graph Rebuilds:** [Fixed] `QuestFlow.tsx` triggers `buildQuestGraph` in a `useEffect` whenever `semanticModel` changes. Since the model updates on every keystroke/save, this is a significant performance bottleneck for large graphs.
*   **Main Thread Blocking:** [Fixed] As noted in `CODE_REVIEW.md`, parsing happens synchronously on the main thread.
*   **State Granularity:** The `editorStore` triggers updates for the entire `openFiles` map even for small changes, potentially causing unnecessary re-renders in components listening to specific file states.

## 4. Recommendations

### Priority: High (Immediate Value)
1.  **Refactor State Management:** [Done] Adopt `immer` in `editorStore.ts` to simplify state updates and ensure immutability without boilerplate.
2.  **Fix Type Safety:** [Done] Introduce a `type` or `kind` discriminator field to all `DialogAction` and `DialogCondition` classes. Remove `any` casts in `questGraphUtils.tsx` by using proper type guards.

### Priority: Medium (Sustainability)
1.  **Optimize Graph Rendering:** [Done] Memoize the result of `buildQuestGraph` or debounce the `semanticModel` updates passed to `QuestFlow`.
2.  **Decouple Serialization:** [Done] Use a library like `zod` or `class-transformer` for serialization/deserialization to remove manual boilerplate in `semantic-model.ts`.
3.  **Split Visitor Logic:** [Done] Refactor `SemanticModelBuilderVisitor` into smaller, focused visitors (e.g., `DeclarationVisitor`, `ReferenceLinkingVisitor`).

### Priority: Low (Long-term)
1.  **Worker Threads:** [Done] Move parsing logic to a Worker Thread to unblock the main process.
2.  **Standardize Layout:** [Done] Consider using a library like `dagre` or `elkjs` for graph layout instead of the custom implementation in `questGraphUtils.tsx`.

## Conclusion

The project is in a good state but is at a tipping point. investing in type safety and state management refactoring now will prevent significant pain as the complexity of the supported Daedalus features grows.
