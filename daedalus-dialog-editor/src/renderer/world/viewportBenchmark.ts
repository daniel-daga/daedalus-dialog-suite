// Measuring the app's own viewport (level-editor.md §3).
//
// Framerate, draw calls per frame and pick latency were answered by
// `zenkit-node/spike/viewport/` against a scene the app did not own. This is
// the same sweep, driven through `WorldViewport`'s real scene, real picker and
// real BVH — so the spike's numbers finally have something to be compared
// against, and can then be deleted.
//
// Two instruments, for the reason the spike documented and then proved twice:
//
//   1. A synchronous sweep — render, then `gl.finish()` to wait for the GPU to
//      actually be done. It is the primary number because it runs at full speed
//      regardless of tab state and includes GPU time. It excludes vsync, so it
//      answers "can this frame be drawn inside the budget", not "was it
//      presented at 60 Hz".
//   2. A rAF sweep, as corroboration, which reports itself void rather than
//      averaging in a stall. Chrome suspends `requestAnimationFrame` outside
//      the foreground tab and would report any renderer as a 1 fps one.
//
// And one guard over both, which is what the rAF corroboration cost us to
// learn: a background tab does not only suspend rAF, it deprioritises the whole
// renderer process, so *every* CPU-bound number here is ~3x pessimistic there.
// `gl.finish()` was immune because it is GPU-bound, which is exactly why it was
// chosen and exactly why it hid this. The report therefore carries whether the
// window held focus throughout, and a run that did not is `valid: false` — the
// numbers are still reported, because deliberately backgrounding a run is how
// the A/B gets done.

/** The spike's counts, kept identical so the two reports compare directly. */
export const BENCHMARK_FRAMES = 900;
export const BENCHMARK_WARMUP = 60;
export const BENCHMARK_RAYS = 200;

/** A presented gap this large is a suspended tab, not a slow frame. */
const STALL_MS = 250;

/** The rAF sweep may never call back; this ends the wait. */
const PRESENTED_TIMEOUT_MS = 30_000;

export interface CameraPose {
  position: [number, number, number];
  lookAt: [number, number, number];
}

/** What the benchmark needs of a live viewport. Deliberately free of Three.js:
 *  everything below is testable without a GPU, and the component supplies the
 *  four lines that are not. */
export interface ViewportProbe {
  moveCamera(pose: CameraPose): void;
  render(): void;
  /** Block until the GPU has finished the frame just submitted. */
  finishGpu(): void;
  drawCalls(): number;
  triangles(): number;
  // Each pick returns whether it hit anything. A ray that hits nothing is
  // rejected by a bounding sphere and costs almost nothing, so an unreported
  // miss rate turns "the camera was pointing at the sky" into a fast pick.
  /** A ray through the world mesh's BVH — the app's terrain pick. */
  raycastWorldMesh(ndcX: number, ndcY: number): boolean;
  /** The same ray against every mesh in the scene — the alternative to GPU
   *  ID-picking, kept because it is the number §3's decision 1 rests on. */
  raycastWholeScene(ndcX: number, ndcY: number): boolean;
  /** The app's actual prop pick: one draw pass into a 1x1 buffer. */
  pickVobs(ndcX: number, ndcY: number): boolean;
  viewportSize(): { width: number; height: number };
}

export interface BenchmarkEnv {
  now(): number;
  requestFrame(callback: () => void): void;
  setTimer(callback: () => void, ms: number): void;
  visible(): boolean;
  focused(): boolean;
  yieldToBrowser(): Promise<void>;
}

export interface Stat { p50: number; p95: number; p99: number; max: number }
/** A pick sweep is only a latency if the rays hit something — hence `hits`. */
export interface PickStat extends Stat { hits: number; rays: number }
export interface Fps { mean: number; worst: number; framesOver16ms: number; frames: number }

export interface BenchmarkResult {
  viewport: string;
  frames: number;
  warmup: number;
  /** True only if every CPU-bound number below was taken in the foreground. */
  valid: boolean;
  foreground: { focusedThroughout: boolean; visibleThroughout: boolean };
  render: { frameMs: Stat; fps: Fps };
  presented: {
    valid: boolean;
    stalls: number;
    hiddenAtSomePoint: boolean;
    /** The presented interval is bounded by vsync rather than by the renderer:
     *  the renderer finishes a frame faster than the display shows one. When
     *  this is true, `framesOver16ms` on this series measures the panel. */
    displayBound: boolean;
    frameMs: Stat | null;
    fps: Fps | null;
  };
  drawCalls: Stat;
  trianglesPerFrame: Stat;
  pickWorldMesh: PickStat;
  pickWholeScene: PickStat;
  pickVobs: PickStat;
}

export interface BenchmarkOptions {
  /** The world's centre and extent, in Three.js space — the path is framed from
   *  them, and there is deliberately no default: a camera path around a
   *  placeholder box measures a view of nothing while still returning numbers. */
  centre: readonly [number, number, number];
  span: number;
  frames?: number;
  warmup?: number;
  rays?: number;
}

/**
 * A fixed three-leg path: a far orbit with the whole world in frustum (the
 * worst case for draw calls), a mid orbit, then a low pass through the middle
 * at eye height.
 *
 * Fixed because the alternative is measuring how the mouse was moved. The
 * spike's first run reported a flat 505 draw calls in all 840 frames — the
 * camera had never moved, because the world it framed from reported a bbox of
 * all zeros.
 */
export function cameraPose(
  frame: number,
  frames: number,
  centre: readonly [number, number, number],
  span: number,
): CameraPose {
  const t = frame / frames;
  const leg = Math.floor(t * 3);
  const u = (t * 3) % 1;
  const angle = u * Math.PI * 2;
  const [cx, cy, cz] = centre;

  if (leg === 0) {
    return {
      position: [cx + Math.cos(angle) * span * 0.75, cy + span * 0.45, cz + Math.sin(angle) * span * 0.75],
      lookAt: [cx, cy, cz],
    };
  }
  if (leg === 1) {
    return {
      position: [cx + Math.cos(angle) * span * 0.28, cy + span * 0.12, cz + Math.sin(angle) * span * 0.28],
      lookAt: [cx, cy, cz],
    };
  }
  return {
    position: [cx + (u - 0.5) * span * 0.6, cy - span * 0.02, cz + Math.sin(u * Math.PI * 4) * span * 0.1],
    lookAt: [cx + (u - 0.4) * span * 0.6, cy - span * 0.02, cz],
  };
}

/**
 * Deterministic pick rays in NDC. Every other ray is aimed at the middle of the
 * screen, where geometry actually is — a sweep of uniformly random NDC mostly
 * hits sky and would measure the empty case.
 */
export function pickRays(count: number): Array<[number, number]> {
  let seed = 12345;
  const random = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

  const rays: Array<[number, number]> = [];
  for (let i = 0; i < count; i++) {
    const spread = i % 2 ? 0.5 : 1.8;
    rays.push([(random() - 0.5) * spread, (random() - 0.5) * spread]);
  }
  return rays;
}

function stat(values: readonly number[]): Stat {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
  return {
    p50: +at(0.5).toFixed(3),
    p95: +at(0.95).toFixed(3),
    p99: +at(0.99).toFixed(3),
    max: +sorted[sorted.length - 1].toFixed(3),
  };
}

function fps(times: readonly number[]): Fps {
  const mean = times.reduce((a, b) => a + b, 0) / times.length;
  return {
    mean: +(1000 / mean).toFixed(1),
    worst: +(1000 / Math.max(...times)).toFixed(1),
    framesOver16ms: times.filter((ms) => ms > 16.7).length,
    frames: times.length,
  };
}

export async function runViewportBenchmark(
  probe: ViewportProbe,
  env: BenchmarkEnv,
  options: BenchmarkOptions,
): Promise<BenchmarkResult> {
  const frames = options.frames ?? BENCHMARK_FRAMES;
  const warmup = options.warmup ?? BENCHMARK_WARMUP;
  const rays = pickRays(options.rays ?? BENCHMARK_RAYS);

  const { width, height } = probe.viewportSize();
  const place = (frame: number) =>
    probe.moveCamera(cameraPose(frame, frames, options.centre, options.span));

  // The guard runs across the whole benchmark, not only the rAF half.
  let focusedThroughout = env.focused();
  let visibleThroughout = env.visible();
  const observe = () => {
    if (!env.focused()) focusedThroughout = false;
    if (!env.visible()) visibleThroughout = false;
  };

  // ── the synchronous sweep ────────────────────────────────────────────────
  const syncTimes: number[] = [];
  const syncCalls: number[] = [];
  const syncTriangles: number[] = [];

  for (let frame = 0; frame < frames; frame++) {
    place(frame);
    const start = env.now();
    probe.render();
    probe.finishGpu();
    const elapsed = env.now() - start;

    if (frame >= warmup) {
      syncTimes.push(elapsed);
      syncCalls.push(probe.drawCalls());
      syncTriangles.push(probe.triangles());
    }
    if (frame % 150 === 149) {
      observe();
      await env.yieldToBrowser();
    }
  }
  observe();

  // ── the rAF corroboration ────────────────────────────────────────────────
  const presentedTimes: number[] = [];
  let hidden = !env.visible();

  await new Promise<void>((resolve) => {
    let finished = false;
    const done = () => { if (!finished) { finished = true; resolve(); } };

    let frame = 0;
    let last = env.now();
    const step = () => {
      place(frame);
      probe.render();

      const now = env.now();
      if (frame >= warmup) presentedTimes.push(now - last);
      last = now;
      frame += 1;

      if (!env.visible()) hidden = true;
      observe();

      if (frame < frames) { env.requestFrame(step); return; }
      done();
    };

    // The timer keeps firing where rAF does not, so a suspended tab ends the
    // run with the synchronous numbers rather than hanging on it.
    env.setTimer(done, PRESENTED_TIMEOUT_MS);
    env.requestFrame(step);
  });

  const stalls = presentedTimes.filter((ms) => ms > STALL_MS).length;
  const driven = presentedTimes.filter((ms) => ms <= STALL_MS);
  const presentedValid = stalls === 0 && !hidden && driven.length > 0;

  // ── pick latency, the same rays through each mechanism ───────────────────
  // From a viewpoint inside the world, so the rays have something to hit. The
  // sweep leaves the camera wherever its last frame put it, which on the first
  // real run was aimed at nothing and made a whole-scene raycast look 56x
  // faster than the spike measured it.
  place(Math.floor(frames * 0.7));
  probe.render();

  const measure = (run: (x: number, y: number) => boolean): PickStat => {
    const times: number[] = [];
    let hits = 0;
    for (const [x, y] of rays) {
      const start = env.now();
      if (run(x, y)) hits += 1;
      times.push(env.now() - start);
    }
    return { ...stat(times), hits, rays: rays.length };
  };

  const pickWorldMesh = measure((x, y) => probe.raycastWorldMesh(x, y));
  const pickWholeScene = measure((x, y) => probe.raycastWholeScene(x, y));
  const pickVobs = measure((x, y) => probe.pickVobs(x, y));
  observe();

  return {
    viewport: `${width}x${height}`,
    frames,
    warmup,
    // `presented.valid` is part of the guard, not just corroboration. Measured:
    // a minimised Electron window reports `hasFocus() === true` and
    // `visibilityState === 'visible'` while Chromium throttles it anyway — the
    // run that established this delivered no rAF callback at all in 30 s and
    // was 2.4x slower on every CPU-bound number, with both of those signals
    // clean. Frames that were actually presented are the only evidence the
    // renderer was not deprioritised.
    valid: focusedThroughout && visibleThroughout && presentedValid,
    foreground: { focusedThroughout, visibleThroughout },
    render: { frameMs: stat(syncTimes), fps: fps(syncTimes) },
    presented: {
      valid: presentedValid,
      stalls,
      hiddenAtSomePoint: hidden,
      // Measured on one machine hours apart: the panel dropped from 168 Hz to
      // 53 Hz and 810 of 840 presented frames crossed 16.7 ms while the
      // renderer never exceeded 12. Only the synchronous series is a verdict
      // on the renderer; this says when the other one is about the display.
      displayBound: driven.length > 0 && stat(syncTimes).p95 < stat(driven).p50,
      frameMs: driven.length > 0 ? stat(driven) : null,
      fps: driven.length > 0 ? fps(driven) : null,
    },
    drawCalls: stat(syncCalls),
    trianglesPerFrame: stat(syncTriangles),
    pickWorldMesh,
    pickWholeScene,
    pickVobs,
  };
}
