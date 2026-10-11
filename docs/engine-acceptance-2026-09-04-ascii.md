# ASCII world engine acceptance — 2026-09-04

## Scope

This record certifies preservation saves of existing Gothic II ASCII worlds.
It does not certify BINARY archives or format conversion.

The runtime was Gothic II Night of the Raven from the Steam installation at
`C:\Program Files (x86)\Steam\steamapps\common\Gothic II`, launched by GMBT
0.22 from the deployed Beppo project in `_work\beppo`.

## Fixture and candidates

The control was `thirdparty\Worlds\SURFACE_BEPPO.ZEN`:

- SHA-256: `6afdced96bd8be997fc7f5532038e6121131c7f4a957a6f41e4d74f0b748a92a`
- size: 12,729,549 bytes
- VOB count: 4,539

The three writer candidates were:

| Candidate | SHA-256 | Edit | Result |
| --- | --- | --- | --- |
| Untouched | `95d108586ccc2be5c11e992b38427d0e8b1f6b8ed1b26cf7e8c92a800302c46f` | none | PASS |
| Property | `d220fcb22a90736d3e0d9be3a1b85186f820ae4ace0a1ce9250bce00142193ef` | move VOB `0/273`, enable physics, set `locked=false` | PASS |
| Structure | `6816e72a535441db63724804856050f44db384d19ac437678dfa48e01942bb5e` | insert `ITFO_APPLE`, then reparent it to slot 274 | PASS |

The untouched round trip's explained container differences were 364 object
versions changing from `53505` to `64513` and an empty shared-lightmap chunk
(`0xB026`) being emitted. Both forms were accepted by the runtime.

## Procedure and observations

Each candidate was copied in turn to the original basename
`thirdparty\Worlds\SURFACE_BEPPO.ZEN` and launched with:

```text
gmbt test --world=SURFACE_BEPPO.ZEN --noaudio --show-duplicated-subtitles
```

The user observed the world load for all three candidates. The original file
was then restored and its SHA-256 reverified.

Launching the same files under long diagnostic basenames produced access
violations. A byte-equivalent control loaded when restored to the original
basename, establishing that those failures came from the alternate world
identity rather than serialization. Engine acceptance must therefore test a
replacement under its production basename.

GMBT `build`/VDF packaging and `test --full` were not used as this gate: they
have separate timeout/packaging failures. The user explicitly accepted the
working QuickTest path as the runtime viability gate for this promotion.

## Verdict

PASS. Normal `saveWorld` may accept ASCII and BinSafe archives. BINARY remains
refused unless a diagnostic caller supplies `allowNonBinSafe` explicitly.
