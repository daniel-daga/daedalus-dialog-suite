# Blender Level Editor Plugin Design

## Purpose

Build a Blender 4.2 LTS-or-newer add-on for Windows that opens and saves
BinSafe Gothic `.ZEN` worlds. The add-on reuses the repository's existing
ZenKit binding and world-editing rules instead of creating a second file-model
implementation.

The first release is a usable VOB level editor. It is not a compiled world-mesh
or BSP editor.

## Architecture

The Blender add-on is written in Python and owns Blender registration, panels,
operators, scene objects, and change observation. It starts a long-lived Node
subprocess that loads `zenkit-node`. Messages use a framed JSON protocol over
stdin and stdout; diagnostics use stderr so they cannot corrupt the protocol.

The Node process owns the authoritative ZenKit world handle. Blender receives a
render projection consisting of the static world mesh, decoded materials and
textures, reusable VOB visual meshes, and the columnar VOB index. Every editable
Blender object carries stable custom metadata that identifies its source VOB.
Blender transform or property changes become explicit operations against the
loaded handle. Save asks the bridge to write that mutated handle through the
existing fidelity-checked writer.

The process boundary is also a fault boundary: a malformed native input can end
the bridge without ending Blender. The add-on reports the failure and can start
a fresh bridge for the next open operation.

## Repository Components

- `blender-addon/daedalus_zen/`: installable Blender Python package.
- `blender-addon/tests/`: Python unit tests runnable without Blender for the
  protocol, coordinate conversion, state tracking, and operation generation.
- `zenkit-node/bin/blender-bridge.js`: Node entry point and framed-message loop.
- `zenkit-node/lib/blender-bridge/`: transport-independent request handlers and
  conversion of binding payloads into the plugin protocol.
- `zenkit-node/test/`: bridge handler and protocol tests using existing
  synthetic fixtures.

The Blender package must not import Node modules or duplicate archive logic.
The Node handler must not contain Blender-specific UI behavior.

## Data Flow

### Open

1. The add-on ensures the bridge process is running and sends `openWorld` with
   the selected `.ZEN` path and configured Gothic asset sources.
2. The bridge loads the world, rejects non-BinSafe archives, extracts the world
   mesh and VOB index, resolves unique visuals, and returns a session ID plus
   projection payloads.
3. Blender creates one root collection for the session, a read-only static
   world object, reusable mesh/material datablocks, and one object per visible
   VOB. Repeated visuals share mesh datablocks.
4. VOB objects retain Zen-space identity and original transform metadata. The
   existing ZenGin/renderer conversion remains the reference for axis,
   handedness, units, rotation, and winding behavior.

Large binary arrays are transferred as length-prefixed binary frames described
by the JSON response rather than expanded into JSON number arrays.

### Edit

Transform observation is debounced and suppressed while an incoming projection
is being applied. A completed position or rotation change is converted back to
Zen space and sent as a single `updateVobTransform` request. Common fields use
`setVobProperties`; insertion and hierarchy changes use `addVob` and
`reparentVob`. The bridge acknowledges an operation before the add-on marks the
scene clean.

The initial release supports position, rotation, the common VOB properties
already writable by `zenkit-node`, supported VOB insertion, and reparenting.
Arbitrary VOB deletion remains unavailable because the existing domain cannot
invert every retail VOB. Scale is locked because it is not a supported VOB
operation.

### Save

`saveWorld` and `saveWorldAs` send the destination to the bridge. The bridge
uses the existing BinSafe-only save path and returns success only after writing
the file. Save As does not silently change the current session path if writing
fails.

Terrain geometry, BSP data, portals, waynet editing, animation editing, and
compiled mesh export are outside the first-release boundary. Static terrain is
visible and selectable only as an inspection surface.

## Blender Interface

The File menu gains **Open Gothic World** and **Save Gothic World** entries. A
Daedalus World panel exposes session state, asset-source configuration, Save As,
and bridge diagnostics. A VOB panel appears for selected projected objects and
shows identity, class, path, common properties, and supported class fields.

World and generated visual datablocks use an internal naming namespace and
session tag. Opening another world removes only datablocks owned by the active
plugin session; unrelated user scene content is preserved. If the Blender file
already contains user objects, the world is imported into its own collection.

## Error Handling

- Validate paths and protocol versions before loading a world.
- Reject unsupported archive formats with a direct explanation that saving is
  fidelity-supported only for BinSafe worlds.
- Treat bridge EOF, malformed frames, request timeouts, and native crashes as a
  disconnected session; never continue sending edits to an unknown handle.
- Apply an edit to Blender only when it can be represented by a supported
  operation, or revert the local projection after a rejected operation.
- Write bridge logs to stderr and surface a concise diagnostic in Blender while
  retaining technical details for troubleshooting.
- Save failures leave the session dirty and preserve the previous session path.

## Testing

Development follows test-first cycles on both sides of the boundary.

Python tests cover framed transport, Zen/Blender coordinate and rotation
round-trips, metadata/state behavior, request construction, dirty-state rules,
and bridge-failure recovery without importing `bpy`. Thin Blender registration
and object-construction adapters are verified with Blender's background test
runner when Blender is available.

Node tests cover message framing, protocol validation, open projections,
transform/property operations, add/reparent behavior, BinSafe rejection, save
behavior, and error serialization using the existing checked-in synthetic world
fixtures. An integration test launches the real bridge process and exercises an
open-edit-save-reload cycle.

Completion requires the focused Python and Node suites, the `zenkit-node`
workspace suite, and a Blender 4.2 background smoke test on Windows. No test or
fixture may require proprietary Gothic game data.

## Packaging

The distributable contains the Python add-on plus a Windows bridge runtime with
Node and the matching prebuilt `zenkit-node` addon. Development mode may locate
the repository's Node executable and package through preferences. The protocol
is versioned so incompatible Python and bridge packages fail clearly rather
than exchanging subtly different payloads.

The first release targets Windows and Blender 4.2 LTS or newer. Other operating
systems can be added once matching native ZenKit builds and packaging are
available; the Python protocol and core tests remain platform-neutral.
