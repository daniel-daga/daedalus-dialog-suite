# ASCII World Save Design

## Goal

Allow the editor to preserve and save an existing `zCArchiverGeneric` (ASCII)
world in its original archive format. This work does not add BinSafe-to-ASCII
conversion, an archive-format selector, or support for BINARY saves.

ASCII saving remains unavailable in the normal application until the writer
passes the repository's round-trip and original-engine gates.

## Acceptance standard

An ASCII save is releasable when:

- the input remains ASCII after saving;
- the round-trip harness reports no unexplained semantic drift;
- repeated saves are deterministic;
- all retail ASCII worlds are measured with full container coverage and no
  crash or unreadable result;
- the existing BinSafe fidelity verdict remains unchanged; and
- representative untouched and edited ASCII candidates pass an original-engine
  A/B test against a pristine control.

Byte-for-byte identity is not required for a difference that is demonstrated
to be semantically equivalent and accepted by the engine. Such differences
must be individually understood and recorded rather than dismissed as a class.

## Chosen approach

Repair and promote ZenKit's native ASCII serializer. The editor already keeps
the archive format on `WorldHandle`, and `saveWorld` already serializes through
that recorded format. Fixing fidelity at the native boundary keeps one world
model and one serializer for the editor, the diagnostic harness, and other
binding consumers.

Two alternatives were rejected:

- Editing the original ASCII event stream in place would preserve unknown text,
  but structural edits would turn that layer into a second archive serializer.
- Serializing and conditionally rejecting candidates after a runtime comparison
  is useful diagnostics, but does not repair known lossy fields and would make
  save availability vary by input world.

## Architecture and data flow

The existing flow remains authoritative:

```text
open ASCII .zen
  -> WorldHandle records ArchiveFormat::ASCII
  -> edits mutate the in-memory ZenKit world
  -> saveWorld serializes with the recorded ASCII format
  -> atomic write replaces the requested target
```

Format, game version, root-object metadata, packed/unpacked VOB layout, and
archive contents continue to live in the native handle. No editor-side ASCII
model is introduced.

After the engine gate passes, the binding accepts `BINSAFE` and `ASCII` through
the ordinary `saveWorld` call and continues to reject `BINARY`. The existing
diagnostic bypass is narrowed to BINARY or renamed to describe BINARY
explicitly. The editor worker, service, IPC, save dialog, and UI use their
existing path; only stale BinSafe-only comments and errors change.

## Native fidelity work

### Signed ASCII booleans

Mirror the established BinSafe rule in `WriteArchiveAscii::write_bool`.
True `locked`, `moveable`, and `focusOverride` entries are written as `-1`;
ordinary true booleans remain `1`.

### Legacy float rounding

Make ASCII float output independent of the host CRT. The formatter retains the
existing nine-significant-digit form and three-digit exponent, but handles an
exact discarded half by rounding away from zero as ZenGin's legacy MSVC CRT
did. The same formatter serves scalar, vector, and raw-float entries.

### Wide `visualAniMode` preservation

An unpacked ASCII VOB can contain a 32-bit `visualAniMode` value even though
ZenKit's semantic `AnimationType` is narrower. Preserve the loaded raw value and
the semantic value derived from it. When the semantic value is unchanged, save
the original raw value. When a caller deliberately changes the semantic value,
save that new valid value instead. Newly authored VOBs have no preserved raw
value and use their normal semantic default.

This preserves retail, heap-shaped values without treating them as valid editor
choices. The packed layout remains limited to its on-disk two-bit field.

### Packed `physicsEnabled`

Write packed bit 6 from `physics_enabled` directly. Whether a savegame-only
rigid-body payload exists remains guarded at the point where that payload is
written; it must not erase a world VOB's physics flag.

Each change is maintained as a focused downstream ZenKit patch with a matching
regression test.

## Production behavior and errors

After certification, ASCII saving is transparent. It uses the existing save
dialog, worker isolation, serialized edit/save queue, and atomic destination
replacement. There is no experimental warning or compatibility toggle.

- Serialization, worker, and filesystem failures propagate to the existing
  world-save error UI.
- The destination stays unchanged unless the complete archive is written.
- A failed save does not change the in-memory world or recorded source format.
- BINARY remains rejected with a format-specific error.
- The expensive round-trip comparison remains a development and release gate,
  not a step in every production save.

## Automated verification

Implementation follows TDD, with a failing regression preceding each fix.

1. Exact ASCII writer tests cover signed booleans and legacy halfway rounding,
   including positive, negative, scalar, vector, and raw-float cases.
2. VOB tests prove an unchanged wide `visualAniMode` survives and an intentional
   valid edit replaces the preserved raw value.
3. A packed-VOB test proves `physicsEnabled` survives without a rigid body.
4. ASCII fixtures round-trip fully container-instrumented, deterministic,
   reloadable, and semantically identical.
5. Save-policy tests prove ASCII and BinSafe are accepted normally while BINARY
   remains rejected.
6. The complete `zenkit-node` suite and relevant editor worker/service save
   tests pass.
7. An audit maps every reachable ASCII writer method to fixture coverage so an
   unexercised path cannot repeat the earlier `write_byte`/`write_word` gap.

## Retail corpus gate

Run the developer-local round-trip harness over the retail corpus. It must show:

- all 20 ASCII worlds measured;
- no crash or unreadable result;
- full ASCII container coverage;
- zero unexplained semantic drift;
- deterministic second saves; and
- no regression in the retail BinSafe verdict.

The report and exact native build used for the run are retained with the
acceptance evidence.

## Original-engine gate

Use a pristine ASCII world as the control and produce three candidates:

1. an untouched ASCII re-save;
2. a property-edited candidate covering a transform, a signed boolean, and
   `physicsEnabled`; and
3. a structurally edited candidate covering insertion, reparenting, and the
   resulting archive object counts.

Spacer II must load and inspect every candidate. Gothic II must load the
applicable playable candidate. Record input and output hashes, exact edits,
round-trip output, and observed engine behavior in a dated acceptance record.

Normal ASCII saving is promoted only after this record passes. If any candidate
fails, the default refusal remains in place while diagnostics retain their
explicit escape hatch.
