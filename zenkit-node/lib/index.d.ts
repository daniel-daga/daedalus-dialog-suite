// Types for the subset of the binding TypeScript consumers use. This is not a
// full description of the addon: `normalizeWorld`, the fixture authors and the
// round-trip harness are JS-only diagnostics and are deliberately absent.
// The payload shapes are `zen-world`'s, which is where they are tested.

export type WorldHandle = { readonly __world: unique symbol };
export type VfsHandle = { readonly __vfs: unique symbol };

export interface MeshChunk {
  name: string;
  texture: string;
  group: number;
  color: [number, number, number, number];
  alphaFunc: number;
  texAniMapMode: number;
  texAniFps: number;
  texAniMapDir: [number, number];
  envMapping: boolean;
  envMappingStrength: number;
  waveMode: number;
  waveSpeed: number;
  waveMaxAmplitude: number;
  waveGridSize: number;
  ignoreSun: boolean;
  disableLightmap: boolean;
  vertexCount: number;
  triangleCount: number;
  positions: ArrayBuffer;
  normals: ArrayBuffer;
  uvs: ArrayBuffer;
  indices: ArrayBuffer;
  /** Present on world-mesh chunks only; a proto mesh has no baked light word. */
  lights?: ArrayBuffer;
  /** Model attachments only: the hierarchy node and its accumulated transform. */
  node?: string;
  transform?: number[];
}

export interface WorldMesh {
  /** Computed from the vertices emitted — a retail zCMesh stores all zeros. */
  bbox: number[];
  vertexCount: number;
  triangleCount: number;
  chunks: MeshChunk[];
}

export interface VobIndex {
  count: number;
  parent: ArrayBuffer;
  childIndex: ArrayBuffer;
  positions: ArrayBuffer;
  rotations: ArrayBuffer;
  flags: ArrayBuffer;
  classes: string[];
  classIndex: ArrayBuffer;
  names: string[];
  nameIndex: ArrayBuffer;
  visuals: string[];
  visualIndex: ArrayBuffer;
  visualTypes: string[];
  visualTypeIndex: ArrayBuffer;
}

export interface WaynetGraph {
  count: number;
  /** Not interned: waypoint names are effectively unique. */
  names: string[];
  positions: ArrayBuffer;   // Float32 x3, ZenGin space
  directions: ArrayBuffer;  // Float32 x3
  waterDepths: ArrayBuffer; // Int32 x1
  /** Uint32 x1 — bit 0 freePoint, bit 1 underWater. */
  flags: ArrayBuffer;
  edgeCount: number;
  /** Uint32 x2 per edge — indices into the arrays above. */
  edges: ArrayBuffer;
  /** Edges dropped because an endpoint was not in the point list. */
  danglingEdges: number;
}

export interface VfsEntry {
  name: string;
  type: 'file' | 'directory';
}

export interface VisualPayload {
  source: string;
  chunks: MeshChunk[];
}

export interface TexturePayload {
  source: string;
  width: number;
  height: number;
  mipmaps: number;
  rgba: ArrayBuffer;
}

export function loadWorld(file: string, gameVersion: 'g1' | 'g2'): WorldHandle;
export function extractWorldMesh(handle: WorldHandle): WorldMesh;
export function vobIndex(handle: WorldHandle): VobIndex;
/** The waynet as a drawable graph: stored order, edges as index pairs. */
export function getWaynet(handle: WorldHandle): WaynetGraph;
export function openVfs(paths: string[], options?: { overwrite?: 'all' | 'newer' | 'older' | 'none' }): VfsHandle;
export function vfsResolve(vfs: VfsHandle, name: string): string | null;
/** The children of one directory, or null when the path is absent or is a file. */
export function vfsList(vfs: VfsHandle, path?: string): VfsEntry[] | null;
export function extractVisual(vfs: VfsHandle, name: string): VisualPayload | null;
export function decodeTexture(vfs: VfsHandle, name: string, level: number): TexturePayload | null;
/**
 * Move one VOB, addressed by its index path down the children lists ("0/2"),
 * to a position in ZenGin space. Translates the bbox by the same delta — the
 * engine culls by bbox, and a moved VOB with a stale one can vanish.
 *
 * `vobIndex` emits the last segment of that path as `childIndex`; rebuilding
 * the whole path is the consumer's job (`zen-world`'s `vobIndexPath`).
 */
export function setVobPosition(
  handle: WorldHandle, indexPath: string, position: [number, number, number],
): void;
/**
 * Rotate one VOB, addressed by the same index path, with a **row-major** 3x3 —
 * the order `vobIndex` emits and `normalizeWorld` dumps.
 *
 * `bbox` is `[minX, minY, minZ, maxX, maxY, maxZ]` and is written verbatim when
 * given. It is not derived here: measured across the three retail worlds, a
 * VOB's stored box is the tight world AABB of its own visual placed by its own
 * transform, so the box is a pure function of (visual, rotation, position) and
 * the caller that owns the asset layer recomputes it. Omit it for a VOB whose
 * visual does not resolve — the stale box at least bounded the visual in some
 * pose, where a guessed one bounds nothing.
 */
export function setVobRotation(
  handle: WorldHandle,
  indexPath: string,
  rotation: readonly number[],
  bbox?: readonly number[] | null,
): void;
/** The scalar properties of `zCVob` itself. Every key is optional; only the
 *  ones present are written, and an unrecognised key is refused rather than
 *  ignored — every field here is invisible in the viewport, so a misspelled key
 *  that silently did nothing is this op's whole failure mode. */
export interface VobProps {
  name?: string;
  /**
   * Renames the visual **in place**, keeping the visual object the VOB already
   * carries. The object's class is not implied by the file name — measured over
   * the three retail worlds, `.3DS` is `zCProgMeshProto` 20,716 times and
   * `zCMesh` 31 times — so this never derives one. A VOB whose visual type is
   * `UNKNOWN` (15,749 of the 41,393 retail VOBs) has no object to rename and is
   * refused: giving a VOB a visual replaces the object and has to decide its
   * class, which is a different operation.
   */
  visual?: string;
  /** `[minX, minY, minZ, maxX, maxY, maxZ]`, written verbatim. Accepted only
   *  with `visual`, since nothing else here changes the box — and derived by the
   *  caller that owns the asset layer, exactly as `setVobRotation` requires. */
  bbox?: readonly number[];
  showVisual?: boolean;
  cdStatic?: boolean;
  cdDynamic?: boolean;
  vobStatic?: boolean;
  ambient?: boolean;
  physicsEnabled?: boolean;
}
/**
 * Set scalar properties on one VOB, addressed by the same index path.
 *
 * Nothing is written until every value has been validated, so a refused props
 * object leaves the VOB exactly as it was — a half-applied one would be a state
 * no op describes, and undo could not restore it.
 */
export function setVobProp(handle: WorldHandle, indexPath: string, props: VobProps): void;
/** A VOB to author. Only `position` is required; an unrecognised key is refused. */
export interface NewVob {
  name?: string;
  /**
   * The visual's class is derived from the extension — `.3DS` →
   * `zCProgMeshProto`, `.ASC`/`.MDS` → `zCModel`, `.MMS` → `zCMorphMesh`,
   * `.PFX` → `zCParticleFX` — which is the opposite of what `setVobProp` does,
   * and for the opposite reason: a rename has a class to preserve, authoring has
   * none, so the measured majority is the only defensible choice. `.TGA` is
   * refused: a decal carries dimensions and alpha settings this does not take.
   */
  visual?: string;
  position: readonly [number, number, number];
  /** Row-major; identity when omitted. */
  rotation?: readonly number[];
  /** `[minX, minY, minZ, maxX, maxY, maxZ]`. A 10 cm box around the position
   *  when omitted — pass the real one, computed from the visual. */
  bbox?: readonly number[];
  /** Defaults to whether there is a visual: a VOB with nothing to draw does not
   *  claim otherwise. */
  showVisual?: boolean;
  cdStatic?: boolean;
  cdDynamic?: boolean;
  vobStatic?: boolean;
  ambient?: boolean;
}
/**
 * Append a `zCVob` to `parentPath`'s children — `null` for a root — and return
 * the index path it landed at.
 *
 * **A null parent renumbers nothing and a parent renumbers.** A VOB's flat index
 * is its position in a depth-first traversal, so a root is enumerated last and
 * shifts nothing, while one appended under a parent is enumerated in the middle
 * and moves every VOB after that parent's subtree up by one. That is safe for
 * the same reason `reparentVob` is — the history replays batches strictly LIFO
 * against the enumeration each op was recorded in — and the caller's own guard
 * is the narrower one: an insert with a parent has to be alone in its batch.
 *
 * It appends rather than taking a slot, unlike `reparentVob`, because its
 * inverse is a delete of the VOB it just made rather than a move back to a
 * position that has to be remembered.
 */
export function insertVob(
  handle: WorldHandle, parentPath: string | null, opts: NewVob,
): string;
/**
 * Remove a VOB and its whole subtree.
 *
 * The exact inverse of `insertVob` for a VOB `insertVob` created — which is what
 * makes an add op invertible. It is **not** an invertible operation on an
 * arbitrary retail VOB: an `oCMobInter` carries per-class properties, children,
 * an AI and an event manager that no op describes.
 */
export function deleteVob(handle: WorldHandle, indexPath: string): void;
/**
 * Move a VOB and its whole subtree into `parentPath` at `slot` — `null` for a
 * root — and answer with the index path it landed at.
 *
 * **It renumbers, and no slot avoids that**: a move has two ends and every VOB
 * between them changes its flat index. It is safe because of how the history
 * uses it, not because of anything the call does — batches are replayed strictly
 * LIFO and the redo stack is cleared on every new edit, so an op is only ever
 * applied to the enumeration it was recorded against. The renderer's projection
 * is re-read whole, exactly as an insert re-reads it.
 *
 * The slot is what makes it invertible: putting a VOB back at the *end* of the
 * list it came from is a different world from the one it left. It refuses to
 * move a VOB into its own descendant, which would make the subtree unreachable
 * from the roots and therefore silently unwritten.
 */
export function reparentVob(
  handle: WorldHandle, fromPath: string, parentPath: string | null, slot: number,
): string;
/**
 * Move one waypoint. The first mutation here that is not about a VOB.
 *
 * `waypoint` indexes the same filtered, stored-order point list `getWaynet`
 * emits, which is a safe address for a move and for nothing else: a move
 * inserts, deletes and reorders nothing, so the enumeration the caller read is
 * the enumeration this writes into.
 *
 * `name` is a **guard, not an address**. A stale index path usually resolves to
 * nothing and this binding says so; a stale waypoint index always resolves to
 * some waypoint and would move it in silence. It throws on a mismatch. Nothing
 * in the format promises waypoint names are unique, which is why the name
 * cannot be the address either.
 *
 * There is no bbox counterpart to `setVobPosition`'s — a waypoint has no
 * bounding box — and `direction` is deliberately left alone.
 */
export function setWaypointPosition(
  handle: WorldHandle, waypoint: number, name: string, position: readonly [number, number, number],
): void;
/**
 * Write the world to `path`, through a temp file and a rename.
 *
 * **Throws for a world that was not loaded from a `zCArchiverBinSafe`
 * archive** — the only writer path verified byte-for-byte against the retail
 * corpus and in the original engine. ZenKit's ASCII writer corrupts every raw
 * entry it emits and cannot re-load its own output, and the BINARY path has had
 * no fidelity work at all. `{ allowNonBinSafe: true }` is for diagnostics
 * (`scripts/zen-roundtrip.js`), never for the app.
 */
export function saveWorld(
  handle: WorldHandle, path: string, options?: { allowNonBinSafe?: boolean },
): void;
export function zenkitVersion(): string;
