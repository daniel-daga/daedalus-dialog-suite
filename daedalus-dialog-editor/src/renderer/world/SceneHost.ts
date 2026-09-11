import * as THREE from 'three';
import type {
  DecodedTexture, InstancedPayload, VobIndex, WorldMeshPayload,
} from '../../shared/worldTypes';
import type { BvhBuilder } from './BvhBuilder';
import { VobPicker } from './VobPicker';
import { WorldScene, type TextureCache } from './WorldScene';

// The scene one payload gets, lifted out of `WorldViewport`'s one big effect
// (#220, review §4).
//
// A structural op — placing a VOB, deleting one — cannot be applied to the
// columnar projection, so the whole scene is rebuilt from the world
// (level-editor.md §7). This class is exactly what that rebuild replaces: the
// `WorldScene`, the BVH trees over its world meshes, and the GPU picker that
// answers a click. Everything more expensive than those — the decoded pixels,
// the builder's memory of the trees, the renderer and its GL context — is
// handed in and outlives it, which is the whole point of drawing the line here.
//
// So the rules it carries are all about that boundary:
//
//   - the pick scene is *both* halves. The props are ID-picked, and the world
//     mesh is drawn depth-only behind them — without it nothing writes depth
//     and a VOB behind a wall wins the pixel (§16.24 3).
//   - warming the picker pays the 53 ms pick-shader compile (276 ms once) here
//     rather than on the user's first click.
//   - the trees are keyed on the `mesh` payload, so a rebuild deserializes what
//     it already has instead of spending the cold open's 145-590 ms again
//     (review §3.3), and a teardown `settle()`s the builds it abandoned rather
//     than terminating a worker it does not own.
//   - only the textures the cache does not already hold are asked for: a
//     rebuilt scene asks for nothing at all unless the edit brought a visual
//     whose texture is new.
//   - the marker layer for the VOBs with no visual is built here too (§16.38),
//     because it is exactly as rebuildable as the instances are: a placed sound
//     gets its marker from the rebuild the placement already forces.
//   - and the mirrored root comes back off the scene it was added to, because
//     that scene is not this class's to throw away.

/** Textures are decoded at this cap by picking a mipmap rather than resampling.
 *  Every NewWorld texture at full size is ~490 MB of RGBA; the spike's measured
 *  scene used 256 and 96 MB. */
export const TEXTURE_MAX_SIZE = 256;

export interface SceneHostOptions {
  /** The top-level scene the mirrored root hangs under. Not owned: the world is
   *  added on construction and removed again on dispose. */
  scene: THREE.Scene;
  /** For warming the pick shader, and for nothing else here. */
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;

  mesh: WorldMeshPayload;
  visuals: InstancedPayload;
  /**
   * The VOB index, for the markers the worker places nothing for (§16.38) —
   * 38 % of a retail world, every sound, light, zone and trigger. It is the
   * renderer's own copy of the summary's columns rather than a payload of its
   * own: a position exists there for every VOB, which is exactly what a VOB
   * with no visual has and no payload carries.
   */
  vobIndex: VobIndex;

  /** Decoded pixels, kept across the rebuild a structural op forces. Owned by
   *  the viewport, which is also what disposes it. */
  textures: TextureCache;
  /** The world mesh's trees, likewise kept — and keyed on `mesh`. */
  bvh: BvhBuilder;

  loadTexture: (name: string, maxSize: number) => Promise<DecodedTexture | null>;
  /** The texture names that could not be decoded, once per scene build. White
   *  geometry is otherwise a fact the user has to reverse-engineer
   *  (level-editor.md §16.31): a mod folder holds *source* `.TGA` files, which
   *  resolve by name and then fail to parse — textures the mod has not compiled
   *  yet. Never called after `dispose`. */
  onTextureFailures: (names: string[]) => void;
}

export class SceneHost {
  readonly world: WorldScene;
  readonly picker: VobPicker;
  /**
   * Both halves of the load: the trees and the pixels.
   *
   * A half-loaded scene is a different scene — the BVH decides the terrain pick
   * and the textures decide what the GPU actually samples — so the benchmark
   * and the screenshot both wait on this rather than sleeping.
   */
  readonly ready: Promise<void>;

  private disposed = false;

  constructor(private readonly options: SceneHostOptions) {
    const { scene, renderer, camera, mesh, visuals, textures, bvh } = options;

    this.world = new WorldScene(textures);
    this.world.setWorldMesh(mesh);
    this.world.setInstancedVisuals(visuals);
    // The decals the same payload carries, as the quads they are (#249). Before
    // the markers for the reason below: what is drawn first, what is left over
    // last.
    this.world.setDecals(visuals.decals);
    // After the visuals, because that is the order the two describe the same
    // world in: the instances are what is drawn, and the markers are what is
    // left over.
    this.world.setVobMarkers(options.vobIndex);
    scene.add(this.world.root);

    // Only what is pickable gets a tree, and off the main thread — or, when
    // this is a rebuild of the same world mesh, out of the builder's memory of
    // the last one rather than off the thread at all.
    const bvhReady = bvh.buildAll(
      this.world.worldMeshes.map((worldMesh) => worldMesh.geometry), mesh,
    );

    this.picker = new VobPicker();
    this.picker.setInstancedMeshes(
      this.world.instancedMeshes,
      (instanced, instance) => this.world.resolveInstance(instanced, instance),
      this.world.root.matrix,
    );
    this.picker.setWorldMeshes(this.world.worldMeshes, this.world.root.matrix);
    this.picker.warm(renderer, camera);

    const texturesReady = this.world.loadPendingTextures(
      (name) => options.loadTexture(name, TEXTURE_MAX_SIZE),
      () => this.disposed,
    ).then((failed) => {
      if (failed.length > 0 && !this.disposed) options.onTextureFailures(failed);
    });

    this.ready = Promise.all([bvhReady, texturesReady]).then(() => undefined);
  }

  /** The scene is being torn down: a pick or a decode still in flight must not
   *  answer into it. */
  isDisposed(): boolean {
    return this.disposed;
  }

  dispose(): void {
    this.disposed = true;
    this.picker.dispose();
    // Settled, not disposed: this scene's builds are abandoned, but the builder
    // and its trees belong to the viewport.
    this.options.bvh.settle();
    this.options.scene.remove(this.world.root);
    this.world.dispose();
  }
}
