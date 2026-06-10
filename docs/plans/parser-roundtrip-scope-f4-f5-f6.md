# Plan: Fix F4/F5/F6 — Roundtrip Scope Gaps (parser-review-fixes.md)

Source findings: `docs/plans/parser-review-fixes.md` (P1 — Roundtrip scope gaps).
Workspace: `daedalus-parser/` (plus a small coordinated type change in `daedalus-dialog-editor/`).

## Scope decision (shared by F4–F6)

The review deferred these behind one decision: *model these constructs, or make
parse/codegen fail loudly when they are present*. **Decision: model them.**
Rejecting would regress editor workflows on real mod files (helper functions with
parameters, `LOG_Constants`-style files), which the review itself flags as the risk.

Fidelity strategy, per construct:

- **Fully model** what codegen must be able to re-emit canonically and the editor may
  edit: function parameters (F5), simple `const`/`var` globals (F6).
- **Raw-source preservation** for constructs whose internals are out of editing scope:
  local variable declarations in bodies (F4, via the existing raw `Action` class) and
  non-dialog instance bodies / const arrays (F6, via a new `sourceText` field). This
  keeps roundtrip exact without speculative modeling.

Explicit non-goals: `class_declaration` / `prototype_declaration` remain unmodeled and
unemitted (they are not handled by `declaration-visitor.ts` today). If needed later, the
same `sourceText` mechanism applies. Local `var` semantics (scoping, shadowing) are not
modeled — only textual preservation.

## Current state (verified against source)

- `grammar.js` already parses `parameter_list` on `function_declaration` (line 41) and
  top-level `variable_declaration`; `_statement` (line 129) lacks `variable_declaration`,
  so local `var int x;` parses as bare identifier `expression_statement`s and is dropped.
- `DialogFunction` (`src/semantic/semantic-model.ts:662`) has no parameter list;
  `generateFunction` (`src/codegen/generator.ts:370`) hardcodes `()`.
- `declarationOrder` records only `'dialog' | 'function'`
  (`declaration-visitor.ts:72,93`; type at `semantic-model.ts:798`), and
  `generateByDeclarationOrder` emits only those, so globals parsed into
  `constants`/`variables`/`instances` never reach the output.
- `GlobalConstant` stores a parsed scalar `value` only (no array initializers, no array
  size); `GlobalInstance` stores no body — neither can be canonically re-emitted today.

## Step 1 — F4: Local `var` declarations in function bodies

**Failing tests first** (`test/parser.test.js` grammar acceptance,
`test/linking-visitor.test.js` + `test/semantic-code-generator.integration.test.js`
roundtrip):

1. `func void Foo() { var int x; x = 5; }` parses without ERROR nodes and regenerates
   with the `var int x;` line intact (exact text, original keyword/type casing).
2. Local declaration nested in an `if` block roundtrips.
3. Local declaration inside a **condition** function triggers raw-mode preservation
   (body kept verbatim), not silent loss.
4. Guard test: `var int x;` must NOT produce spurious actions from its child nodes
   (e.g. no `processFunctionCall` firing on an initializer expression).

**Implementation:**

1. `grammar.js`: add `$.variable_declaration` to the `_statement` choice (line 129).
   Run `npm run build` to regenerate the parser. Watch for new LR conflicts with
   `expression_statement` (identifier already has `prec(-1)`, so the `var`/`const`
   keyword token should win; verify with the full test suite + corpus smoke test).
2. `linking-visitor.ts` — handle the new statement type at every dispatch point:
   - `shouldSkipChildren`: for a non-condition function, on `variable_declaration`
     record `new Action(node.text.trim())` (the existing raw-text action, already in
     `ACTION_DISCRIMINATOR` — zero serialization changes) and return `true` so children
     are not traversed. For a condition function, call `triggerConditionRawMode(node)`
     (a local declaration is not representable as conditions).
   - `parseActionStatementNode` (line 720, used for `if` blocks): return
     `new Action(node.text.trim())` for `variable_declaration` so a surrounding
     `ConditionalAction` still parses structurally instead of falling back to raw text.
3. Alternative considered: a dedicated `LocalVariableDeclaration` action class. Deferred —
   raw `Action` preserves the text exactly, and nothing in the editor needs structured
   local-variable data today. Revisit only if the editor grows local-variable UI.

## Step 2 — F5: Function parameters

**Failing tests first** (`test/semantic-code-generator.unit.test.js` emission,
integration roundtrip, `test/semantic-serialization.test.js` JSON survival):

1. `func void Baz(var int n) { ... }` roundtrips with the parameter list intact,
   preserving keyword/type casing (`VAR Int n` stays `VAR Int n`).
2. Multiple parameters: `func int Calc(var int a, var string b)`.
3. Parameterless functions still emit `()` (no regression across existing 165 tests).
4. Serialization: `parameters` survives `JSON.stringify` → `deserializeSemanticModel`.

**Implementation:**

1. `semantic-model.ts`: add
   `export interface FunctionParameter { keyword?: string; type: string; name: string }`
   and `public parameters?: FunctionParameter[]` on `DialogFunction`. Plain objects —
   `plainToInstance` copies them; no discriminator work.
2. `declaration-visitor.ts` (`function_declaration` branch, line 59): read
   `node.childForFieldName('parameters')`, collect `parameter` named children, store
   raw `keyword`/`type`/`name` text (the parameter keyword has no field name in the
   grammar — extract positionally or from the first child token).
3. `generator.ts` `generateFunction` (line 370): emit
   `(${parameters.map(p => [p.keyword, p.type, p.name].filter(Boolean).join(' ')).join(', ')})`,
   empty list → `()` as today.
4. Docs: update `API.md` (`DialogFunction` shape) and the parser `README.md` if it shows
   the shape. `CLAUDE.md`'s `SemanticModel` snippet is unaffected (it doesn't expand
   `DialogFunction`).
5. Editor: check `daedalus-dialog-editor/src/shared/types.ts` for a mirrored
   `DialogFunction` type; the field is additive and optional, so typecheck should pass —
   verify with `npm run typecheck:renderer` + `npm run build:main`.

Note: dialog `condition`/`information` functions are zero-arg by convention; parameters
appear on helper functions only. Linking and cross-references key on names and are
unaffected.

## Step 3 — F6: Emit globals (constants, variables, non-dialog instances)

**Failing tests first** (`test/semantic-global-symbols.test.js` model + order,
`test/semantic-code-generator.integration.test.js` roundtrip,
`test/semantic-serialization.test.js`):

1. A file with `const int MAX = 5;` between two functions roundtrips with the constant
   present **in its original position**.
2. `var string s;`, a const array (`const string TXT[2] = { "a", "b" };`), and a
   non-dialog instance (`instance ItFo_Apple(C_Item) { ... };`) roundtrip byte-faithfully
   via `sourceText`.
3. A leading comment above a global is preserved.
4. Manually constructed model (no `sourceText`): `GlobalConstant`/`GlobalVariable` emit
   canonical form (`const int MAX = 5;` / `var string s;`); `GlobalInstance` without
   `sourceText` emits `instance Name(Parent) {};`.
5. Serialization: `declarationOrder` with new entry types and `sourceText` survive the
   JSON roundtrip.

**Implementation:**

1. `semantic-model.ts`:
   - Widen `declarationOrder` to
     `Array<{ type: 'dialog' | 'function' | 'constant' | 'variable' | 'instance'; name: string }>`
     (line 798).
   - Add `sourceText?: string` and `leadingComments?: string[]` to `GlobalConstant`,
     `GlobalVariable`, `GlobalInstance`.
2. `declaration-visitor.ts`:
   - `createGlobalSymbol`: set `sourceText = node.text`,
     `leadingComments = [...this.pendingLeadingComments]`, and push
     `{ type: 'constant' | 'variable', name }` onto `declarationOrder`.
   - Non-dialog `instance_declaration` branch: same for `sourceText`/`leadingComments`
     and push `{ type: 'instance', name }`.
3. `generator.ts`:
   - `generateByDeclarationOrder`: handle the three new entry types — render
     `leadingComments`, then `sourceText` when present (and `preserveSourceStyle` is on),
     else the canonical template above; track emitted names so the legacy fallback loops
     don't double-emit, and extend those fallback loops to sweep unemitted globals.
   - The no-`declarationOrder` path in `generateSemanticModel`: emit constants and
     variables before dialogs, non-dialog instances after functions (conventional file
     layout for hand-built models).
4. Editor coordinated change (same PR — workspace dependency):
   - `src/shared/types.ts:407`: widen the mirrored `declarationOrder` union identically.
   - `src/renderer/store/fileStore.ts:496–506` (dialog delete) and `630–645`
     (dialog move/rename): both match only dialog/function entries by name; confirm new
     entry types pass through untouched and add a Jest case if either is modified.
5. Docs: update the `SemanticModel` snippet in root `CLAUDE.md` (`declarationOrder`
   element type) and `API.md`.

## Validation gates

Per step (TDD): failing test → minimal implementation → green. Then before completion:

1. `daedalus-parser`: `npm run build` (grammar regen, step 1 only), `npm test`,
   `npm run lint`, `npm run typecheck`.
2. Corpus: extend the fixtures used by `test/roundtrip-corpus-smoke.test.js` with a file
   containing locals + parameters + globals; run `npm run test:roundtrip-corpus` against
   a real mod corpus if one is available locally (CI corpus job is disabled).
3. `daedalus-dialog-editor`: `npm run typecheck:renderer`, `npm run build:main`,
   `npm test`. No new UI workflow is introduced (parser-level fidelity fix), so Jest
   coverage suffices per the workspace rules — no new Playwright spec.

## Sequencing and risk

Three commits in order F4 → F5 → F6, each independently green. F4 goes first because the
grammar change reshapes parse trees and any conflict fallout should surface before the
model work builds on it.

| Risk | Mitigation |
|---|---|
| Grammar conflict from `variable_declaration` in `_statement` | Full suite + corpus smoke after `npm run build`; identifier `prec(-1)` already favors the keyword token |
| Initializer expressions creating spurious actions via recursion | Guard test in step 1; `shouldSkipChildren` returns `true` for the new node type |
| `declarationOrder` union ripples into editor IPC types | Coordinated additive change in the same PR; both typechecks gate completion |
| Style drift on regenerated files (blank lines around globals) | Byte-faithful roundtrip assertions in integration tests; corpus run |

## Completion

When all three land: mark F4/F5/F6 ✅ in `docs/plans/parser-review-fixes.md`, extract the
"safe roundtrip scope" boundary (what is modeled vs raw-preserved vs unsupported) into
`docs/reference/`, and delete this plan file.
