## 2025-05-23 - [O(N^2) Loop in Semantic Analysis]
**Learning:** Found a quadratic lookup in `findDialogForFunction` where for every function call, it iterated over all dialogs to check property links. This pattern is common when linking two entities where the link is defined on one side but queried from the other.
**Action:** Always look for inverse relationship lookups in visitor patterns. Use a Map to cache the relationship during the pass where the link is established (e.g., assignment) to allow O(1) lookup in the other direction.

## 2025-05-23 - [Tree Traversal Optimization in Visitor]
**Learning:** Generic recursive tree traversal (visiting all children) is safe but wasteful when the grammar enforces strict structure (e.g., declarations cannot nest). Pruning the traversal at specific nodes (like `function_declaration`) during passes that only care about top-level structure provided a 3x speedup. Similarly, `checkForSyntaxErrors` can skip entire subtrees if `node.hasError` is false, yielding a 1000x speedup for valid code.
**Action:** When writing AST visitors, always check if `node.hasError` can prune error checks, and if grammar rules allow pruning traversal for specific passes.
