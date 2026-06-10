# Parser Roundtrip Scope

What the `daedalus-parser` parse → semantic model → codegen pipeline preserves, and how.
Established with review fixes F4–F6 (see git history of `docs/plans/parser-review-fixes.md`).

## Fidelity tiers

| Construct | Representation | Re-emission |
|---|---|---|
| Dialog instances (`C_INFO`) | Fully modeled (`Dialog`, properties, formatting metadata) | Generated from the model |
| Functions, actions, conditions | Fully modeled (`DialogFunction`, action/condition classes) | Generated from the model |
| Function parameters | Modeled (`DialogFunction.parameters`: `{ keyword?, type, name }`, source casing kept) | Generated from the model |
| Global constants / variables | Modeled (`GlobalConstant`/`GlobalVariable`) **plus** verbatim `sourceText` | `sourceText` when present (only faithful form for const arrays); canonical template (`const int MAX = 5;`) otherwise |
| Non-dialog instances (`C_Item`, `C_NPC`, …) | Modeled shallowly (`GlobalInstance`: name, parent, displayName, dailyRoutine) **plus** verbatim `sourceText` | `sourceText` when present; `instance Name(Parent) {};` otherwise |
| Local `var` declarations in function bodies | Preserved textually as raw `Action` entries (raw condition mode in condition functions) | Verbatim |
| Unsupported statements | Preserved textually as raw `Action` entries | Verbatim |
| `class` / `prototype` declarations | **Not modeled, not emitted** — out of scope | Lost on regeneration |

## String semantics

Daedalus has **no string escape sequences** (ZenGin treats everything between the outer
quotes as raw text; an embedded `"` cannot be represented). The pipeline therefore never
escapes or unescapes string content: parsing strips only the outer quotes
(`normalizeArgumentText`), and codegen emits the stored text verbatim inside quotes.
Strings containing backslashes roundtrip byte-identically (review fix F9).

The impossibility of embedded quotes is enforced at the editor boundary: the editor's
`ValidationService` rejects models whose quoted-string fields (choice text, log-entry
text) contain `"` before any code is generated or saved.

## Error positions

Both error reporters — `DaedalusParser.validate()`/`parse()` and the semantic
`ErrorVisitor` — emit **1-based** `position.row`/`position.column` (review fix F11),
matching the human-readable message text and Monaco's marker coordinates.

## Ordering

`SemanticModel.declarationOrder` records every top-level declaration as
`{ type: 'dialog' | 'function' | 'constant' | 'variable' | 'instance', name }`, and
`generateSemanticModel` replays it, so globals stay in their source position between
functions and dialogs. Consecutive globals are emitted as one block (no blank lines
inserted between adjacent constants).

For models whose `declarationOrder` lacks entries (hand-built models, pre-existing
serialized models): constants and variables are emitted at the top of the file
(declare-before-use), instances at the end.

## Validation

The corpus smoke test (`test/roundtrip-corpus-smoke.test.js`) includes a fixture
covering globals, parameters and locals, and `npm run test:roundtrip-corpus -- --root <dir>`
validates structural drift and semantic idempotence against a real mod corpus.
