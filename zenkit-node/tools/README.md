# Diagnostic tooling

Container-level instruments for the T6.5 engine gate. `normalizeWorld` reads
ZenKit's *parsed structs* and is therefore blind to archive-container facts
(entry names, entry types, object frame versions, framing) — these tools are
the only thing that can see them. See
`../docs/engine-acceptance-2026-08-25.md`.

- `walk.js` — BinSafe entry-stream walker. Parses the entry stream from the end
  of the text header to `hashTableOffset`, yielding entry name/type/framing per
  event. `MeshAndBsp` is a raw blob (`uint32 bspVersion, uint32 size, size
  bytes`) outside the entry stream and is special-cased.
- `audit2.js <a.zen> <b.zen>` — positional per-class divergence census plus a
  hash-table comparison. Does **not** normalize `childs<N>` (an earlier variant
  did, which hid a real defect). Reports divergence classes and confirms both
  streams end exactly at their `hashTableOffset`.
- `dumpwin.ps1` — extracts the text of Spacer's/Gothic's error dialogs via
  Win32 `EnumWindows`, so an assertion can be read exactly rather than from a
  screenshot. Run while the dialogs are still open; the **"Assertion Failed"**
  window carries the file/line/condition, the "Breakpoint" window does not.

These are developer tools, not part of the addon or its test suite.
