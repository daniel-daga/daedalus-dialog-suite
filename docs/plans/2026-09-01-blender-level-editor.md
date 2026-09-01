# Blender Level Editor Plugin Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship a Blender 4.2+ Windows add-on that opens, edits, and saves BinSafe Gothic `.ZEN` worlds through the existing `zenkit-node` binding.

**Architecture:** Blender is a Python projection client; a long-lived Node subprocess owns the authoritative ZenKit world and VFS handles. A versioned length-prefixed JSON protocol carries control messages, while typed-array payloads are encoded as tagged base64 values for the first release; the boundary permits binary side frames later without changing handlers.

**Tech Stack:** Blender Python API 4.2, Python 3 standard library, Node.js CommonJS, N-API `zenkit-node`, Node test runner, Python `unittest`.

---

### Task 1: Versioned framed protocol on Node

**Files:**
- Create: `zenkit-node/lib/blender-bridge/protocol.js`
- Create: `zenkit-node/test/blenderBridgeProtocol.test.js`

**Step 1: Write the failing tests**

Test that `encodeFrame({id: 1, method: 'ping'})` emits a four-byte little-endian
length followed by UTF-8 JSON, that `FrameDecoder.push()` handles split and
coalesced frames, and that oversized/invalid JSON frames throw a protocol error.

**Step 2: Run the test to verify RED**

Run: `node --test test/blenderBridgeProtocol.test.js` from `zenkit-node/`.
Expected: FAIL because `lib/blender-bridge/protocol.js` does not exist.

**Step 3: Implement the minimum protocol**

Export `PROTOCOL_VERSION = 1`, `MAX_FRAME_BYTES = 256 * 1024 * 1024`,
`encodeFrame(value)`, and `FrameDecoder`. Use a four-byte LE unsigned length,
reject zero/oversized frames before allocation, decode only complete frames,
and retain the incomplete suffix.

**Step 4: Verify GREEN**

Run: `node --test test/blenderBridgeProtocol.test.js`.
Expected: all protocol tests pass.

**Step 5: Commit**

```text
git add zenkit-node/lib/blender-bridge/protocol.js zenkit-node/test/blenderBridgeProtocol.test.js
git commit -m "feat(blender): add bridge framing protocol"
```

### Task 2: Transport-independent world session handler

**Files:**
- Create: `zenkit-node/lib/blender-bridge/session.js`
- Create: `zenkit-node/test/blenderBridgeSession.test.js`

**Step 1: Write the failing open-session tests**

Inject a fake binding and assert that `createSession(binding).request()`:

- rejects a mismatched protocol version;
- answers `ping` with protocol and ZenKit versions;
- opens one world with `gameVersion`, asset source paths, `vobIndex`, and
  `extractWorldMesh`;
- replaces and disposes the prior logical session on the next open;
- serializes `ArrayBuffer` and typed arrays as `{type, base64}` tagged values.

**Step 2: Verify RED**

Run: `node --test test/blenderBridgeSession.test.js`.
Expected: FAIL because the session module is missing.

**Step 3: Implement open and projection handlers**

Implement a method table rather than an `eval`-style dispatcher. Store the
world/VFS handles only in closure state. Return a generated session token,
world mesh, VOB index, and the unique visual names. Add `getVisual` and
`getTexture` requests so Blender loads assets lazily. Normalize thrown values to
`{code, message, details}` without returning JS stacks by default.

**Step 4: Verify GREEN**

Run: `node --test test/blenderBridgeSession.test.js`.
Expected: all open/projection tests pass.

**Step 5: Commit**

```text
git add zenkit-node/lib/blender-bridge/session.js zenkit-node/test/blenderBridgeSession.test.js
git commit -m "feat(blender): expose world projection bridge"
```

### Task 3: Mutation and save bridge requests

**Files:**
- Modify: `zenkit-node/lib/blender-bridge/session.js`
- Modify: `zenkit-node/test/blenderBridgeSession.test.js`

**Step 1: Write failing mutation tests**

Using the checked-in `minimal.g2.zen` fixture where practical, cover:

- `setVobTransform` applies position and row-major rotation to the addressed
  VOB and returns its refreshed properties;
- `setVobProperties` partitions base and class fields explicitly;
- `addVob` and `reparentVob` return a fresh VOB index because paths renumber;
- `saveWorld` rejects no-session/stale-session requests and calls the existing
  BinSafe-only writer;
- failed Save As does not replace the session path.

**Step 2: Verify RED**

Run: `node --test test/blenderBridgeSession.test.js`.
Expected: FAIL with unknown request methods.

**Step 3: Implement minimal handlers**

Validate every request's session token and value shapes. Map handlers directly
to `setVobPosition`, `setVobRotation`, `setVobProp`, `setVobClassProp`,
`insertVob`, `reparentVob`, `getVobProps`, `vobIndex`, and `saveWorld`. Never
expose arbitrary binding calls. Update current path only after successful save.

**Step 4: Verify GREEN and regression**

Run: `node --test test/blenderBridgeSession.test.js`.
Run: `npm test` from `zenkit-node/`.
Expected: both suites pass.

**Step 5: Commit**

```text
git add zenkit-node/lib/blender-bridge/session.js zenkit-node/test/blenderBridgeSession.test.js
git commit -m "feat(blender): bridge VOB edits and world saves"
```

### Task 4: Executable bridge process

**Files:**
- Create: `zenkit-node/bin/blender-bridge.js`
- Create: `zenkit-node/test/blenderBridgeProcess.test.js`
- Modify: `zenkit-node/package.json`

**Step 1: Write a failing process integration test**

Spawn the bridge with `process.execPath`, exchange framed `ping` and
`openWorld` requests, assert correlated response IDs, then close stdin and
assert a clean exit. Send one malformed frame and assert a protocol error is
written to stderr and the process exits nonzero.

**Step 2: Verify RED**

Run: `node --test test/blenderBridgeProcess.test.js`.
Expected: FAIL because the executable is absent.

**Step 3: Implement the process loop**

Load `../lib`, create the session, feed stdin chunks into `FrameDecoder`, process
requests sequentially, and write framed `{id, result}` or `{id, error}`
responses with stdout backpressure respected. Reserve stderr for diagnostics.
Add the `bin` entry `daedalus-blender-bridge` to `zenkit-node/package.json`.

**Step 4: Verify GREEN**

Run: `node --test test/blenderBridgeProcess.test.js`.
Expected: all integration tests pass and no stdout text appears outside frames.

**Step 5: Commit**

```text
git add zenkit-node/bin/blender-bridge.js zenkit-node/test/blenderBridgeProcess.test.js zenkit-node/package.json
git commit -m "feat(blender): add bridge executable"
```

### Task 5: Blender-independent Python client and coordinate layer

**Files:**
- Create: `blender-addon/daedalus_zen/bridge.py`
- Create: `blender-addon/daedalus_zen/coords.py`
- Create: `blender-addon/tests/test_bridge.py`
- Create: `blender-addon/tests/test_coords.py`
- Create: `blender-addon/tests/__init__.py`

**Step 1: Write failing Python tests**

Cover frame encoding/decoding compatibility with Node, request correlation,
tagged typed-array decoding, timeout/EOF behavior, stderr capture, and clean
shutdown. Pin the coordinate contract with fixtures for centimetres-to-metres,
the mirrored X root, triangle winding, position round-trips, and matrix
round-trips matching `zen-world`'s measured conversion.

**Step 2: Verify RED**

Run: `python -m unittest discover -s blender-addon/tests -v`.
Expected: import failures for `daedalus_zen.bridge` and `.coords`.

**Step 3: Implement minimal pure-Python modules**

Use `subprocess.Popen`, a reader thread, locked writes, monotonically increasing
request IDs, and per-request events. Keep `bpy` out of both modules. Implement
coordinate functions over tuples/lists only so tests do not require Blender's
`mathutils`; adapt to `mathutils.Matrix` only in the projection layer.

**Step 4: Verify GREEN**

Run: `$env:PYTHONPATH='blender-addon'; python -m unittest discover -s blender-addon/tests -v`.
Expected: all bridge and coordinate tests pass.

**Step 5: Commit**

```text
git add blender-addon/daedalus_zen/bridge.py blender-addon/daedalus_zen/coords.py blender-addon/tests
git commit -m "feat(blender): add Python bridge client"
```

### Task 6: Projection state and edit generation without Blender

**Files:**
- Create: `blender-addon/daedalus_zen/model.py`
- Create: `blender-addon/tests/test_model.py`

**Step 1: Write failing model tests**

Specify stable custom-property metadata, parent-path reconstruction from the
columnar VOB index, deduplication by visual name, transform-change detection,
dirty-state transitions, stale-session rejection, and reindex behavior after
add/reparent. Assert unsupported scale and deletion produce explicit errors.

**Step 2: Verify RED**

Run: `$env:PYTHONPATH='blender-addon'; python -m unittest blender-addon/tests/test_model.py -v`.
Expected: FAIL because `model.py` is missing.

**Step 3: Implement state model**

Create immutable VOB records and a session model that computes desired bridge
requests from Blender-neutral snapshots. Keep projection suppression and dirty
tracking in this layer so Blender handlers stay thin and testable.

**Step 4: Verify GREEN**

Run: `$env:PYTHONPATH='blender-addon'; python -m unittest discover -s blender-addon/tests -v`.
Expected: all Python tests pass.

**Step 5: Commit**

```text
git add blender-addon/daedalus_zen/model.py blender-addon/tests/test_model.py
git commit -m "feat(blender): model projected VOB state"
```

### Task 7: Blender add-on registration, import, panels, and transforms

**Files:**
- Create: `blender-addon/daedalus_zen/__init__.py`
- Create: `blender-addon/daedalus_zen/preferences.py`
- Create: `blender-addon/daedalus_zen/operators.py`
- Create: `blender-addon/daedalus_zen/projection.py`
- Create: `blender-addon/daedalus_zen/panels.py`
- Create: `blender-addon/tests/blender_smoke.py`

**Step 1: Write a failing Blender background smoke test**

The script enables the add-on, checks registration of Open/Save/Save As
operators and preferences, builds a synthetic projection without proprietary
assets, verifies shared mesh datablocks and VOB metadata, changes a transform,
and confirms exactly one bridge request is generated after debounce.

**Step 2: Verify RED**

Run: `blender --background --factory-startup --python blender-addon/tests/blender_smoke.py`.
Expected: FAIL because the add-on is not registered.

**Step 3: Implement the Blender adapter**

Add `bl_info` with Blender `(4, 2, 0)`. Register File-menu Open and Save entries,
add-on preferences for Node executable, bridge script, game version, and asset
sources, and Daedalus World/VOB panels. Build the static world mesh as read-only,
cache visual mesh/material datablocks, tag all owned data with a session ID,
parent VOB objects, and observe dependency-graph transform updates with a timer
debounce. Lock scale and revert rejected edits. Remove only active-session data
when replacing a world.

**Step 4: Verify GREEN**

Run the Blender background command again.
Expected: smoke test passes without UI or registration errors.

Run: `$env:PYTHONPATH='blender-addon'; python -m unittest discover -s blender-addon/tests -v`.
Expected: pure-Python tests remain green.

**Step 5: Commit**

```text
git add blender-addon/daedalus_zen blender-addon/tests/blender_smoke.py
git commit -m "feat(blender): import and edit ZEN worlds"
```

### Task 8: Property editing, VOB authoring, reparenting, and saving

**Files:**
- Modify: `blender-addon/daedalus_zen/operators.py`
- Modify: `blender-addon/daedalus_zen/panels.py`
- Modify: `blender-addon/daedalus_zen/projection.py`
- Modify: `blender-addon/tests/blender_smoke.py`
- Modify: `blender-addon/tests/test_model.py`

**Step 1: Extend failing tests**

Cover common property edits, class-field request construction, supported VOB
creation, hierarchy refresh after reparent, Save/Save As dirty-state behavior,
cancelled file dialogs, bridge errors, and preservation of unrelated Blender
objects.

**Step 2: Verify RED**

Run the Python suite and Blender smoke command.
Expected: focused new assertions fail because the operators are absent.

**Step 3: Implement the editing UI**

Generate fields only from the bridge-provided writable-property catalogue;
never infer arbitrary fields. Add VOB and Reparent operators with confirmation
where paths renumber. Add Save and Save As operators that clear dirty state only
after bridge acknowledgment. Keep arbitrary deletion, terrain/BSP modification,
scale, waynet, and animation controls unavailable.

**Step 4: Verify GREEN**

Run both Python and Blender smoke suites.
Expected: all tests pass.

**Step 5: Commit**

```text
git add blender-addon/daedalus_zen blender-addon/tests
git commit -m "feat(blender): complete VOB editing workflow"
```

### Task 9: Installable package and end-to-end verification

**Files:**
- Create: `blender-addon/README.md`
- Create: `blender-addon/package.ps1`
- Create: `blender-addon/manifest.json`
- Modify: `package.json`

**Step 1: Write a failing packaging check**

Add a `--check` mode that verifies the ZIP contains one add-on package root,
the bridge script/runtime manifest, no tests or proprietary data, and compatible
protocol versions. Add a root script `test:blender-addon` that runs the Node and
pure-Python suites.

**Step 2: Verify RED**

Run: `powershell -File blender-addon/package.ps1 -Check`.
Expected: FAIL because packaging metadata/script is missing.

**Step 3: Implement packaging and concise installation docs**

Package the Python module and bridge JS into a Blender-installable ZIP. In
development, preferences may point at the repository Node executable and bridge
script. Record Windows/Blender 4.2+, BinSafe-only saving, and the deliberately
read-only world mesh in the README.

**Step 4: Run final verification**

Run:

```text
npm test                         # from zenkit-node/
$env:PYTHONPATH='blender-addon'; python -m unittest discover -s blender-addon/tests -v
blender --background --factory-startup --python blender-addon/tests/blender_smoke.py
powershell -File blender-addon/package.ps1 -Check
npm run build                    # repository root
npm run test                     # repository root
```

Expected: every available command passes. If Blender is not installed, report
that one smoke check as unexecuted; do not claim Blender-runtime verification.

**Step 5: Commit**

```text
git add blender-addon package.json
git commit -m "build(blender): package level editor add-on"
```
