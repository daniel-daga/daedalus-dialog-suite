// Viewport spike, half 2 of 2 (level-editor.md §3). Loads the payload extract.js
// wrote and answers the two budget rows that arithmetic could not: sustained
// framerate and pick latency. THROWAWAY — see extract.js.

import * as THREE from 'three';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const hud = document.getElementById('hud');
const say = (text) => { hud.textContent = text; };

const stat = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
  return {
    p50: +at(0.5).toFixed(3),
    p95: +at(0.95).toFixed(3),
    p99: +at(0.99).toFixed(3),
    max: +sorted[sorted.length - 1].toFixed(3),
  };
};

// ── payload ────────────────────────────────────────────────────────────────
say('fetching payload…');
const tFetch = performance.now();
const [manifest, pack] = await Promise.all([
  fetch('./payload/manifest.json').then((r) => r.json()),
  fetch('./payload/pack.bin').then((r) => r.arrayBuffer()),
]);
const fetchMs = performance.now() - tFetch;

const f32 = (ref) => new Float32Array(pack, ref.at, ref.bytes / 4);
const u32 = (ref) => new Uint32Array(pack, ref.at, ref.bytes / 4);
const u8 = (ref) => new Uint8Array(pack, ref.at, ref.bytes);

// ── scene ──────────────────────────────────────────────────────────────────
const tBuild = performance.now();
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x10141c);

// THE conversion, in one place — the spike's stand-in for zen-world/coords.
// ZenGin is left-handed and measures in centimetres, so the whole scene hangs
// under one node that negates X and scales to metres. Negating an axis is a
// mirror, and a mirror flips triangle handedness: it therefore also settles the
// winding, which is why §7 calls winding one decision for the projection layer
// rather than a per-mesh flag. The measurement said stored order reads
// *against* the stored normals in a right-handed basis; after the mirror it
// reads with them, so indices stay in stored order and every material below is
// FrontSide. If that reasoning were wrong the world would render inside-out —
// which is the point of not papering over it with DoubleSide.
const root = new THREE.Group();
root.scale.set(-0.01, 0.01, 0.01);
root.matrixAutoUpdate = false;
root.updateMatrix();
scene.add(root);

const textures = new Map();
for (const entry of manifest.textures) {
  const texture = new THREE.DataTexture(u8(entry.rgba), entry.width, entry.height);
  texture.format = THREE.RGBAFormat;
  texture.type = THREE.UnsignedByteType;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.flipY = true;
  texture.needsUpdate = true;
  textures.set(entry.name, texture);
}

// The baked ZenGin light word, decoded here rather than in the binding: the
// channel order is a rendering question (README, extractWorldMesh). zCOLOR is a
// DWORD 0xAARRGGBB, and the vertex-colour buffer three wants is linear.
const srgbToLinear = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  srgbToLinear[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
function vertexColors(words) {
  const out = new Float32Array(words.length * 3);
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    out[i * 3] = srgbToLinear[(w >>> 16) & 0xff];
    out[i * 3 + 1] = srgbToLinear[(w >>> 8) & 0xff];
    out[i * 3 + 2] = srgbToLinear[w & 0xff];
  }
  return out;
}

function buildGeometry(group, lit) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(f32(group.positions), 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(f32(group.normals), 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(f32(group.uvs), 2));
  if (lit) {
    geometry.setAttribute('color', new THREE.BufferAttribute(vertexColors(u32(group.lights)), 3));
  }
  geometry.setIndex(new THREE.BufferAttribute(u32(group.indices), 1));
  geometry.computeBoundingSphere();
  return geometry;
}

function buildMaterial(group, lit) {
  const material = new THREE.MeshBasicMaterial({
    map: textures.get(group.texture) ?? null,
    vertexColors: lit,
    side: THREE.FrontSide,
  });
  if (!group.texture) {
    material.color.setRGB(
      srgbToLinear[group.color[0]], srgbToLinear[group.color[1]], srgbToLinear[group.color[2]],
    );
  }
  // AlphaFunction: 1 NONE (cut-out), 2 BLEND, 3 ADD. Anything else is opaque.
  if (group.alphaFunc === 1) material.alphaTest = 0.5;
  if (group.alphaFunc === 2) { material.transparent = true; material.depthWrite = false; }
  if (group.alphaFunc === 3) {
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
  }
  return material;
}

const pickable = [];
for (const group of manifest.worldGroups) {
  const mesh = new THREE.Mesh(buildGeometry(group, true), buildMaterial(group, true));
  mesh.matrixAutoUpdate = false;
  root.add(mesh);
  pickable.push(mesh);
}
const worldMeshes = [...pickable];

const matrix = new THREE.Matrix4();
const instancedMeshes = [];
for (const visual of manifest.instanced) {
  const matrices = f32(visual.matrices);
  for (const group of visual.groups) {
    const mesh = new THREE.InstancedMesh(
      buildGeometry(group, false), buildMaterial(group, false), visual.count,
    );
    for (let i = 0; i < visual.count; i++) {
      const m = i * 12;
      matrix.set(
        matrices[m], matrices[m + 1], matrices[m + 2], matrices[m + 3],
        matrices[m + 4], matrices[m + 5], matrices[m + 6], matrices[m + 7],
        matrices[m + 8], matrices[m + 9], matrices[m + 10], matrices[m + 11],
        0, 0, 0, 1,
      );
      mesh.setMatrixAt(i, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.matrixAutoUpdate = false;
    mesh.computeBoundingSphere();
    root.add(mesh);
    instancedMeshes.push(mesh);
    pickable.push(mesh);
  }
}
const buildMs = performance.now() - tBuild;

// Rule 2 of §3: stock raycasting is linear over triangles and would stutter
// against 476k of them, so the world mesh gets a BVH — 352 of them, not 936.
// The first run built one for every instanced visual too and spent 545 ms on
// it; measured, a CPU raycast across those 584 InstancedMeshes still costs
// 12 ms a click, so they are GPU ID-picking's job and their trees are pure
// load-time cost. They are still built below, after the timing, so the
// whole-scene pick number stays comparable.
const tBvh = performance.now();
for (const mesh of worldMeshes) mesh.geometry.computeBoundsTree();
const bvhMs = performance.now() - tBvh;

const tBvhInstanced = performance.now();
for (const mesh of instancedMeshes) mesh.geometry.computeBoundsTree();
const bvhInstancedMs = performance.now() - tBvhInstanced;

// ── renderer ───────────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.5, 4000);
const bbox = manifest.bbox;
const centre = new THREE.Vector3(
  -(bbox[0] + bbox[3]) / 2, (bbox[1] + bbox[4]) / 2, (bbox[2] + bbox[5]) / 2,
).multiplyScalar(0.01);
const span = Math.max(bbox[3] - bbox[0], bbox[5] - bbox[2]) * 0.01;

const gl = renderer.getContext();
const dbg = gl.getExtension('WEBGL_debug_renderer_info');
const gpu = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown';

// A fixed path, so the number is a property of the scene and not of how the
// mouse was moved: a far orbit (the whole world in frustum, worst case for draw
// calls), a mid orbit, then a low pass through the middle at eye height.
const FRAMES = 900;
const WARMUP = 60;
function place(frame) {
  const t = frame / FRAMES;
  const leg = Math.floor(t * 3);
  const u = (t * 3) % 1;
  const angle = u * Math.PI * 2;
  if (leg === 0) {
    camera.position.set(
      centre.x + Math.cos(angle) * span * 0.75, centre.y + span * 0.45,
      centre.z + Math.sin(angle) * span * 0.75,
    );
    camera.lookAt(centre);
  } else if (leg === 1) {
    camera.position.set(
      centre.x + Math.cos(angle) * span * 0.28, centre.y + span * 0.12,
      centre.z + Math.sin(angle) * span * 0.28,
    );
    camera.lookAt(centre);
  } else {
    camera.position.set(
      centre.x + (u - 0.5) * span * 0.6, centre.y - span * 0.02,
      centre.z + Math.sin(u * Math.PI * 4) * span * 0.1,
    );
    camera.lookAt(centre.x + (u - 0.4) * span * 0.6, centre.y - span * 0.02, centre.z);
  }
}

// Two instruments, because the obvious one cannot be trusted here. Chrome
// suspends requestAnimationFrame in a tab that is not the foreground tab, which
// reports a 60fps renderer as a 1fps one; that is a property of the browser
// window, not of the scene. So the primary measurement is a synchronous sweep —
// render, then gl.finish() to wait for the GPU to actually be done — which
// runs at full speed regardless of tab state and includes GPU time. The rAF
// sweep runs afterwards as corroboration and is thrown away if it stalled.
async function sweepSynchronous() {
  const times = [];
  const calls = [];
  const tris = [];

  for (let f = 0; f < FRAMES; f++) {
    place(f);
    const t0 = performance.now();
    renderer.render(scene, camera);
    gl.finish();
    const dt = performance.now() - t0;

    if (f >= WARMUP) {
      times.push(dt);
      calls.push(renderer.info.render.calls);
      tris.push(renderer.info.render.triangles);
    }
    // Yield occasionally so the tab stays responsive and the watchdog quiet.
    if (f % 150 === 149) {
      say(`sync sweep ${f + 1}/${FRAMES}…`);
      console.log(`SPIKE_PROGRESS sync ${f + 1}/${FRAMES}`);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  return { times, calls, tris };
}

const frameMs = [];
const drawCalls = [];
const triangles = [];
let frame = 0;
let last = performance.now();

// A hidden tab gets its requestAnimationFrame throttled to about one call a
// second, which would produce a 1 fps verdict that says nothing about the
// renderer. The measurement therefore watches the page's own visibility and
// throws the run away rather than reporting a number it cannot stand behind.
let hidden = document.visibilityState !== 'visible';
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') hidden = true;
});

function measure() {
  place(frame);
  renderer.render(scene, camera);

  const now = performance.now();
  if (frame >= WARMUP) {
    frameMs.push(now - last);
    drawCalls.push(renderer.info.render.calls);
    triangles.push(renderer.info.render.triangles);
  }
  last = now;
  frame += 1;

  if (frame % 100 === 0) {
    say(`measuring frame ${frame}/${FRAMES}…`);
    console.log(`SPIKE_PROGRESS frame ${frame}/${FRAMES} focus=${document.hasFocus()} `
      + `visibility=${document.visibilityState}`);
  }
  if (frame < FRAMES) { requestAnimationFrame(measure); return; }
  done();
}

// The rAF sweep may never complete — a suspended tab simply stops calling back —
// so a timer, which keeps firing where rAF does not, ends the wait and reports
// what the synchronous sweep already measured.
let reported = false;
function done() {
  if (reported) return;
  reported = true;
  finish();
}

// Pick latency: a click is a ray, so this is the click-to-selection cost with
// nothing else in the way. Deterministic rays, half of them aimed at the middle
// of the screen where geometry actually is.
const raycaster = new THREE.Raycaster();
raycaster.firstHitOnly = true;
function pickLatency(targets, count) {
  const times = [];
  let hits = 0;
  let seed = 12345;
  const random = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const pointer = new THREE.Vector2();

  for (let i = 0; i < count; i++) {
    pointer.set((random() - 0.5) * (i % 2 ? 0.5 : 1.8), (random() - 0.5) * (i % 2 ? 0.5 : 1.8));
    const t0 = performance.now();
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(targets, false);
    times.push(performance.now() - t0);
    if (hit.length > 0) hits += 1;
  }
  return { ...stat(times), hits, rays: count };
}

function finish() {
  // A viewpoint inside the world, so the rays have something to hit.
  place(Math.floor(FRAMES * 0.7));
  renderer.render(scene, camera);

  const stalls = frameMs.filter((ms) => ms > 250).length;
  const driven = frameMs.filter((ms) => ms <= 250);
  const fps = (times) => ({
    mean: +(1000 / (times.reduce((a, b) => a + b, 0) / times.length)).toFixed(1),
    worst: +(1000 / Math.max(...times)).toFixed(1),
    framesOver16ms: times.filter((ms) => ms > 16.7).length,
    frames: times.length,
  });
  const summary = {
    world: manifest.world,
    gpu,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    scene: {
      ...manifest.stats,
      geometries: renderer.info.memory.geometries,
      programs: renderer.info.programs.length,
    },
    load: {
      // The data layer, phase by phase (extract.js).
      ...manifest.timings,
      extractMs: manifest.extractMs,
      mountedArchives: manifest.mountedArchives,
      // An artefact of the spike's HTTP hop; §7's architecture moves these
      // buffers as transferables over IPC and does not pay it.
      fetchMs: +fetchMs.toFixed(0),
      sceneBuildMs: +buildMs.toFixed(0),
      bvhBuildMs: +bvhMs.toFixed(0),
      bvhInstancedMs: +bvhInstancedMs.toFixed(0),
      totalMs: +(manifest.extractMs + fetchMs + buildMs + bvhMs).toFixed(0),
      totalWithoutTransferMs: +(manifest.extractMs + buildMs + bvhMs).toFixed(0),
    },
    // Primary: CPU submit + GPU execution per frame, measured with gl.finish().
    // Independent of tab state, and it excludes vsync — so it answers "can this
    // scene be drawn inside a 16.7 ms budget", not "was it presented at 60Hz".
    render: { frameMs: stat(sync.times), fps: fps(sync.times) },
    // Corroboration: real presented frames. A tab that is not the foreground
    // tab has its rAF suspended, which arrives as a handful of enormous dts —
    // so a run with stalls is reported, not silently averaged in.
    presented: {
      valid: stalls === 0 && !hidden,
      stalls,
      hiddenAtSomePoint: hidden,
      frameMs: driven.length > 0 ? stat(driven) : null,
      fps: driven.length > 0 ? fps(driven) : null,
    },
    drawCalls: stat(sync.calls),
    trianglesPerFrame: stat(sync.tris),
    pickWorldMesh: pickLatency(worldMeshes, 200),
    pickWholeScene: pickLatency(pickable, 200),
  };

  say(JSON.stringify(summary, null, 1));
  console.log('SPIKE_RESULT ' + JSON.stringify(summary));

  // Keep drawing so the scene can be looked at, and so a screenshot is of a
  // live frame rather than a corpse.
  let idle = Math.floor(FRAMES * 0.55);
  const spin = () => {
    place(idle = (idle + 1) % FRAMES);
    renderer.render(scene, camera);
    requestAnimationFrame(spin);
  };
  spin();
}

// Exposed so the scene can be interrogated from the console — the draw-call
// count is only believable once you can ask which objects it is counting.
window.__spike = { THREE, scene, camera, renderer, root, worldMeshes, instancedMeshes, place };

say('sync sweep…');
const sync = await sweepSynchronous();
console.log('SPIKE_SYNC_DONE ' + JSON.stringify({ frameMs: stat(sync.times), drawCalls: stat(sync.calls) }));

say('presented sweep…');
requestAnimationFrame(measure);
setTimeout(done, 30000);
