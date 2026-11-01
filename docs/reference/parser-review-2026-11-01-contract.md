# Parser review — 2026-11-01, slice 7: the public contract and the fidelity harness

Reviewed commit `533771d` (2026-11-01). Slice 7 of 7: what `daedalus-parser`
publishes (`index.d.ts`, `exports`, `files`, `bin/`, `API.md`, `README.md`) and
what `scripts/roundtrip-corpus.js` with `test/roundtrip-corpus-smoke.test.js`
and `test/fixtures/corpus/` actually measure.

**Expected load.** Two consumers. (1) The editor, which bundles the package and
`import`s the root entry and five subpaths from its main process; a wrong export
or a wrong `dist/` path breaks the app at startup, on every user. (2) The corpus
script, run in CI over the 12 fixtures on every PR and by a maintainer over the
1,725-file MDK tree; a gate that cannot fail hides every future generator
regression from everyone.

**What this change does.** Nothing — this is a review. It reads the published
surface against the code behind it, and reads the corpus script against the
claims `docs/architecture/parser-fidelity.md` ("Fidelity measurement") and
`README.md` make for it, then runs both to see what a green run proves.

## Must fix

1. **`--strict` passes a corpus it could not parse at all** (`daedalus-parser/scripts/roundtrip-corpus.js:275-282`, `:595-601`)
   - **What this is:** `analyzeFile` returns `status: 'source_syntax_error'` when
     the input does not parse, and the pass/fail rule at the end counts only
     `driftFiles`, `generatedSyntaxErrors`, `tokenFidelityDriftFiles` and choice
     targets. Source syntax errors are printed and dropped.
   - **Problem:** Any file the grammar rejects is silently excluded from every
     tier and from the exit code. I ran `--strict` over a directory holding one
     good fixture and one `namespace Foo { … };` file: exit **0**, `Scanned: 2`,
     `Source syntax errors: 1`. So a grammar regression that stops accepting a
     whole construct family turns those files into "not measured" and CI stays
     green — and #395's "strict-green, 1,725 files, exit 0" claim is compatible
     with any number of MDK files never having been round-tripped. This is the
     same hole that makes slice 1's finding 3 (BOM + one legacy byte, unparseable
     at 1:1) invisible.
   - **Fix:** add `summary.sourceSyntaxErrors > 0` to `hasFailure`, and give the
     known exception its own switch: the MDK's `AI/AI_Intern/Externals.d` is
     expected, so pass an explicit allow-list (or `--allow-syntax-error <path>`)
     and fail on every other one. One line plus one flag.
   - **If we skip it:** the gate reports "green" over a shrinking share of the
     corpus, and the first visible signal is a user's file failing to open.

2. **Tier 2 is called "byte fidelity" and never compares a byte** (`daedalus-parser/scripts/roundtrip-corpus.js:310-311`, `:213`; `daedalus-parser/src/core/parser.js:86-108`)
   - **What this is:** `byteFidelityDrift` is
     `normalizeLineEndings(source.rootNode.text) !== normalizeLineEndings(generatedText)`.
     Both sides are JavaScript strings that `parseFile` already decoded, and
     `generatedText` was generated from that same decoded text. The file's bytes
     are never read by the comparison.
   - **Problem:** a decode that loses or mangles characters is reported as
     **byte-identical** if generation reproduces the characters it was given.
     I put two files through the script: (a) a Windows-1250 file holding
     `PrintScreen("Błędy i księga", -1);`, which `parseFile` reads as
     Windows-1252 and turns into `B³êdy i księga` — the live defect in slice 1's
     finding 2; (b) a Windows-1252 file with an unassigned byte `0x81` inside a
     string, which `iconv` decodes to U+FFFD and can never write back. Both
     came out `status: ok`, `tokenFidelityDrift: false`,
     **`byteFidelityDrift: false`**, exit 0. So the tier cannot see an encoding
     bug by construction, and `encoding-1252.d` being in `BYTE_EXACT_FIXTURES`
     (`test/roundtrip-corpus-smoke.test.js:49`) reads as proof of something it
     never checked.
   - **Fix:** compare what is on disk: `iconv.encode(generatedText, source.encoding)`
     against `fs.readFileSync(file)`. That fails case (b) the day it is written.
     Case (a) needs slice 1's detector fix; the corpus cannot be its oracle.
   - **If we skip it:** every save in the editor goes through decode → generate →
     encode, and the only check that covers that path is green by construction.
     Polish and Czech mods are already corrupted on read with no failing test.

3. **The gate only measures a file nobody edited, so every editing defect sits outside it** (`daedalus-parser/scripts/roundtrip-corpus.js:272-315`; claimed as the fidelity gate at `README.md:349-355` and `README.md:250`)
   - **What this is:** `analyzeFile` runs parse → build model → generate →
     generate again. No fixture, and no code path in the script, ever changes a
     field of the model before generating. The pass therefore proves "this file
     can be re-saved untouched".
   - **Problem:** the editor's real path is save *after an edit*, and that is
     exactly what the corpus excludes. Concrete case from slice 5, finding 4:
     adding a condition to a raw-mode condition function deletes the preserved
     body (`src/semantic/visitors/linking-visitor.ts:352-405`, driven from
     `ConditionEditor.tsx:296-308`). Those models round-trip token-perfect if
     untouched, and the corpus is green today; the loss appears only when
     something edits them. `README.md:250` ("Round-trip tested – Parse →
     Generate → Parse produces identical model") and `API.md:648-652`'s Example
     3 ("Verify semantics preserved", which compares two dialog counts) present
     the weaker check as the stronger one.
   - **Fix:** one fixture that is edited before generation — a typed action's
     text changed, a condition added, a property set — with a committed expected
     output file rather than a self-comparison. Two files, one test.
   - **If we skip it:** "the corpus is green" answers a question the editor does
     not ask, and the slice 2, 4 and 5 defects stay unguarded forever.

## Should fix

4. **`--json` is documented as machine-readable and emits native node dumps** (`daedalus-parser/bin/daedalus-parse.js:73-82`; `daedalus-parser/src/core/parser.js:151-196`; `daedalus-parser/API.md:686-687`)
   - **What this is:** `extractDeclarations` puts the live tree-sitter node on
     every declaration (`node: child`), and the `--json` branch stringifies
     that array.
   - **Problem:** the node serializes as an index-keyed struct plus the entire
     grammar's `nodeTypeInfo` table, repeated per declaration. `examples/DIA_Farmim.d`
     is 11,646 bytes and produces 1,118,819 bytes of JSON; `quoting.d` is 230
     bytes and produces 54,007. The declarations' own text is not in there, and
     each of two runs differs by `parseTime`/`throughput`. Nobody can diff it or
     feed it to a tool.
   - **Fix:** delete the `node` field from the `--json` output
     (`declarations.map(({ node, ...rest }) => rest)`). Three words.
   - **If we skip it:** the one documented machine-readable output of the
     package is unusable, and a 1 MB dialog file produces ~100 MB of stdout.

5. **`index.d.ts` does not compile on its own, and `daedalus-parser/types` exports no types** (`daedalus-parser/index.d.ts:80`, `:88`; `daedalus-parser/package.json:43-45`)
   - **What this is:** `static detectSourceEncoding(buffer: Buffer)` uses
     `Buffer` with no reference to `@types/node`, and `@types/node` is only a
     devDependency (`package.json:109`). The file ends in `export =`, so the
     eleven interfaces it declares (`ParseResult`, `Declaration`, `Position`,
     …) are module-local and cannot be imported by name.
   - **Problem:** a consumer with the default `skipLibCheck: false` and no
     `@types/node` in its own tree gets `index.d.ts(80,39): error TS2580:
     Cannot find name 'Buffer'` from our file — reproduced in a throwaway
     project. And the `./types` subpath, listed in `daedalus-parser/AGENTS.md`
     as "TypeScript type declarations only", answers
     `import type { ParseResult } from 'daedalus-parser/types'` with
     `error TS2305: no exported member 'ParseResult'`; at runtime it is
     `ERR_PACKAGE_PATH_NOT_EXPORTED` because the entry has only a `types`
     condition. It is a second name for the root entry and nothing else.
   - **Fix:** `buffer: Uint8Array` (a `Buffer` is one) and `export` the
     interfaces, or delete the `./types` block — it promises nothing today.
   - **If we skip it:** the package advertises types it does not hand out, and
     one strict consumer setup fails on our declaration file, not on its own.

6. **`daedalus-parse` exits 0 on a file that does not parse** (`daedalus-parser/bin/daedalus-parse.js:56-60`, `:162-171`)
   - **What this is:** the only `process.exit(1)` calls are for a missing file
     and a thrown exception. `result.hasErrors` is printed in every mode and
     never changes the exit code.
   - **Problem:** `func void F( {` gives exit 0 in default, `--json` and
     `--stats` modes, with `hasErrors: true` buried in the output. The package's
     published `bin` is called `daedalus-parse`, so the obvious thing to do with
     it in a script is check a file, and it always says yes.
   - **Fix:** `process.exitCode = result.hasErrors ? 1 : 0` after the report.
     One line.
   - **If we skip it:** anyone gating a build on the shipped binary gets a pass
     for a broken file.

7. **Every command example in the docs names a file that is not there, and one names a flag that does not exist** (`daedalus-parser/README.md:113`, `:128`, `:161-162`, `:170-171`; `daedalus-parser/API.md:661-683`; `daedalus-parser/bin/semantic-visitor-cli.ts:22`; `daedalus-parser/bin/semantic-code-generator-cli.ts:215-217`)
   - **What this is:** `examples/` holds `DEV_2130_Szmyk.d`, `DIA_Arog_SLD_99005.d`,
     `DIA_DEV_2130_Szmyk.d`, `DIA_Farmim.d`, `condition-example.js` and two
     `.ts` demos. The docs and both CLIs' own `--help` print
     `examples/DIA_Szmyk.d`, and `README.md:161-171` also prints
     `examples/script.d` and `daedalus-parse examples/script.d --tree`.
     `bin/daedalus-parse.js:49-54` has no `--tree` option and ignores unknown
     flags.
   - **Problem:** `npm run semantic -- examples/DIA_Szmyk.d` prints
     `Error: File not found: examples/DIA_Szmyk.d` and exits 1 — the command the
     CLI itself recommends. `daedalus-parser/AGENTS.md` requires documented CLI
     commands to match the scripts and binaries, so this is a rule the package
     breaks in its own help text. `--tree` silently prints the default report,
     so the user cannot tell it did nothing.
   - **Fix:** point every example at `DIA_Farmim.d` or `DEV_2130_Szmyk.d`, and
     drop `--tree` (or reject unknown flags in `bin/daedalus-parse.js`).
   - **If we skip it:** the first thing a new user runs fails.

8. **The formatter's "✅ Round-trip successful!" compares two integers** (`daedalus-parser/bin/semantic-code-generator-cli.ts:166-181`)
   - **What this is:** with `--verbose`, the CLI rebuilds the model from the
     generated text and compares `dialogCount === dialogCount2 &&
     functionCount === functionCount2`, then prints success. Without
     `--verbose`, nothing is compared.
   - **Problem:** a generator that drops every comment, or flattens every
     preserved body, keeps both counts identical and earns the green tick. This
     is the same check `API.md:648-652` teaches as "Verify semantics preserved",
     which is why a reader comes away believing round-trip equality is
     established. The only real comparison in the repo is the corpus, and per
     finding 3 it has its own limits.
   - **Fix:** delete the message, or replace the counts with the same token
     comparison the corpus uses (`scripts/roundtrip-corpus.js:231-270` is
     already a function — export it and call it from the CLI).
   - **If we skip it:** the tool people reach for to check a suspicious save
     tells them it is fine.

9. **The tarball is not a working package** (`daedalus-parser/package.json:7-21`, `:75-86`, `:107-117`; `daedalus-parser/.gitignore:20`; `daedalus-parser/binding.gyp:6`; `README.md:396`, `API.md:696`)
   - **What this is:** four independent gaps between what ships and what the
     package needs. `dist/` is gitignored and there is no `prepack` or
     `prepublishOnly`, so a publish from a clean checkout ships an `exports` map
     whose five `dist/` subpaths point at nothing. `scripts/` is not in `files`,
     so the shipped `test:roundtrip-corpus` script has no file to run.
     `postinstall` runs `npm run build` (`tree-sitter generate`) and `build:ts`
     (`tsc`), and `node-addon-api` is read by `binding.gyp`; all three are
     devDependencies, which npm does not install for a dependency.
     `README.md:396` and `API.md:696` say "see LICENSE file" and there is none
     in the directory.
   - **Problem:** `npm pack --dry-run` right now produces a plausible tarball only
     because this checkout happens to have a built `dist/`. A registry install
     would run a `postinstall` with no `tree-sitter` CLI and no `tsc`, and the
     editor's five subpath imports would resolve to missing files if the tarball
     were built without a build step. Today the only consumer is the pnpm
     workspace, where devDependencies exist and `predev` builds `dist/`, so the
     defect is latent — but the exports map is written as if it were published.
   - **Fix:** add `prepack` (`npm run build:ts`), add `"scripts/**"` to `files`,
     and move the install-time build behind `prebuilds` (which `package.json:20`
     already has a script for) instead of `postinstall`. Add the LICENSE file.
   - **If we skip it:** the first registry publish, or a `files` change, breaks
     every subpath import in the editor with a module-not-found at startup.

## Nice to have

10. **One generator exception aborts the whole corpus run and writes no report** (`daedalus-parser/scripts/roundtrip-corpus.js:544-547`)
    - **What this is:** `main` calls `analyzeFile` in a loop with no per-file
      error handling.
    - **Problem:** over the MDK (1,725 files, minutes) a throw on file 900
      unwinds to the top, prints a stack trace, and neither the summary nor the
      details JSON is written, so the previous failures are lost too.
    - **Fix:** `try { details.push(analyzeFile(…)) } catch (e) { details.push({ file, status: 'analysis_error', message: e.message }) }`
      and fail on that status. Three lines.
    - **If we skip it:** the run that finds a new bug is the run that reports
      nothing.

11. **`encodingConfidence` is the constant `100`** (`daedalus-parser/src/core/parser.js:90`, `:108`; typed at `daedalus-parser/index.d.ts:34`)
    - **What this is:** every `parseFile` result carries
      `encodingConfidence: 100`, regardless of what the detector actually saw.
    - **Problem:** it reads as a measurement and is fabricated. A consumer that
      trusts it (the editor's `encodingUtils` mirrors the detector, so not today)
      would treat a guessed Windows-1252 as certain — the guess slice 1's
      finding 2 is about.
    - **Fix:** drop the field, or fix it at the value the detector knows it has.
    - **If we skip it:** one more number in the result that means nothing.

## Verdict

Fix 1, 2 and 3 first. The public surface is mostly sound — every subpath
resolves, the editor imports only package-facing paths, and the fixture ratchet
cannot rot silently — but the gate that is supposed to protect the editor is
weaker than its own documentation says in three separate ways: it ignores files
it cannot parse, it never looks at a byte, and it never edits a model.

**Lean:** -6 lines possible: the `./types` export block
(`package.json:43-45`) and its duplicate `paths` alias in `tsconfig.json` promise
nothing that the root entry does not already give.

**Not checked:** the native addon's own build (`npm run build`) and the packaged
app, so I could not confirm that a real registry install fails as described in
finding 9; I read that from `package.json`, `binding.gyp` and the gitignore. The
MDK corpus itself is not in this checkout, so findings 1 and 10 are measured on
the 12 fixtures plus purpose-built two-file corpora, not on 1,725 files.
