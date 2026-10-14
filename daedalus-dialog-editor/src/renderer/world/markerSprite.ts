import * as THREE from 'three';

// The shapes the world's point markers draw (level-editor.md §6).
//
// A `PointsMaterial` with no map draws a flat square in the material's colour,
// which is what every marker layer here used to be: the placement point, the
// orbit pivot, the spawns. At the sizes those are drawn — 6 to 16 pixels, over
// terrain of any brightness — a square reads as a smudge, and two of them
// sitting on the same waypoint read as one.
//
// So: a round pip with a black rim, and a reticle for the two markers that name
// a *point* rather than a thing. The rim is the part that matters — the world
// behind a marker is sunlit rock as often as it is cave floor, and a coloured
// dot with no outline disappears into one of the two.
//
// **The mask is white-on-black, and that is load-bearing.** `map` is multiplied
// into `material.color`, so white texels take the layer's colour unchanged and
// black ones stay black whatever colour the layer picked. Every layer keeps the
// colour it had; only the shape changed.
//
// Built as a `DataTexture` rather than drawn on a canvas: the renderer suites
// run in jsdom, which has no 2D context, so a canvas sprite would be silently
// blank in exactly the environment that tests it.

/** Power of two, and far more than the ~16 pixels a marker is drawn at: the
 *  mip chain does the shrinking, and a sprite built at its drawn size is
 *  aliased at every other one. */
const SIZE = 64;

/** How wide an edge fades, in the 0..1 radius the shapes are written in. Three
 *  half-texels — enough that a curve is smooth, little enough that a rim two
 *  texels thick is still black in the middle. */
const FEATHER = 1.5 / (SIZE / 2);

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Coverage of a disc of `radius`, soft at the edge. */
const disc = (r: number, radius: number): number => 1 - smoothstep(radius - FEATHER, radius + FEATHER, r);

/** Coverage of a ring between `inner` and `outer`. */
const annulus = (r: number, inner: number, outer: number): number =>
  smoothstep(inner - FEATHER, inner + FEATHER, r) * disc(r, outer);

/**
 * A shape, as two coverages at a normalized coordinate in the sprite:
 * `light` is the marker's own colour, `dark` the rim under it.
 */
type Shape = (radius: number, x: number, y: number) => { dark: number; light: number };

function build(shapes: readonly Shape[]): THREE.DataTexture {
  const width = SIZE * shapes.length;
  const data = new Uint8Array(width * SIZE * 4);
  const half = SIZE / 2;

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = (x + 0.5) / half - 1;
      const dy = (y + 0.5) / half - 1;
      for (let tile = 0; tile < shapes.length; tile++) {
        const { dark, light } = shapes[tile](Math.hypot(dx, dy), dx, dy);

        // The light sits on top of the dark, so the texel is as opaque as the
        // wider of the two and as white as the light's share of that.
        const alpha = Math.max(dark, light);
        const at = (y * width + tile * SIZE + x) * 4;
        const value = alpha > 0 ? Math.round(255 * (light / alpha)) : 0;
        data[at] = value;
        data[at + 1] = value;
        data[at + 2] = value;
        data[at + 3] = Math.round(255 * alpha);
      }
    }
  }

  const texture = new THREE.DataTexture(data, width, SIZE, THREE.RGBAFormat);
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

/** A filled pip: colour to 0.58, black rim to 0.86. */
const dot: Shape = (r) => ({ dark: disc(r, 0.86), light: disc(r, 0.58) });

/** A centre dot inside a ring, both rimmed — the gap is what keeps the point
 *  being marked visible through the thing marking it. */
const reticle: Shape = (r) => ({
  dark: Math.max(disc(r, 0.3), annulus(r, 0.46, 0.92)),
  light: Math.max(disc(r, 0.16), annulus(r, 0.6, 0.78)),
});

/** Rim a signed-distance silhouette without changing its marker colour. */
const silhouette = (distance: number) => ({
  dark: 1 - smoothstep(-FEATHER, FEATHER, distance),
  light: 1 - smoothstep(-FEATHER, FEATHER, distance + 0.08),
});

const sun: Shape = (r, x, y) => {
  const axial = Math.max(Math.min(Math.abs(x), Math.abs(y)) - 0.1,
    Math.max(Math.abs(x), Math.abs(y)) - 0.86);
  const diagonal = Math.max(Math.abs(Math.abs(x) - Math.abs(y)) / Math.SQRT2 - 0.1, r - 0.86);
  return silhouette(Math.min(r - 0.42, axial, diagonal));
};
const diamond: Shape = (_r, x, y) => silhouette((Math.abs(x) + Math.abs(y) - 0.86) / Math.SQRT2);
// One texture per shape for the whole app. Every marker layer disposes its own
// material — which does *not* dispose the map — so these outlive any one layer
// on purpose: rebuilt per marker they would be a fresh GPU upload on every
// placement click, and disposed by a layer they would blank every other one.
let dotTexture: THREE.DataTexture | null = null;
let reticleTexture: THREE.DataTexture | null = null;
let atlasTexture: THREE.DataTexture | null = null;

/** The pip the spawn markers draw. Shared — do not dispose it. */
export function markerDotTexture(): THREE.DataTexture {
  return (dotTexture ??= build([dot]));
}

/** The reticle the placement and pivot markers draw. Shared — do not dispose it. */
export function markerReticleTexture(): THREE.DataTexture {
  return (reticleTexture ??= build([reticle]));
}

/** Round, sun, diamond, reticle — shared across marker layers. */
export function markerAtlasTexture(): THREE.DataTexture {
  return (atlasTexture ??= build([dot, sun, diamond, reticle]));
}

/** Select an atlas tile per point. */
export function styleMarkerMaterial(material: THREE.PointsMaterial): void {
  material.map = markerAtlasTexture();
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = `attribute float markerShape;
varying float vMarkerShape;
${shader.vertexShader}`.replace('#include <begin_vertex>', `#include <begin_vertex>
vMarkerShape = markerShape;`);
    shader.fragmentShader = `varying float vMarkerShape;
${shader.fragmentShader}`.replace('#include <map_particle_fragment>', `
vec2 spriteUv = vec2(gl_PointCoord.x, 1.0 - gl_PointCoord.y);
spriteUv.x = (spriteUv.x + vMarkerShape) / 4.0;
diffuseColor *= texture2D(map, spriteUv);`);
  };
  material.customProgramCacheKey = () => 'marker-shape-v2';
}
