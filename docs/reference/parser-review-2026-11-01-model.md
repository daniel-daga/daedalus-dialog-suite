# Parser review — 2026-11-01 — slice 4: semantic model and serialization

Slice 4 of 7 of the `daedalus-parser` workspace: the data the editor holds and
ships over IPC.
Commit reviewed: `3d92722`. Date: 2026-11-01.

Files: `src/semantic/semantic-model.ts`, `semanticModelInterfaces.ts`,
`semantic-visitor.ts`, `semantic-visitor-index.ts`, `source-value.ts`,
`name-utils.ts`, `code-formatting.ts`, and every `fromJSON` / `JSON.stringify`
path in them.

**Load assumed.** One model per file, built in a forked parser worker, merged
into a project model over hundreds of files and thousands of dialogs and
functions, and copied whole over Electron IPC on every parse (worker → renderer)
and every generate (renderer → main, on save and on the 2 s autosave while a file
is dirty). `semanticModel` is recreated on every edit and subscribed to by React,
so per-read and per-instance costs are paid on frames, not once.

**Method.** Probes against the built `dist/` with the real native grammar, on a
throwaway script: parse → `JSON.stringify` → `deserializeSemanticModel` → repeat,
plus timing and payload measurements. All 12 committed corpus fixtures round-trip
twice with no field loss and a byte-identical generation (see finding 6 for why
that is not the reassurance it looks like). 140 focused tests pass
(`semantic-serialization`, `semantic-global-symbols`, `linking-visitor`,
`review-symbol-lookup`, `review-reference-hydration-export`,
`class-prototype-roundtrip`, `dialog-instance-body-fidelity`,
`semantic-error-handling`, `review-source-boundaries`).

---

## What this change does

The model is the editor's only representation of a script: `parseSemanticModel`
builds it, `JSON.stringify` ships it, `deserializeSemanticModel` rebuilds it into
class instances, and the generator reads it back out. Every fact is meant to have
exactly one owner: `Dialog.actions` is a view onto the information function's
array, the function dictionary is looked up by name rather than held by pointer,
and identifier dictionaries are prototype-free. This review asked where those
rules stop holding — across an edit, across a serialization cycle, and across the
IPC hop. The answer: the rules hold inside one process, and the serialized form
breaks them, by carrying three copies of the same dialog body and by turning the
`instances` alias into a second object on the first round trip.

---

## Must fix

1. **The serialized model carries every dialog's information function up to three times**
   (`semantic-model.ts:1098`, `:1114-1123`, `:937-945`)
   - **What this is:** `Dialog.actions` is an enumerable getter that reads the
     information function's array, and `properties.information` holds the live
     `DialogFunction` object itself. `JSON.stringify` therefore writes the
     function twice inside the dialog — once as a whole object under
     `properties.information`, once as its action array under `actions` — on top
     of the copy already in `functions`.
   - **Problem:** Measured on a realistic file (120 dialogs, 12 lines each,
     89 KB of source): the payload is 2.12 MB, and 1.17 MB of it (56%) is that
     duplicate. The same 2 MB goes renderer → main on every generate
     (`fileStore.ts:905`), i.e. every autosave of a dirty file, and back on every
     parse. Nothing reads either copy on arrival: `linkPropertiesToFunctions`
     re-resolves the object by name (`:937-945`) and `fromJSON` ignores the
     `actions` snapshot whenever an information function resolves (`:1192-1194`).
     Both are thrown away after paying to clone and parse them.
   - **Fix:** add `Dialog.toJSON()` that writes `properties.information` and
     `properties.condition` as the function's name and omits `actions` when an
     information function resolves (the setter's standalone-array path still
     needs it). The editor already does exactly this normalisation by hand before
     handing a dialog back (`fileStore.ts:updateDialogWithNormalizedProperties`),
     which is the codebase admitting the object form must not round-trip. About
     10 lines; roughly halves the payload.
   - **If we skip it:** a 300 KB MDK dialog file sends about 6 MB per autosave,
     and every one of those bytes is copied by IPC, `structuredClone`, JSON and
     class-transformer before being discarded.

---

## Should fix

2. **`dialog.actions` in the renderer is a stale snapshot that looks authoritative**
   (`semantic-model.ts:1114-1123`, `declaration-visitor.ts:139`)
   - **What this is:** the getter is a live view only inside a hydrated model. The
     renderer never hydrates: it holds the plain JSON, where `actions` is the
     parse-time array.
   - **Problem:** after any edit to the information function, the renderer's
     `dialog.actions` still shows the old lines while `functions[name].actions`
     shows the new ones, and a save silently regenerates from the function, not
     the dialog. Nothing reads it today (the dialog tree reads the function
     dictionary — `dialogTreeUtils.ts:52`), so this is a trap rather than a
     reported bug: the next feature that reads `dialog.actions` in the renderer
     gets yesterday's answer, and if it *writes* through it the write is dropped
     by the hydration rule at `:1192-1194`.
   - **Fix:** same as finding 1 — stop serializing `actions` when an information
     function resolves. That removes the third authority instead of documenting it.
   - **If we skip it:** the field stays a live view in one process and a frozen
     array in the other, which is the exact class of bug this review is looking
     for.

3. **One JSON cycle turns the `instances` alias into a second object, and the parser never compensates**
   (`semantic-model.ts:1304-1330`, `:1344-1360`)
   - **What this is:** at parse time `items`/`npcs`/`animations` hold the *same*
     `GlobalInstance` objects as `instances`. Hydration rebuilds each map from its
     own JSON category, so they become independent copies; the derivation that
     would restore the alias only runs when the payload *omits* the category.
   - **Problem:** confirmed on `items-npcs-mds.d`: after one cycle
     `model.instances.Some_NPC !== model.npcs.Some_NPC`. Editing `instances`
     (which is what generation reads) then leaves `npcs` on the old value while
     the NPC list, the problems panel (`fileFacts.ts:75`) and the variable
     options read `npcs`. This is #353, and the answer to its open question is:
     the compensation exists **only in the editor** — `NpcEditorDialog.tsx:383-384`
     and `routineSave.ts:109-110` write both maps. The parser has no such write.
     If those two editor lines stop, an NPC edit becomes invisible everywhere
     except generation; if the derivation at `:1344` stops, any payload without
     `npcs` (a hand-built model, an older serializer) loses the NPC list outright.
   - **Fix:** build `instances` first and then always assign
     `items[key] = npcs[key] = animations[key] = instances[key]` — drop the
     `if (!json.items)` / `!json.npcs` / `!json.animations` guards at `:1349`,
     `:1353`, `:1357`. One array, one object, and the editor's double write turns
     into a harmless no-op instead of a load-bearing obligation.
   - **If we skip it:** every new editor write path has to remember to write two
     maps, and the failure mode is a stale read, not an error.

4. **The same dialog has two different action counts depending on which side of the IPC hop you ask**
   (`semantic-model.ts:1043-1044`, `:1057-1072`, `declaration-visitor.ts:139`)
   - **What this is:** each `Dialog` keeps a callback to the function dictionary
     of the model it was born in (the per-file model at parse, the new model at
     hydration). The project model is built by copying the *dialogs* and
     *functions* map entries into fresh maps, so dialogs keep pointing at the
     file they came from.
   - **Problem:** a `C_INFO` in file A naming an information function in file B is
     never linked, because file A's own dictionary has no such function. In the
     merged project model: `merged.functions.D_Info.actions.length === 2` while
     `merged.dialogs.D.actions.length === 0` — and the same JSON hydrated in the
     main process reports `2`, because by then the callback points at the merged
     dictionary. Two authorities for one fact, and they disagree between
     processes. Latent today (`dialogTreeUtils.ts:52` and `useResolvedFunction`
     read the function dictionary), but the model's own contract says the dialog
     view is live.
   - **Fix:** none needed for generation — it is already correct (`information =
     D_Info;` is preserved as text). Either resolve the property against the
     supplied export dictionary in `generateDialog`/merge time, or drop the
     `actions` snapshot from the payload (finding 1) so the disagreement cannot
     be observed. The second is smaller and fixes finding 2 too.
   - **Test:** `review-reference-hydration-export.test.js` covers a *same-file*
     link and dictionary replacement; nothing covers a link that only resolves in
     another file's model.

5. **Hydration clones and rebuilds every action a second time**
   (`semantic-model.ts:1274`, `:755`)
   - **What this is:** `plainToInstance` with the discriminator already builds
     every top-level action. Line 1274 then maps `deserializeAction` over all of
     them, and `deserializeAction` does `structuredClone` + `plainToInstance`
     again.
   - **Problem:** that second pass is load-bearing — I confirmed class-transformer
     leaves a `ConditionalAction`'s `thenActions` as plain objects, so skipping it
     loses `generateCode` on nested actions. But it redoes the work for every
     *top-level* action as well. Measured on the 110 KB file: 9.7 ms of a 42 ms
     hydrate, per file, on every save and every parse.
   - **Fix:** in `deserializeAction`, return an already-built instance unchanged
     after recursing into a conditional's branches (~4 lines). Nothing else moves.
   - **If we skip it:** about a quarter of hydration time is spent destroying and
     rebuilding objects that were just built.

6. **The corpus that gates fidelity never goes through the serialization path**
   (`scripts/roundtrip-corpus.js:288`)
   - **What this is:** the strict token gate and the byte-exact fixtures generate
     from `sourceVisitor.semanticModel`, the parsed model. The editor only ever
     generates from `deserializeSemanticModel` output.
   - **Problem:** the model the editor writes is a different object graph — plain
     records from class-transformer, dialogs with getters and callbacks, actions
     re-cloned. Anything hydration drops (a lost `@Type`, a dropped `line`, a
     mishandled discriminator) is invisible to the gate that is supposed to catch
     exactly that. My probe found no loss today: all 12 fixtures generate
     byte-identically through both paths, so the missing gate has not been needed
     yet.
   - **Fix:** generate a second time from
     `deserializeSemanticModel(JSON.parse(JSON.stringify(model)))` and compare it
     with the first output; about 3 lines in the script, no new fixtures.
   - **If we skip it:** the one path the editor uses is the one path the corpus
     does not check.

7. **The action/condition type tables are a third hand-kept list, and a miss is a warning that becomes a crash**
   (`semantic-model.ts:654-686`, `:613-642`, `:772-778`, `:816-832`)
   - **What this is:** every action type appears three times — the `DialogAction`
     union, the class itself, and the 28-entry `ACTION_DISCRIMINATOR` table that
     `deserializeAction` looks up. Conditions the same, in 9 entries.
   - **Problem:** a missing table entry is not a compile error. `deserializeAction`
     logs a warning and returns raw JSON (`:775`), so the action has no
     `generateCode`; `deserializeCondition` returns `new Condition('')` (`:831`).
     Either way the failure surfaces at save, as
     `condition.generateCode is not a function` — I reproduced exactly that. All
     28 action classes and all 8 condition classes round-trip today, so this is a
     guard, not a live bug. Worse on the legacy path: `ensureConditionType`'s
     catch-all (`:806`) turns any typeless condition carrying an `npc` field into
     `Npc_IsDead(self)`, i.e. it guesses and writes the wrong call rather than
     refusing. That path is only reachable for JSON without `type` — this parser
     always writes one — so it is a legacy/foreign-input hazard.
   - **Fix:** one test that instantiates each exported action and condition class,
     JSON round-trips it, and asserts the class name comes back — it fails the day
     a table entry is missed. And tighten `:806` so `NpcIsDeadCondition` only
     matches when `npc` is the only field.
   - **If we skip it:** adding an action type stays a three-file edit guarded by a
     console warning.

8. **The editor's project model is not built from prototype-free dictionaries**
   (`name-utils.ts:9-12`; fix in `projectStore.ts:38-51`, `questAnalyzer.ts:14-27`)
   - **What this is:** `createNameRecord()` exists because `__proto__` and
     `constructor` are ordinary Daedalus identifiers, and every record the parser
     builds or hydrates uses it. The renderer builds the merged project model with
     plain `{}` and fills it with `Object.assign`.
   - **Problem:** `Object.assign({}, {__proto__: x})` does not create a key, it
     sets the prototype. Confirmed: after the merge the symbol is gone from
     `Object.keys`, `resolveCaseInsensitive` returns `undefined`, and the merged
     record's prototype is no longer `Object.prototype`. Project-wide lookups
     (autocomplete, `useResolvedFunction`) silently lose that symbol; the file's
     own model still has it, so the two models disagree.
   - **Fix:** `createNameRecord()` in the two `createEmptySemanticModel` helpers —
     one import and eight `{}` → `createNameRecord()` per site.
   - **If we skip it:** the invariant the parser documents is only true on the
     parser's side of the IPC hop. Only bites names like `__proto__`, which #333
     says are ordinary symbols.

---

## Nice to have

9. **`dialog.actions` pays a key scan on every read** (`semantic-model.ts:1047-1055`)
   - **What this is:** every read of the getter calls `resolveDialogFunction` →
     `getDialogFunctionName` → `Object.keys(properties).find(...)`, allocating a
     key array each time, then a second scan in the fallback.
   - **Problem:** measured 100k reads: 23 ms through the getter against 3.5 ms
     through `functions[name].actions` — 8×, on a value rendered per action card
     and read once per dialog per `JSON.stringify`.
   - **Fix:** try the exact property key first and only fall back to the
     case-insensitive scan. Two lines.

10. **Five copies of the same five declaration fields** (`semantic-model.ts:146-293`)
    - **What this is:** `sourceText`, `leadingComments`, `filePath`, `position`
      (four numbers) and `range` (two numbers) are written out five times across
      `GlobalConstant`, `GlobalVariable`, `GlobalInstance`, `GlobalClass` and
      `GlobalPrototype`.
    - **Problem:** ~50 lines that must change together, in a file that already has
      a module for shared shapes (`semanticModelInterfaces.ts`).
    - **Fix:** one interface the five classes `implements`.

11. **Dead and redundant hydration lines** (`semantic-model.ts:816-832`,
    `:1275-1276`)
    - **What this is:** `deserializeCondition` is exported and called from nowhere
      in the parser or the editor; `calls` and `callSites` are reassigned right
      after `plainToInstance` already copied them.
    - **Problem:** ~14 lines that suggest behaviour which does not exist (the
      reassignment reads as if class-transformer were incomplete). Deleting
      `deserializeCondition` is a public-subpath change, so keep it if anything
      outside this repo may import it.

---

## Verdict

Fix 1 first: it removes the payload cost and the stale-action trap (2) in one
change. Then 3, which is #353 and is a two-line edit while the answer is still in
hand.

## Lean

-50 lines possible (finding 10 alone is ~-40, finding 11 ~-14, net of the ~10
lines finding 1 adds).

## Not checked

The editor's merge cache (`projectStore.ts:1004-1026`) reuses the previous merged
category map when the input category objects are referentially unchanged, and
`fileStore.updateFunction` replaces a function *inside* that same object — that
looks like a stale merged model after an edit, but it is the store slice's code,
so I did not follow it. No MDK corpus run and no Electron UI run.
