import * as THREE from 'three';
import { WORLD_LAYER } from './WorldScene';

// The VOB outline: a thin bright line along the edge of every VOB, drawn in
// screen space (level-editor.md §16.12).
//
// The world pass writes two attachments — the picture, and a mask that says
// "a VOB is here, this one, selected or not" (`WorldScene`'s `maskVobs`). This
// draws one full-screen quad that reads the mask at a pixel and its four
// neighbours and paints the line, one pixel wide, wherever a neighbour is
// "more VOB" than the pixel — the outside of every edge. Everything about the
// line that a rim term could not do falls out of reading the picture: a box's
// hard edge is a mask step, a billboard's silhouette is where its cut-out
// stopped writing, and a VOB behind another is still a different key.
//
// What it costs is what the viewport's budget is written in (§3): one draw
// call, not one per visual — the mask rides the draws that exist. The world
// is drawn into a target instead of the canvas, which is a full-screen copy
// per frame, and the target's depth is written back by the quad so the
// overlays that follow it — gizmo, waynet, markers — are occluded by the
// world exactly as before.
//
// The frame is drawn in two halves through the camera's layers: the world's
// geometry sits on `WORLD_LAYER`, everything else on 0. That is the one
// obligation this places on the rest of the viewport — a raycaster that
// wants the world enables the layer, and the camera is handed back seeing
// everything, so a pick between frames is unaffected.

/** The line around an unselected VOB. Bright and cool, so it reads against
 *  the ground and the sky alike, and never the gizmo's red, green or blue. */
export const OUTLINE_COLOR: readonly [number, number, number] = [0.92, 0.96, 1.0];

/** The line around a selected VOB — `WorldScene`'s body tint, as a line. */
export const SELECT_COLOR: readonly [number, number, number] = [1.0, 0.55, 0.12];

/** How much of the line replaces the pixel under it. A legibility aid, not a
 *  selection state: at full strength the first look (Daniel, 2026-09-01) read
 *  it as "very bright", so it lets the picture through. */
export const OUTLINE_OPACITY = 0.55;

/** The selection line is the selection, and does not let anything through. */
export const SELECT_OPACITY = 1.0;

/** What separates two ranks: the key is one byte, so anything under a
 *  half-step is the same VOB. */
const RANK_STEP = 0.001;

const EMPTY_MASK = new Float32Array([0, 0, 0, 0]);

const VERTEX = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4( position.xy, 0.0, 1.0 );
}
`;

const FRAGMENT = /* glsl */`
uniform sampler2D tColor;
uniform sampler2D tMask;
uniform sampler2D tDepth;
uniform vec2 uTexel;
uniform vec3 uOutlineColor;
uniform vec3 uSelectColor;
varying vec2 vUv;
layout(location = 0) out highp vec4 fragColor;

// The mask as one number, so that "which side of the edge is the outside"
// has an answer: nothing < a VOB < a selected VOB, and between two VOBs the
// one with the higher key. The line is drawn on the *lower* side.
float rank( vec4 mask ) {
  return mask.r + 0.5 * mask.g + 2.0 * mask.b;
}

void main() {
  float mine = rank( texture( tMask, vUv ) );
  float top = max(
    max( rank( texture( tMask, vUv - vec2( uTexel.x, 0.0 ) ) ), rank( texture( tMask, vUv + vec2( uTexel.x, 0.0 ) ) ) ),
    max( rank( texture( tMask, vUv - vec2( 0.0, uTexel.y ) ) ), rank( texture( tMask, vUv + vec2( 0.0, uTexel.y ) ) ) )
  );

  // One pixel wide, on the outside: this pixel is the line when a neighbour
  // outranks it. So the border sits on what a VOB stands in front of, never
  // on the VOB — and a selected VOB's border is drawn onto its neighbours in
  // the selection colour, an unselected VOB's onto the world in the other.
  vec3 colour = texture( tColor, vUv ).rgb;
  if ( top > mine + ${RANK_STEP} ) {
    float selected = step( 2.5, top );
    colour = mix(
      colour,
      mix( uOutlineColor, uSelectColor, selected ),
      mix( ${OUTLINE_OPACITY.toFixed(2)}, ${SELECT_OPACITY.toFixed(2)}, selected )
    );
  }

  // Drawn linear into the target; the canvas wants the renderer's output
  // encoding, which a ShaderMaterial does not apply on its own.
  fragColor = linearToOutputTexel( vec4( colour, 1.0 ) );
  // The world's depth, back into the canvas for the overlays drawn after this.
  gl_FragDepth = texture( tDepth, vUv ).r;
}
`;

export class VobOutline {
  /** Colour on 0, the mask on 1, and the depth the composite writes back. */
  readonly target: THREE.WebGLRenderTarget;

  /** The one full-screen draw. */
  readonly quad = new THREE.Scene();

  private readonly quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly material: THREE.ShaderMaterial;
  private readonly geometry = new THREE.PlaneGeometry(2, 2);
  private readonly background: THREE.Color;

  constructor(background: THREE.ColorRepresentation) {
    this.background = new THREE.Color(background);
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      count: 2,
      depthBuffer: true,
      depthTexture: new THREE.DepthTexture(1, 1),
      // The target is the canvas's size, sampled 1:1, and the mask is an id:
      // a filtered key would invent an edge wherever two keys blended.
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      generateMipmaps: false,
    });
    // Stored encoded, so eight bits do not band the darks. The world is drawn
    // linear into it, and the composite reads linear back.
    this.target.textures[0].colorSpace = THREE.SRGBColorSpace;
    this.target.textures[1].colorSpace = THREE.NoColorSpace;

    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        tColor: { value: this.target.textures[0] },
        tMask: { value: this.target.textures[1] },
        tDepth: { value: this.target.depthTexture },
        uTexel: { value: new THREE.Vector2(1, 1) },
        uOutlineColor: { value: new THREE.Color(...OUTLINE_COLOR) },
        uSelectColor: { value: new THREE.Color(...SELECT_COLOR) },
      },
      // A depth write only happens with the test enabled, so the test is on
      // and always passes: the quad is the whole canvas and writes every pixel.
      depthTest: true,
      depthWrite: true,
      depthFunc: THREE.AlwaysDepth,
    });
    const mesh = new THREE.Mesh(this.geometry, this.material);
    mesh.frustumCulled = false;
    this.quad.add(mesh);
  }

  setSize(width: number, height: number): void {
    this.target.setSize(width, height);
    this.material.uniforms.uTexel.value.set(1 / width, 1 / height);
  }

  /** One frame: the world into the target, the composite, the rest on top. */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): void {
    // Every clear below is explicit. A `scene.background` would force one
    // inside `render()`, after the mask was emptied.
    renderer.autoClear = false;
    const gl = renderer.getContext() as WebGL2RenderingContext;

    renderer.setRenderTarget(this.target);
    renderer.setClearColor(this.background, 1);
    // ...which paints *both* attachments with the sky, so the mask is emptied
    // on its own afterwards: only attachment 1, to zero.
    renderer.clear();
    gl.clearBufferfv(gl.COLOR, 1, EMPTY_MASK);
    camera.layers.set(WORLD_LAYER);
    renderer.render(scene, camera);

    renderer.setRenderTarget(null);
    renderer.render(this.quad, this.quadCamera);

    camera.layers.set(0);
    renderer.render(scene, camera);
    camera.layers.enableAll();
  }

  dispose(): void {
    this.target.dispose();
    this.material.dispose();
    this.geometry.dispose();
  }
}
