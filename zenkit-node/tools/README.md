# Diagnostic tooling

Container-level instruments for the T6.5 engine gate. `normalizeWorld` reads
ZenKit's *parsed structs* and is therefore blind to archive-container facts
(entry names, entry types, object frame versions, framing). The walker that
sees them lives in `../lib/container.js` and feeds the dump's `container`
section; these CLIs are thin front-ends over it. See
`../docs/engine-acceptance-2026-08-25.md`.

- `walk.js <a.zen>` — BinSafe entry-stream walker CLI (`walk` from
  `lib/container.js`). Parses the entry stream from the end of the text header
  to `hashTableOffset`, yielding entry name/type/framing/payload offsets per
  event. `MeshAndBsp` is a raw blob (`uint32 bspVersion, uint32 size, size
  bytes`) outside the entry stream and is special-cased.
- `audit2.js <a.zen> <b.zen>` — positional per-class divergence census plus a
  hash-table comparison. Does **not** normalize `childs<N>` (an earlier variant
  did, which hid a real defect). Reports divergence classes and confirms both
  streams end exactly at their `hashTableOffset`.
- `bytediff.js <a.zen> <b.zen>` — **event-aligned byte diff**: compares the raw
  bytes of every archive event and of every `MeshAndBsp` chunk, grouping the
  differences by class and entry. This is the instrument that found the ten
  byte-fidelity defects in `patches/0010`–`0019`; a byte difference that no
  struct dump can see shows up here immediately.
  **Read the `COVERAGE` line first.** It accounts for every byte of the file
  (text header + every event span + hash table) and reports the gap; only with
  `gap 0` does "everything else is identical" mean anything, because a diff that
  silently skips a region will call a broken file clean.
- `splice.js <orig> <variant> <out> <groups>` — builds a world from the
  original's bytes with only selected groups taken from a re-save (`header`,
  `blob`, `vobtree`, `locked`, `dataRaw`, `colorAni`, `hashtable`,
  `all-but-blob`). Refuses to run unless both files share an event stream and
  hash-table index mapping, and verifies the result ends at its
  `hashTableOffset`. This is how the engine failure was localised to one
  structure — and it is **Plan B's machinery**, kept because it works.
- `chunksplice.js <orig> <variant> <out> <chunkIndex>` — the same one level
  down, a single mesh/BSP chunk at a time; patches the blob's declared size and
  the archive's `hashTableOffset`. It named the two chunk defects that were each
  independently fatal to the original engine.
- `breadth.js <World> [...]` — re-saves each retail world and reports blob
  byte-identity, determinism, the event-level byte residual and the classifier
  verdict. The corpus check in one command; the seed of the T7 harness. Reads a
  developer-local install (`ZENKIT_G2_WORLDS` overrides the path) and never
  writes to it.
- `engine-batch.ps1 [-Dir cand] [-Only 00,01] [-Exe Spacer2|Gothic2]` — the
  manual engine pass, automated as far as it can be. Verifies the pristine
  backup's hash before touching the install, installs each candidate, launches
  the engine, polls its top-level windows and auto-captures any assertion dialog
  (killing the engine), asks for a verdict when it exits cleanly, and restores
  the backup — hash-verified, in a `finally`, so an interrupt cannot leave a
  modified world behind. **Load each world twice**: Spacer renders nothing on
  the first load of *any* world, including the retail original.
- `dumpwin.ps1` — extracts the text of Spacer's/Gothic's error dialogs via
  Win32 `EnumWindows`, so an assertion can be read exactly rather than from a
  screenshot. Run while the dialogs are still open; the **"Assertion Failed"**
  window carries the file/line/condition, the "Breakpoint" window does not.
  (`engine-batch.ps1` does this for you.)

These are developer tools, not part of the addon or its test suite; the walker
they share is covered by `test/container.test.js`.
