## 2025-05-23 - [O(N^2) Loop in Semantic Analysis]
**Learning:** Found a quadratic lookup in `findDialogForFunction` where for every function call, it iterated over all dialogs to check property links. This pattern is common when linking two entities where the link is defined on one side but queried from the other.
**Action:** Always look for inverse relationship lookups in visitor patterns. Use a Map to cache the relationship during the pass where the link is established (e.g., assignment) to allow O(1) lookup in the other direction.
