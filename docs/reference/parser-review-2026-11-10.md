# Parser audit — 2026-11-10

Reviewed commit `ae14c39`. One pass over the whole of `daedalus-parser/` — code,
architecture, security, maintainability, performance — rather than a slice. The
seven slice reviews of 2026-10-31/11-01 covered fidelity defect by defect and
their findings are fixed; this pass looks at what they did not: behaviour on
hostile or malformed input, cost, and the shape of the code.

Everything marked *measured* was run against `dist/` built from this commit, on
the cloud container this audit ran in. Absolute times are that machine's; the
ratios are the finding.

## Verdict

No must-fix. The component is in good condition for what the editor asks of it:
`lint` and `typecheck` are clean, `pnpm audit --prod` reports nothing in the
parser's dependency tree, the library code has no `eval`, no network and no
file writes, every name-keyed dictionary is null-prototype, and the generator
refuses an errored model. What is left is robustness at the edges, a linking
pass that costs far more than the parse it follows, and an architecture whose
upkeep grows with every fidelity fix.

## Should fix

1. **Deep nesting throws `RangeError` out of `parseSemanticModel`**
   (`src/semantic/visitors/linking-visitor.ts:132,636`, `parsers/ast-constants.ts:3`,
   `src/core/parser.js:262`)
   - **What this is:** the visitors, `recordCallSitesInSubtree`, `hasComment`
     and `collectErrors` recurse once per tree level on the JS stack.
   - **Problem:** *measured* — the model build throws `Maximum call stack size
     exceeded` at 1,842 nested `if`s, a 6,251-term `1+1+…` chain, 7,837 nested
     parentheses or a 6,232-link `else if` chain. Tree-sitter itself parses all
     of them without complaint, so the file is valid and the failure is ours.
     Nothing catches it in the library; the editor's worker turns it into a
     generic parse failure with no line.
   - **Fix:** catch it at the one entry (`parseSemanticModel`) and report it as
     a model error with `hasErrors: true`, so the file opens read-only with a
     reason. Making the walks iterative is the larger alternative and not worth
     it for input nobody writes by hand.
   - **If we skip it:** a generated or adversarial `.d` file fails with a
     message that names no cause. Low likelihood, cheap to close.

2. **The error path walks the whole tree, and is quadratic on a flat `ERROR` node**
   (`src/core/parser.js:59-62,262-290`)
   - **What this is:** `parse()` calls `collectErrors` whenever the tree has an
     error. It visits every node through `node.child(i)` with no `hasError`
     pruning, and `parseSemanticModel` then runs `ErrorVisitor` — which does
     prune — over the same tree and discards the first list.
   - **Problem:** *measured* — a 1.5 MB file with one syntax error spends 2.0 s
     in work whose result is thrown away (the pruned walk is instant). Worse,
     `child(i)` is linear in `i` on an `ERROR` node with flat children:
     40,000 unclosed `(` take 8.7 s, 200,000 (a 200 KB file) take 204 s, against
     21 ms for the parse itself. That is past the worker's 30 s timeout
     (`docs/architecture/worker-reliability.md`), so one such file costs a
     worker restart.
   - **Fix:** prune on `hasError` and walk with a cursor, as `ErrorVisitor`
     already does — or have `parse()` delegate to it and delete the duplicate.
     `validate()` also collects a second time after `parse()` already has.
   - **If we skip it:** every file with a syntax error pays a full extra tree
     walk, and a malformed file can hold a worker for its whole timeout.

3. **`applyNpcEdits` does not check that what it returns is still one instance**
   (`src/semantic/npc-definition.ts:183-273`)
   - **What this is:** `field`, `index`, `value`, call `name` and `args` are
     spliced into the source as given.
   - **Problem:** *measured* — `{op:'set', field:'id', value:'1;\n};\nfunc void
     pwn() {…};\ninstance Y(C_NPC) {\n\tid = 2'}` returns three well-formed
     declarations, so the save's syntax check passes and they are written.
     `value: ''` returns `guild = ;`, `value: '"a" // c'` returns a line whose
     `;` is inside the comment, and `args: ['1); Bar(2']` returns two calls.
     The 2026-11-01 NPC review noted in passing that "a syntactically valid but
     wrong edit" reaches disk. Today the only caller is the user's own form, so
     this is a self-inflicted wound; it stops being one when
     `docs/plans/mcp-server.md` gives another client the same call.
   - **Fix:** re-extract the result before returning it and require one
     instance, the same name and parent, and the statement count the batch
     implies. One extra parse of one instance.
   - **If we skip it:** the writer's contract — "an edit replaces the range of
     the one statement it touches" — holds only for well-behaved values.

4. **The linking pass costs about seventeen times the parse**
    (`src/semantic/visitors/linking-visitor.ts`)
    - **Landed (#541):** `a1709ae` cut the projection walk below calls and
      assignments and read the cursor before materialising a node; then the
      call-site sweep and the projection became one walk — a skipped subtree is
      indexed and never projected — and a call's arguments are parsed once and
      handed to the action parser. *Measured* with
      `scripts/benchmark-model.js` on a synthetic 0.96 MB, 20-file dialog
      corpus: pass 2 1,339 → 1,158 ms (−13%), model build 11.8× → 10.7× the
      parse. Model JSON and generated output are byte-identical to the previous
      build across the fixtures and that corpus.
    - **Landed (#541):** the walk now materialises a node only where it projects
      or indexes one — a declaration, a skipped statement, a comment, an
      assignment or a call; every other node is read from the cursor. The call
      sweep is one native `descendantsOfType('call_expression')` query, with a
      range stack keeping the #538 nesting bound, instead of a JS walk over the
      whole subtree. `hasComment` and `getCallStatementSuffix` check the text for
      a comment marker before walking, instance bodies are projected in one
      pass, and operator reads use the cursor. *Measured on the MDK tree*
      (`node scripts/benchmark-model.js --root ../mdk/Content/Story/Dialoge
      --repeat 3`; 355 parseable files, 5.97 MB): pass 2 6,300 → 4,566 ms
      (−27%), model build 5.0× → 3.9× the parse; pass 1 is unchanged. Model JSON
      is byte-identical across the fixtures and that corpus (374 models
      compared).
    - **What remains:** the pass is now roughly 15% `unmarshalNode` plus the
      `startIndex` / `childForFieldName` / `type` / `namedChildren` getters,
      spread across projection: every statement, call and argument the model
      keeps is still materialised once. Only a pass that reads the cursor and
      builds the projections without node objects would move it much further,
      and that is a rewrite whose remaining gain no corpus has justified.
    - **What this is:** pass 2 builds actions, conditions and call sites.
    - **Problem at audit time:** *measured* on 2.3 MB of dialog source: parse 114 ms, pass 1
      190 ms, pass 2 1,983 ms, generation 62 ms. A CPU profile puts roughly 60%
      of the run in tree-sitter's JS node marshalling (`unmarshalNode`, `get
      type`, `get namedChildren`, `childForFieldName`, `startIndex`) and 9% in
      GC. The pass materialises each function-body node more than once:
      `recordCallSitesInSubtree` sweeps the body with `namedChildren`,
      `analyzeNodeRecursively` then walks it again taking `cursor.currentNode` at
      every node, and `hasComment` / `getCallStatementSuffix` / `multiLineIndent`
      re-read subtrees per action. It is linear, so a 30 KB dialog file is
      ~25 ms and nobody notices; a project load is where it adds up.

5. **The serialized model is five to twelve times the source**
   (`src/semantic/semantic-model.ts`, `linking-visitor.ts:607-629`)
   - **What this is:** every call is stored three times — as an action, as a
     name in `calls`, and as a `callSites` entry with `raw`/`value`/`isString`
     per argument and four position numbers.
   - **Problem:** *measured* — a 12 KB dialog file is a 60 KB model; a 740 KB
     startup function is 8.9 MB, and `deserializeSemanticModel` takes 621 ms on
     it. The model crosses the worker boundary and IPC on every parse and every
     save.
   - **Landed (#541):** `callSites` stops at the renderer boundary
     (`daedalus-dialog-editor/src/main/utils/withoutCallSites.ts`). The three
     IPC paths that hand a model to the renderer — `parser:parseSource`,
     `project:parseDialogFile` in both its cached and parsed branches, and
     `project:indexFile` after the index is built from the full model — drop it
     from a one-level copy; the main process keeps the full model. *Measured:*
     models 39% smaller on the synthetic corpus, 18% on the fixtures, 34% on the
     MDK corpus (models there are 5.2× the source). `calls` stays: it is small
     and the Problems rules and quest detection read it in the renderer.
   - **Decision (#541):** `callSites` stays on the main-process model and in
     the worker→main payload. It is index data, but `indexFile` needs the whole
     project's routine layouts to turn a call into a routine site, so computing
     the index in the worker means a second pass over every file after those
     layouts exist. The cost the audit measured — size and hydration on every
     model the app holds — was paid at the renderer boundary, and that is where
     the sites now stop. Revisit if the worker gains a project-wide phase.

## Nice to have

6. **A `^` in a function name is compiled into a regex**
   (`src/semantic/visitors/declaration-visitor.ts:132,167`) —
   `new RegExp(\`${name}\\s+\\(\`)` treats the `^` the grammar allows in
   identifiers (#383) as an anchor, so `spaceBeforeParen` is always false for
   Ikarus's `_^`. *Measured:* `func MEMINT_HelperClass _^ (var int ptr)` comes
   back as `_^(var int ptr)`. Read the gap from the name node's `endIndex`
   instead of a regex over the first line.

7. **A syntax error's `text` is unbounded** (`error-visitor.ts:78`,
   `parser.js:274`) — a stray `"` at the top of a 2 MB file yields one error
   whose `text` is the whole file. Cap it; the position is what consumers use.

8. **One invalid raw action makes reference analysis throw for the whole model**
   (`src/semantic/cross-references.ts:71-80`) — `rawChoiceTargets` throws when a
   raw `Action` does not parse, so `collectReachableFunctions` throws for every
   dialog, while the generator emits the same text unchallenged. It also parses
   every raw action on every call, uncached. Only the no-`declarationOrder` and
   single-dialog generation paths reach it today. Skip the unparseable action
   instead of throwing.

9. **`CONDITION_CALLS[name]` is a plain object lookup**
   (`parsers/condition-parsers.ts:274`) — a call named `constructor` or
   `toString` resolves to an `Object.prototype` member and is rejected only
   because its `.arity` is `undefined`. Use a `Map` or `createNameRecord`.

10. **`DaedalusParser.parseSource` builds a new native parser per call**, and
    four modules each keep their own lazy singleton (`reference-expression`,
    `declaration-source`, `action-source`, `cross-references`). Harmless in
    cost (*measured:* 20 µs against 13 µs), but five parsers where one would do.

11. **`encodingConfidence` is the constant `100`** (`parser.js:90`) and
    `throughput` divides UTF-16 length by time and calls it bytes per second.
    Remove the first, rename or drop the second.

## Architecture and maintainability

**The save path regenerates; the fidelity work is the price.** A file is saved
by rebuilding it from the model, so every piece of the source the model does not
hold has needed its own baseline: `sourceHeader`, `sourceCall`,
`sourceAssignment`, `conditionSource`, `sourceBody`, `callIdentity`,
`propertyFormatting`, `propertyBlankLinesBefore`, `sameLineBefore`, and more —
`docs/architecture/parser-fidelity.md` is 756 lines of them, and byte fidelity
is still a reported, non-failing tier (`Wld_InsertNpc(a, "b")` comes back as
`Wld_InsertNpc (a, "b")` on an untouched file). `npc-definition.ts` took the
other road — patch the range of the statement that changed — and is 335 lines
with byte-exact output by construction. That is the direction worth choosing
for the next structural piece of work, starting with the unit where it is
cheapest: a function nobody edited is written back as its own source range.

**Adding an action touches four lists.** `parseSpecificAction`'s switch,
`ACTION_DISCRIMINATOR`, the `DialogAction` union and the legacy shape-sniffing
chain in `ensureActionType` each name every action, and the last one is ordered
by hand with a comment explaining why the order is fragile. Conditions got one
table in #439; actions have not. Whether typeless action JSON still exists
anywhere decides whether `ensureActionType`'s chain can simply go.

**The model module is not pure.** `semantic-model.ts` imports
`action-codegen.ts`, which imports `parsers/action-parsers.ts`, which imports
`semantic-model.ts` — a real import cycle that works because nothing is used at
module-evaluation time. And `semantic-model` → `reference-expression` →
`core/parser` means importing the model classes loads the native addon;
generation parses text too (`generateDeclarationHeader`, `generateActionCode`).
The editor only ever imports parser values in its main process, so this costs
nothing today, but the MCP plan and any renderer-side use would meet it.

**`semantic-model.ts` is 1,440 lines** holding the model classes, the
action/condition registries, hydration, legacy migration and `Dialog`'s live
`actions` view. Hydration is the natural piece to split out.

**Three copies of the identifier alphabet** — `grammar.js:322`,
`generator.ts:574` and `reference-expression.ts:22` (which omits `@^`).

**Typing.** `strict` is on, but `noImplicitAny` is off and
`semantic-model.ts` has 30 `any`s, nearly all in hydration — the one place
where untyped input enters. `class-transformer` (last released 2021) and
`reflect-metadata` are carried for two `@Type` decorators that the hand-written
`deserializeAction` then redoes.

**No coverage measurement.** There are roughly two lines of test per line of
source and the tests are specific, but nothing says which branches they miss.

## Coverage gaps worth a decision, not a fix

- Identifiers are ASCII plus Latin-1 letters (decided 2026-11-01). A name with
  a letter outside that — `ł`, `ż`, any Cyrillic — is a syntax error, so the
  file opens read-only. Probably right for real mods; recorded so it is a
  decision rather than a surprise.
- zParserExtender's `META`, `test` and `namespace` are carried verbatim (#392);
  its statement-level extensions inside a function body, `while` among them,
  are still syntax errors.

## Not checked

The MDK corpus (not present here), Windows behaviour, the editor's use of the
model beyond its import surface, and the native binding's own C++
(`bindings/node/binding.cc` is the tree-sitter template).
