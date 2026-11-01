# Slice 1 of 7 — grammar and decoding (the text-to-AST edge), commit `3d92722`, 2026-11-01

**What this change does:** This is the edge where bytes become a syntax tree:
`grammar.js` (compiled into the committed `src/parser.c`), `src/core/parser.js`
(the `parse`/`parseFile`/`validate`/`extractDeclarations` wrapper that Electron's
forked parser child loads), and `src/core/source-encoding.js` (which decides
whether a file's bytes are UTF-8, Windows-1252 or Windows-1250). Everything the
other six slices do starts from the tree this layer hands them.

**Expected load stated:** one parse per file when a file is opened and again on
each save, plus a batch over a whole mod on project load — 890 files is the
Beppo corpus, 1,725 the MDK corpus — inside a forked child process in the
editor, so a native crash costs one child and not the app. Every finding below
was driven through the real built binding with `node -e`/throwaway scripts under
the approved temp dir. The tree-sitter grammar itself and the encoding detector
are what I reviewed; I did not run `npm run build` (it rewrites `src/parser.c`)
and did not read the 12k-line generated parser.

What holds: the four real `.d` files in `daedalus-parser/reference/` and all 12
corpus fixtures parse without errors. Error positions are 1-based and *identical*
between `DaedalusParser.validate()` and the semantic `ErrorVisitor` — including
the 2nd error in a file, CRLF input, and errors after non-ASCII text (all
re-checked: `1:11`, `2:11`, `2:15`). Column is a UTF-16 code-unit column (a tab
is one column, `ä` is one), which the fidelity doc leaves unstated but both
sides agree on. Recovery is good: after an error mid-file every later
declaration still parses (200 functions after an unterminated `{`), so a broken
file is still editable. `else if` is accepted by the grammar (`grammar.js:198`),
so issue #432 is a semantic-projection gap exactly as
`parser-review-2026-10-31-extraction.md` says — nothing to fix here. Issue #392's
zPE syntax is refused with a position and the declarations after the `META`
block still parse. #389 (`a ^ b` is an error, `a^b` is one name) and #393 (`@`
continues but never starts an identifier) behave as their tests claim.

**Must fix:**

1. **A missing `;` is invisible; the file validates and saves, and Gothic will refuse it**
   (`daedalus-parser/grammar.js:186-189`, and `:33`, `:59`, `:118`, `:131`)
   - **What this is:** `expression_statement` is `seq($._expression, optional(';'))`, and every top-level declaration ends with `optional(';')`.
   - **Problem:** `validate('func void f() {\n    Foo();\n    Bar()\n    Baz();\n};\n').isValid` is `true`, and so is `parse('func void f() {\n  Foo();\n}\n')` — a function whose body is fine but which is never closed with `};`. Both reference grammars require the terminator: DaedalusLanguageServer `statementBlock: ((statement Semi) | (ifBlockStatement Semi?))*` and `blockDef: (functionDef|…) Semi`. This is the editor's whole validation story: a typo it cannot see, on a file it will happily write back, that only fails when the game compiles it. A wrong accept is worse than a clean reject, and this is the wrong accept class the brief asks about. Nothing in `test/` asks for the loose form, so it is an accident, not a decision.
   - **Fix:** drop the two `optional(';')` — `expression_statement` becomes `seq($._expression, ';')` and the four declaration tails become `';'`. Rebuild `src/parser.c` (`npm run build`) and run the parser tests; expect tests that lean on the looseness only if any raw-`if` fixture omits a terminator, which the `if_statement` optionals at `:195`/`:199` already cover.
   - **If we skip it:** every file the modder types with a forgotten semicolon passes the editor's Problems panel and fails in Gothic, where the error is the engine's, not ours.

2. **A Polish/Czech Windows-1250 file whose letters are all "ordinary Western" is read as Windows-1252 and written back corrupted**
   (`daedalus-parser/src/core/source-encoding.js:38-63`)
   - **What this is:** the detector's only Central-European evidence is three bytes Windows-1252 leaves unassigned, or two distinct bytes from a 24-entry list.
   - **Problem:** `ł` (0xB3) is in neither list, and `ę` (0xEA) is not either, so `PrintScreen("Błędy i księga", -1);` encoded as Windows-1250 is detected as `windows-1252` and read as `B³êdy i ksiêga`. Nothing errors — the mojibake is inside a string literal, so it parses. That decoded text is what the editor shows, edits and writes back with `result.encoding`, so a save persists the corruption; and the corpus cannot catch it, because tier 1 compares the regenerated tokens with the *same* mis-decoded original (the fidelity doc already records that the MDK reads as 1252 for all but two files).
   - **Fix:** add `0xB3` to the tables and treat the nine bytes that Windows-1252 renders as punctuation — `0xA5 0xAA 0xAF 0xB3 0xB9 0xBA 0xBC 0xBE 0xBF` (`¥ ª ¯ ³ ¹ º ¼ ¾ ¿` against `Ą Ş Ż ł ą ş Ľ ľ ż`) — as decisive rather than needing corroboration. A file holding `³` where a word's letter should be is not Western text. One test in `test/encoding.test.js` with `Błędy` in Windows-1250 pins it.
   - **If we skip it:** Polish and Czech mods open with mangled strings and each save writes the mangling deeper, with no error anywhere to say so.

3. **A UTF-8 BOM followed by one legacy byte makes the whole file refuse to parse at 1:1, forever**
   (`daedalus-parser/src/core/source-encoding.js:59-63`, `daedalus-parser/src/core/parser.js:92-103`)
   - **What this is:** `parseFile` decodes the whole buffer, BOM included, with the detected encoding; the detector only returns `utf8` if the *entire* buffer is valid UTF-8.
   - **Problem:** a file saved as "UTF-8 with BOM" and then touched by a legacy editor (or with one character typed outside UTF-8) is not valid UTF-8, so it is decoded as Windows-1252 and its BOM becomes the three characters `ï»¿`. Measured: `parseFile` on `EF BB BF` + `var string s = "Müller";` (CP1252) reports two `syntax_error` at `1:1` with text `"ï»¿"`. The rest of the file decodes correctly, so the user sees a file with nothing visibly wrong on line 1 and an error they cannot remove; fixing it by hand re-encodes those three characters to the same three bytes. A plain UTF-8 BOM file is fine (tree-sitter skips a BOM at byte 0 only — a BOM anywhere later is an error too).
   - **Fix:** strip one leading UTF-8/UTF-16 BOM from the buffer before detection and decoding (`buffer.subarray(3)` / `subarray(2)`), remember that it was there so the save path can put it back, and detect on the remainder. Three lines in `parseFile`.
   - **If we skip it:** a BOM'd file that has drifted one byte out of UTF-8 is unopenable, and the error text names a character the modder cannot type.

**Should fix:**

4. **`extractDeclarations` lost the second and later names of a declaration list**
   (`daedalus-parser/src/core/parser.js:192-203`, list built by hand at `:151-225`)
   - **What this is:** a public API (and the `daedalus-parse --declarations` CLI) that reads the grammar's top-level node types and reports one entry each.
   - **Problem:** #383 added comma lists to the grammar and to the semantic model, but this function was not updated for them: `var int a, b;` returns only `a`, and `const int C = 1, D = 2;` only `C` (measured). `instance x, y(oCItem);` *is* handled, because #383 added a special case for its node type — which is the tell: this switch is a second, hand-kept copy of the grammar's `_declaration` choice (`grammar.js:16-23`), and the next node type added there will be silently dropped here too. The editor's metadata path (`semanticMetadataUtils.ts:102`) calls it for instances/prototypes and is unaffected today; the CLI output is wrong today.
   - **Fix:** in the variable branch, push the `name` node and then each `variable_declarator` child's `name`, the way `declaration-visitor.ts` already does. One test asserting three names for `var int a, b, c;`.
   - **If we skip it:** a public "all declarations" call keeps returning a subset, and every future grammar addition has to remember this file.

5. **A bodiless `func` does not just fail — it swallows the next declaration and becomes its body**
   (`daedalus-parser/grammar.js:51-60`)
   - **What this is:** `function_declaration` requires a `block`. Both reference grammars also require one, so refusing is defensible; the recovery is the problem.
   - **Problem:** `func int PrintDebug(string txt);\nfunc void After() { };` produces **one** `function_declaration` whose `ERROR` child spans `;\nfunc void`, after which `After`'s block is PrintDebug's body — so the model holds one function named `PrintDebug` with `After`'s contents, plus two errors at `1:32` and `2:11` for a mistake that is at `0:31`. This is the shape the fidelity doc records as the corpus's only syntax error (`AI/AI_Intern/Externals.d`, a listing of bodiless engine prototypes), and the semantic model of such a file is wrong rather than empty.
   - **Fix:** give it its own node, exactly like `instance_forward_declaration` did in #383: `function_forward_declaration: seq(func, _type, identifier, '(', parameters, ')', ';')`, and have the declaration pass index it (or skip it) instead of meeting a bodyless `function_declaration`. The Externals-shaped file then parses, and the two bogus errors go with it.
   - **If we skip it:** a file of engine prototypes produces a model with fabricated function bodies, and its errors point one character past the real fault.

6. **The error list is implemented twice, and nested `ERROR` nodes are reported twice**
   (`daedalus-parser/src/core/parser.js:262-290` and `daedalus-parser/src/semantic/visitors/error-visitor.ts:22-70`)
   - **What this is:** the same walk, the same `type`/`message`/`position`/`text` shape, in two files, both 1-based.
   - **Problem:** they agree today (measured on four cases), and they only agree because fix F11's 1-based arithmetic was applied to both — so the next change has to be applied twice, quietly. They also duplicate the noise: the `using zParserExtender; META{…}` sample yields six errors for one bad header, two of them at `1:1`, because an `ERROR` node nested inside another `ERROR` is pushed again with the outer node's start position; an unterminated string likewise reports `1:1` (the outer node) next to the useful `1:16`.
   - **Fix:** keep `collectErrors` in `parser.js` as the one implementation and make `ErrorVisitor` call it (`model.errors = errors; model.hasErrors = errors.length > 0`), and skip an `ERROR`/missing node whose parent is an `ERROR` — the outer node already covers that range. Fewer errors, one place to fix.
   - **If we skip it:** a Problems panel shows duplicate entries at a useless position, and every future position fix is a two-file change waiting to be half-done.

7. **Nothing checks that the committed `src/parser.c` matches `grammar.js`**
   (`daedalus-parser/package.json:10,19`; `.github/workflows/all-tests.yml:364`; `daedalus-parser/binding.gyp:9`)
   - **What this is:** `src/parser.c`, `src/grammar.json` and `src/node-types.json` are committed, `binding.gyp` compiles the committed `src/parser.c`, and CI runs `npm test`, which is `npm run build && … && node --test` — it regenerates before it tests.
   - **Problem:** so a commit that edits `grammar.js` without running `npm run build` passes CI: the runner regenerates the file it needs and tests the new grammar, while the *committed* artifact — the one a reviewer reads, and the one any path that skips `postinstall` compiles — stays old. `bindings/node/index.js` also loads `src/node-types.json` at require time. Today they are in sync (the committed `grammar.json` carries the `@^` identifier from #383 and the newest commit touching either file is the same one), so this is a missing guard, not a live mismatch. `git diff` after generate is the check; the caveat is that `tree-sitter-cli` is pinned with a caret, so a new CLI could reformat `parser.c` and make the guard fail for nothing — pin the CLI exactly when you add the guard.
   - **Fix:** one step in `parser-tests` after the test run: `git diff --exit-code -- src/parser.c src/grammar.json src/node-types.json`.
   - **If we skip it:** the first time it happens, whoever runs `npm run build` next gets an unexplained 12k-line diff and has to guess whether the grammar or the artifact is right.

8. **The identifier alphabet is every Latin-1 byte, so invisible and punctuation bytes join names silently**
   (`daedalus-parser/grammar.js:273`)
   - **What this is:** `/[a-zA-Z_\u0080-\u00FF][a-zA-Z0-9_@^\u0080-\u00FF]*/` — the whole Latin-1 supplement, not just its letters.
   - **Problem:** a non-breaking space (0xA0) is a Latin-1 byte, so `var int x\u00A0= 1;` parses with **no error** and the declaration's name is `"x\u00A0"` (measured) — a later `x = 1;` refers to a name that does not exist, and nothing reports it. The same class accepts `a§b`, `a°b`, `a±b`, `a²b` as single names. DaedalusLanguageServer's alphabet is `GermanCharacter | [a-zA-Z_]` with `GermanCharacter` = `ß Ä ä Ö ö Ü ü`, and the engine's own test is presumably `isalpha`, which 0xA0 and `§` fail.
   - **Fix:** narrow the class to letters — start `[a-zA-Z_\u00C0-\u00FF]`, continue `[a-zA-Z0-9_@^\u00C0-\u00FF]` — which drops NBSP, `§`, `°`, `·` and the fractions while keeping every accented letter. A test that `var int x\u00A0;` is an error.
   - **If we skip it:** a paste from Word or a stray NBSP produces a model whose names do not match their references, with no diagnostic.

**Nice to have:**

9. **The `boolean` rule can never match, and two branches wait on it** (`daedalus-parser/grammar.js:287-290`; `src/semantic/parsers/literal-parsing.ts:22`; `src/semantic/parsers/condition-parsers.ts:325`)
   - **What this is:** `boolean: choice(/[tT][rR][uU][eE]/, …)`, plus its consumers.
   - **Problem:** `TRUE`, `true`, `FALSE`, `True` in argument, condition, assignment and return position all lex as `identifier` (measured: `Npc_SetFlag(self, TRUE)` → `identifier:TRUE`), so the node type never appears. `literal-parsing.ts:22` and `condition-parsers.ts:325` therefore have unreachable branches. It is harmless today only because Daedalus's `TRUE` is an engine constant and treating it as a name is the right call.
   - **Fix:** delete the rule and both branches; add one assertion pinning `TRUE` as an identifier so nobody "restores" it as a reserved word.
   - **If we skip it:** dead grammar that a future reader will assume is live, and a reserved-word bug waiting for whoever makes the precedence "work".

10. **The identifier alphabet is written three times, and this copy is stale** (`daedalus-parser/src/semantic/reference-expression.ts:22`, against `src/codegen/generator.ts:543`)
   - **What this is:** a fast-path regex in `referenceIdentifierFromText` that stands in for the grammar rule before falling back to a real parse.
   - **Problem:** #393 added `@` and `^` to `generator.ts`'s copy but not to this one, so `_@`, `_@s` and `Foo@` miss the fast path and take the parse fallback. The answer is still right (measured), so this is a wasted parse per lookup rather than a bug — for a whole-project load that is the same pattern slice 3 counted per call.
   - **Fix:** delete the fast path (the result is cached below it anyway) so the grammar is the only copy.
   - **If we skip it:** a fourth copy of the alphabet will be written by the next person looking for it.

11. **`encodingConfidence` is a constant 100 that nothing reads** (`daedalus-parser/src/core/parser.js:90,108`)
   - **What this is:** a field on every parse result, asserted to be `100` by two tests (`test/encoding.test.js:82,95`).
   - **Problem:** the detector has no confidence; it applies byte rules. No production code reads the field (the editor does not), so the only thing it does is invite a UI to claim certainty the detector never had.
   - **Fix:** delete the local, the field and the two assertions.
   - **If we skip it:** a "100% confident" label on a heuristic, exactly where finding 2 shows it is wrong.

12. **`throughput` claims bytes per second and counts code units** (`daedalus-parser/src/core/parser.js:50-57`)
   - **What this is:** `sourceLength: sourceCode.length` and `throughput: … / ms * 1000 // bytes per second`.
   - **Problem:** `sourceCode.length` is UTF-16 code units, so a 4,000-character German file reports 4,056 "bytes" instead of 8,056, and no caller reads either field.
   - **Fix:** drop both fields, or rename and divide by the measured duration only when someone wants them.
   - **If we skip it:** a wrong number in a result object, which someone will eventually print as if it were measured.

**Verdict:** fix 1, 2 and 3 first.

**Lean:** -30 lines possible (the dead `boolean` rule and its two branches, the second error walker, the stale identifier fast path, `encodingConfidence` and `throughput`).

**Not checked:** whether the Gothic compiler itself accepts a missing `;`, a bodiless `func`, `&=`, `|=` or `\uFEFF` mid-file — there is no engine and no licensed MDK corpus here, so those calls rest on the two reference grammars cited in `docs/architecture/parser-fidelity.md` §"Reference grammars (#383)" plus the repo's own fixtures. Also unverified: whether real Polish/Czech mod roots exist inside the 890-file Beppo corpus (not present locally), which would size finding 2.
