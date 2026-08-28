# Diagnostic tooling

Container-level instruments for the T6.5 engine gate. `normalizeWorld` reads
ZenKit's *parsed structs* and is therefore blind to archive-container facts
(entry names, entry types, object frame versions, framing). The walkers that
see them live in `../lib/container.js` (BinSafe) and `../lib/container-ascii.js`
(ASCII) and feed the dump's `container` section; these CLIs are thin front-ends
over it. See `../docs/engine-acceptance-2026-08-25.md`.

- `walk.js <a.zen>` — BinSafe entry-stream walker CLI (`walk` from
  `lib/container.js`). Parses the entry stream from the end of the text header
  to `hashTableOffset`, yielding entry name/type/framing/payload offsets per
  event. `MeshAndBsp` is a raw blob (`uint32 bspVersion, uint32 size, size
  bytes`) outside the entry stream and is special-cased. **BinSafe only** —
  `bytediff.js` is the CLI that dispatches on format.
- `audit2.js <a.zen> <b.zen>` — positional per-class divergence census plus a
  hash-table comparison. Does **not** normalize `childs<N>` (an earlier variant
  did, which hid a real defect). Reports divergence classes and confirms both
  streams end exactly at their `hashTableOffset`.
- `bytediff.js <a.zen> <b.zen>` — **event-aligned byte diff**: compares the raw
  bytes of every archive event and of every `MeshAndBsp` chunk, grouping the
  differences by class and entry. This is the instrument that found the ten
  byte-fidelity defects in `patches/0010`–`0019`; a byte difference that no
  struct dump can see shows up here immediately.
  The diff itself is `../lib/container-diff.js`, shared with
  `../scripts/zen-roundtrip.js`'s report; this file is the printer, so the two
  cannot again disagree about which formats exist.
  A span that differs **only** in an archive header's `date`/`user` VALUES is
  reported identical — two files written a second apart carry different stamps,
  and a world nests archives, so the `MeshAndBsp` blob has a header of its own.
  Only the values are dropped, never the lines: a missing or added stamp line is
  real drift, and every byte outside a header is compared exactly.
  **BinSafe *and* ASCII**, dispatched on the archive header — the ASCII writer's
  A1–A4 (`../docs/engine-acceptance-2026-08-25.md` §10.2) live in an entry stream
  `walk()` cannot parse, and until this dispatched the tool could only read the
  format that already round-trips. It is what pinned A1 and A4 byte-exactly and
  what confirmed patches 0024/0025 fixed them. BINARY still has no walker and is
  refused rather than guessed at.
  **Read the `COVERAGE` line first.** It accounts for every byte of the file
  (text header + every event span + the trailing region, which is the hash table
  on BinSafe and empty on ASCII) and reports the gap; only with `gap 0` does
  "everything else is identical" mean anything, because a diff that silently
  skips a region will call a broken file clean.
  On ASCII expect an `ALIGN BREAK`: A2 writes every VOB packed, so the original's
  unpacked entry list and the re-save's `dataRaw` diverge at the first VOB and
  the streams cannot be aligned past it. That break *is* the finding.
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
  verdict. Reads a developer-local install (`ZENKIT_G2_WORLDS` overrides the
  path) and never writes to it. **Superseded by
  `../scripts/zen-roundtrip.js`** (the T7 harness, which it seeded): that one
  discovers worlds itself, isolates each in a child process, writes a report
  artifact and counts coverage honestly. `breadth.js` is kept because it is two
  screens of code and quicker to hack a one-off variation into.
- `fuzz-world.js [--seeds 40] [--bytes 20] [--whole] [--file <zen>]` — seeded
  corruption fuzzer for the read path (`../../docs/plans/level-editor.md`
  §16.11). Each seed writes N random bytes into a copy of a fixture and loads it
  in a child process, so a segfault or a hang is a reported line, not the end of
  the run. **It corrupts the entry stream, not the whole file** — a byte in the
  text header is rejected before any reader runs, and a whole-file run
  (`--whole`) mostly measures that check: 30 of 30 clean, against 5 of 40 not
  clean when the writes are confined to the stream.
  `--seed <n>` replays one seed and then delta-debugs it down to the smallest
  set of mutations that still fails, which is what turns a crash into a named
  field — patch `0030` was found this way, minimized to a single byte.
- `engine-batch.ps1 [-Dir cand] [-Only 00,01] [-Exe Spacer2|Gothic2] [-Windowed]` — the
  manual engine pass, automated as far as it can be. Verifies the pristine
  backup's hash before touching the install, installs each candidate, launches
  the engine, polls its top-level windows and auto-captures any assertion dialog
  (killing the engine), asks for a verdict when it exits cleanly, and restores
  the backup — hash-verified, in a `finally`, so an interrupt cannot leave a
  modified world behind. **Load each world twice**: Spacer renders nothing on
  the first load of *any* world, including the retail original.
  `-Windowed` sets `zStartupWindowed=1` in `Gothic.ini` for the run and restores
  it afterwards (backed up like the world, restored in the same `finally`).
  There is no command-line switch for windowed mode; it is an ini key. It also
  clears SystemPack's `SimpleWindow`, which strips the window frame — but only
  when SystemPack's hook DLL (`ddraw.dll`) is actually installed, because
  without it `SystemPack.ini` is inert and editing it would be theatre.
- `mutate.js <outDir>` — stages the three T10 / E-full candidates as flat
  `*.zen` files for `engine-batch.ps1`: `00-control-original` (the pristine
  world — **the control, never skip it**), `01-resave` (load → save, unchanged,
  for checklist rows 2–9) and `02-minimal-edit` (the two Phase-0 mutations, for
  row 10). Reads `NewWorld.zen.original-backup` in preference to the installed
  world and prints the source hash, so it cannot silently pick up a
  mid-experiment file. See the acceptance record §8.
- `startup-probe.ps1 [-Exe Gothic2|Spacer2] [-Seconds 45]` — **is the engine
  itself healthy?** Launches it, watches its top-level windows for an error
  dialog, and always kills what it started. Modifies **nothing** in the
  install and needs nobody at the keyboard, so it is safe to run before a
  candidate batch. It answers only "does this crash at startup" — never a
  checklist row. Written to diagnose a broken install (acceptance record §6,
  Environment): a Steam reinstall restores the six VDFs the MDK layout needs
  renamed `.disabled`, which crashes `Gothic2.exe` ~5 s after launch **and**
  can make the engine read `NewWorld.zen` out of `Worlds.vdf` instead of the
  installed candidate, voiding any verdict taken in that state.
- `dumpwin.ps1` — extracts the text of Spacer's/Gothic's error dialogs via
  Win32 `EnumWindows`, so an assertion can be read exactly rather than from a
  screenshot. Run while the dialogs are still open; the **"Assertion Failed"**
  window carries the file/line/condition, the "Breakpoint" window does not.
  (`engine-batch.ps1` does this for you.)

These are developer tools and not part of the addon or its test suite, but they
**are** linted with everything else (`tools/**/*.js` is in `package.json`'s
`lint` script and in `eslint.config.js`): `bytediff.js` consumes the shared
`lib/` walkers, and a consumer that is neither linted nor tested is a consumer
nothing checks at all. The walkers themselves are covered by
`test/container.test.js`.
