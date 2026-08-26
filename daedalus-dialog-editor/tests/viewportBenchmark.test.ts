/**
 * The viewport measurement, tested without a GPU (level-editor.md §3, step 1 of
 * the Phase 1a follow-ups).
 *
 * The spike answered framerate and pick latency for a scene the app did not
 * own. Measuring the app's own viewport means running the same sweep against
 * `WorldViewport`, and everything about that sweep that can be wrong *silently*
 * lives here rather than in the component:
 *
 *   - the camera path, because a number is only a property of the scene if the
 *     camera moved the same way (the spike's first run reported a flat 505 draw
 *     calls because it never moved at all)
 *   - `gl.finish()` inside the timed region, because without it the number is
 *     CPU submit time and the GPU is measured not at all
 *   - the rAF corroboration reporting itself void, because a backgrounded tab
 *     suspends rAF and would report any renderer as a 1 fps one
 *   - the foreground guard on *every* CPU-bound number, which is the rule the
 *     rAF corroboration cost us: Chrome deprioritises the whole renderer
 *     process in a background tab, and that is how 14.2 ms, 591 ms and 159 ms
 *     were all written down as facts when they were ~3x pessimistic
 *
 * @jest-environment jsdom
 */

import {
  BENCHMARK_FRAMES,
  BENCHMARK_WARMUP,
  cameraPose,
  pickRays,
  runViewportBenchmark,
  type BenchmarkEnv,
  type CameraPose,
  type ViewportProbe,
} from '../src/renderer/world/viewportBenchmark';

const CENTRE: [number, number, number] = [10, 20, 30];
const SPAN = 100;

/** A clock the test advances by hand, so no measurement depends on wall time. */
class FakeClock {
  t = 0;
  now = () => this.t;
  advance(ms: number) { this.t += ms; }
}

interface ProbeCosts {
  render?: number;
  finishGpu?: number;
  raycastWorldMesh?: number;
  raycastWholeScene?: number;
  /** What the prop pick costs the main thread: the draw pass and the readback's
   *  submission, everything before the fence is waited on. */
  pickVobsBlocking?: number;
  /** What the GPU fence then costs in wall clock, spent suspended. */
  pickVobsFence?: number;
}

/** A probe that charges the clock for each call, and records what it was asked. */
function fakeProbe(clock: FakeClock, costs: ProbeCosts = {}) {
  const calls = {
    placed: [] as CameraPose[],
    rendered: 0,
    finished: 0,
    worldMeshRays: [] as Array<[number, number]>,
    wholeSceneRays: [] as Array<[number, number]>,
    vobPicks: [] as Array<[number, number]>,
    finishedBeforeRender: 0,
  };
  let renderedSinceFinish = 0;

  const probe: ViewportProbe = {
    moveCamera: (pose) => { calls.placed.push(pose); },
    render: () => { calls.rendered += 1; renderedSinceFinish += 1; clock.advance(costs.render ?? 1); },
    finishGpu: () => {
      if (renderedSinceFinish === 0) calls.finishedBeforeRender += 1;
      renderedSinceFinish = 0;
      calls.finished += 1;
      clock.advance(costs.finishGpu ?? 0);
    },
    drawCalls: () => 961,
    triangles: () => 2_740_000,
    raycastWorldMesh: (x, y) => {
      calls.worldMeshRays.push([x, y]);
      clock.advance(costs.raycastWorldMesh ?? 0.2);
      return calls.worldMeshRays.length % 2 === 1;
    },
    raycastWholeScene: (x, y) => {
      calls.wholeSceneRays.push([x, y]);
      clock.advance(costs.raycastWholeScene ?? 5.6);
      return true;
    },
    // Asynchronous, like the real one: the draw pass and the readback's
    // submission are synchronous, then the fence is awaited off the main thread.
    pickVobs: async (x, y) => {
      calls.vobPicks.push([x, y]);
      clock.advance(costs.pickVobsBlocking ?? 0.4);
      // A timer, like the real fence poll — so anything else the event loop is
      // holding gets its turn in the middle of the pick sweep, as it does in
      // the app.
      await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
      clock.advance(costs.pickVobsFence ?? 0);
      return false;
    },
    viewportSize: () => ({ width: 1463, height: 780 }),
  };
  return { probe, calls };
}

interface EnvOptions {
  /** Milliseconds the clock advances between two presented frames. */
  frameGap?: number | ((frame: number) => number);
  visibleAfter?: number;
  focusedAfter?: number;
  /** Stop calling back after this many rAF callbacks, as a suspended tab does. */
  framesBeforeSuspend?: number;
  /** Deliver the suspended callbacks late, after the timer has already ended
   *  the run — which is what a window being restored, or Chromium deciding to
   *  composite once, actually does. */
  resumeAfterTimeout?: boolean;
}

function fakeEnv(clock: FakeClock, options: EnvOptions = {}) {
  let rafCount = 0;
  const timers: Array<{ cb: () => void; at: number }> = [];
  const suspended: Array<() => void> = [];

  const env: BenchmarkEnv = {
    now: clock.now,
    requestFrame: (cb) => {
      rafCount += 1;
      if (options.framesBeforeSuspend !== undefined && rafCount > options.framesBeforeSuspend) {
        // A suspended tab simply stops calling back. The timer below is what
        // has to end the run instead.
        suspended.push(cb);
        return;
      }
      const gap = typeof options.frameGap === 'function'
        ? options.frameGap(rafCount)
        : options.frameGap ?? 6;
      queueMicrotask(() => { clock.advance(gap); cb(); });
    },
    // A real timer keeps firing where rAF does not, so this one must too — it
    // is the only thing that ends a run in a suspended tab. Microtask-driven
    // rAF drains first, so a healthy run still completes on its own frames.
    setTimer: (cb, ms) => {
      timers.push({ cb, at: clock.t + ms });
      setTimeout(() => {
        // Deliberately without advancing the clock: a timer firing does not
        // make time jump, and this one can now land in the middle of the pick
        // sweep, where a 30 s jump would be charged to whichever ray was
        // waiting on its fence.
        cb();
        if (options.resumeAfterTimeout) {
          setTimeout(() => { for (const late of suspended.splice(0)) late(); }, 0);
        }
      }, 0);
    },
    visible: () => options.visibleAfter === undefined || rafCount < options.visibleAfter,
    focused: () => options.focusedAfter === undefined || rafCount < options.focusedAfter,
    yieldToBrowser: () => new Promise<void>((resolve) => {
      // Fire any timer that has come due, the way a real event loop would.
      queueMicrotask(() => {
        for (const timer of timers.splice(0)) if (clock.t >= timer.at) timer.cb();
        resolve();
      });
    }),
  };
  return { env, fireTimers: () => { for (const t of timers.splice(0)) t.cb(); } };
}

const SMALL = { centre: CENTRE, span: SPAN, frames: 20, warmup: 5, rays: 8 };

describe('the camera path', () => {
  it('is a fixed three-leg path, so a frame number always means the same view', () => {
    const first = cameraPose(300, 900, CENTRE, SPAN);
    const again = cameraPose(300, 900, CENTRE, SPAN);
    expect(again).toEqual(first);
  });

  it('orbits far, then close, then passes through at eye height', () => {
    // Leg 1 — the whole world in frustum, which is the worst case for draw
    // calls and the reason the number is taken here at all.
    const far = cameraPose(0, 900, CENTRE, SPAN);
    expect(Math.hypot(far.position[0] - CENTRE[0], far.position[2] - CENTRE[2]))
      .toBeCloseTo(SPAN * 0.75, 5);
    expect(far.position[1]).toBeCloseTo(CENTRE[1] + SPAN * 0.45, 5);
    expect(far.lookAt).toEqual(CENTRE);

    // Leg 2 — a mid orbit.
    const mid = cameraPose(300, 900, CENTRE, SPAN);
    expect(Math.hypot(mid.position[0] - CENTRE[0], mid.position[2] - CENTRE[2]))
      .toBeCloseTo(SPAN * 0.28, 5);
    expect(mid.position[1]).toBeCloseTo(CENTRE[1] + SPAN * 0.12, 5);

    // Leg 3 — below the centre, looking along the pass rather than at the
    // centre, so the near field is what fills the frame.
    const low = cameraPose(600, 900, CENTRE, SPAN);
    expect(low.position[1]).toBeCloseTo(CENTRE[1] - SPAN * 0.02, 5);
    expect(low.lookAt).not.toEqual(CENTRE);
  });

  it('actually moves — every leg reaches a different place', () => {
    const seen = new Set<string>();
    for (let frame = 0; frame < 900; frame += 30) {
      seen.add(cameraPose(frame, 900, CENTRE, SPAN).position.join(','));
    }
    expect(seen.size).toBe(30);
  });
});

describe('the pick rays', () => {
  it('are deterministic, so two runs compare', () => {
    expect(pickRays(50)).toEqual(pickRays(50));
  });

  it('aim half of the rays at the middle of the screen, where geometry is', () => {
    const rays = pickRays(200);
    expect(rays).toHaveLength(200);
    // Odd rays are the tight ones: a sweep of purely random NDC mostly hits sky
    // and would measure the empty case.
    for (let i = 1; i < rays.length; i += 2) {
      expect(Math.abs(rays[i][0])).toBeLessThanOrEqual(0.25);
      expect(Math.abs(rays[i][1])).toBeLessThanOrEqual(0.25);
    }
    expect(rays.some(([x]) => Math.abs(x) > 0.25)).toBe(true);
  });
});

describe('the synchronous sweep', () => {
  it('drives the whole path and measures every frame after the warm-up', async () => {
    const clock = new FakeClock();
    const { probe, calls } = fakeProbe(clock);
    const { env } = fakeEnv(clock, { framesBeforeSuspend: 0 });

    const result = await runViewportBenchmark(probe, env, SMALL);

    // Every frame is drawn; only the post-warm-up ones are counted.
    expect(calls.rendered).toBeGreaterThanOrEqual(SMALL.frames);
    // And the camera followed the path for every one of them. The spike's first
    // run reported a flat 505 draw calls in all 840 frames because it did not,
    // and a constant result is exactly what that failure looks like from here.
    expect(calls.placed.slice(0, SMALL.frames)).toEqual(
      Array.from({ length: SMALL.frames }, (_, f) => cameraPose(f, SMALL.frames, CENTRE, SPAN)),
    );
    expect(result.render.fps.frames).toBe(SMALL.frames - SMALL.warmup);
    expect(result.drawCalls.p50).toBe(961);
    expect(result.trianglesPerFrame.p50).toBe(2_740_000);
    expect(result.viewport).toBe('1463x780');
  });

  it('waits for the GPU inside the timed region, not after it', async () => {
    // The whole reason this is the primary instrument: without gl.finish() the
    // number is CPU submit time and says nothing about whether the frame can be
    // drawn. Render costs 1 ms of CPU and the GPU takes 9 more.
    const clock = new FakeClock();
    const { probe, calls } = fakeProbe(clock, { render: 1, finishGpu: 9 });
    const { env } = fakeEnv(clock, { framesBeforeSuspend: 0 });

    const result = await runViewportBenchmark(probe, env, SMALL);

    expect(result.render.frameMs.p50).toBeCloseTo(10, 5);
    expect(calls.finished).toBeGreaterThanOrEqual(SMALL.frames);
    expect(calls.finishedBeforeRender).toBe(0);
  });

  it('uses the documented frame and warm-up counts by default', () => {
    expect(BENCHMARK_FRAMES).toBe(900);
    expect(BENCHMARK_WARMUP).toBe(60);
  });
});

describe('the rAF corroboration', () => {
  it('is valid when every frame was presented in a visible, focused tab', async () => {
    const clock = new FakeClock();
    // Free rendering, so the number under test is the presented interval and
    // nothing else — a real presented frame includes the render it contains.
    const { probe } = fakeProbe(clock, { render: 0 });
    const { env } = fakeEnv(clock, { frameGap: 6 });

    const result = await runViewportBenchmark(probe, env, SMALL);

    expect(result.presented.valid).toBe(true);
    expect(result.presented.stalls).toBe(0);
    expect(result.presented.hiddenAtSomePoint).toBe(false);
    expect(result.presented.frameMs!.p50).toBeCloseTo(6, 1);
  });

  it('says when the presented interval is the display and not the renderer', async () => {
    // Measured on the same machine hours apart: the panel went from 168 Hz to
    // 53 Hz, and 810 of 840 presented frames crossed 16.7 ms while the
    // renderer's own cost never exceeded 12. Read without this, the presented
    // series looks like a budget failure when the renderer is comfortably
    // inside it — so the report states which of the two is the ceiling.
    const clock = new FakeClock();
    const { probe } = fakeProbe(clock, { render: 2 });   // the renderer is fast
    const { env } = fakeEnv(clock, { frameGap: 17 });    // the panel is slow

    const result = await runViewportBenchmark(probe, env, SMALL);

    expect(result.render.frameMs.p95).toBeLessThan(result.presented.frameMs!.p50);
    expect(result.presented.displayBound).toBe(true);
  });

  it('does not blame the display when the renderer is what costs the frame', async () => {
    // The GPU is what costs the frame, and only the synchronous sweep waits
    // for it — `gl.finish()` is exactly the difference between the two
    // instruments, which is why a renderer-bound run shows up as sync p95
    // *above* the presented interval rather than below it.
    const clock = new FakeClock();
    const { probe } = fakeProbe(clock, { render: 2, finishGpu: 20 });
    const { env } = fakeEnv(clock, { frameGap: 1 });

    const result = await runViewportBenchmark(probe, env, SMALL);

    expect(result.render.frameMs.p95).toBeGreaterThan(result.presented.frameMs!.p50);
    expect(result.presented.displayBound).toBe(false);
  });

  it('reports itself void when rAF stalls, and leaves the stalled frames out', async () => {
    const clock = new FakeClock();
    const { probe } = fakeProbe(clock);
    // One frame arrives a full second late — the signature of a throttled tab.
    const { env } = fakeEnv(clock, { frameGap: (frame) => (frame === 12 ? 1000 : 6) });

    const result = await runViewportBenchmark(probe, env, SMALL);

    expect(result.presented.stalls).toBe(1);
    expect(result.presented.valid).toBe(false);
    // The stall must not be averaged into the frame time it invalidates.
    expect(result.presented.frameMs!.max).toBeLessThan(250);
  });

  it('reports itself void when the tab was hidden at any point', async () => {
    const clock = new FakeClock();
    const { probe } = fakeProbe(clock);
    const { env } = fakeEnv(clock, { visibleAfter: 10 });

    const result = await runViewportBenchmark(probe, env, SMALL);

    expect(result.presented.hiddenAtSomePoint).toBe(true);
    expect(result.presented.valid).toBe(false);
  });

  it('ends the run on a timer when rAF never calls back at all', async () => {
    const clock = new FakeClock();
    const { probe } = fakeProbe(clock);
    const { env } = fakeEnv(clock, { framesBeforeSuspend: 0 });

    // A suspended tab stops calling back entirely; the synchronous sweep has
    // already produced the numbers that matter, so the run must still finish.
    const result = await runViewportBenchmark(probe, env, SMALL);

    expect(result.presented.frameMs).toBeNull();
    expect(result.presented.valid).toBe(false);
    expect(result.render.frameMs.p50).toBeGreaterThan(0);
  });
});

describe('the foreground guard', () => {
  it('marks the whole report invalid when the window lost focus, not just the rAF half', async () => {
    // The rule the rAF corroboration bought: Chrome deprioritises the entire
    // renderer process in a background tab, so scene build, BVH build and every
    // pick number are ~3x pessimistic there — not only the presented frames.
    const clock = new FakeClock();
    const { probe } = fakeProbe(clock);
    const { env } = fakeEnv(clock, { focusedAfter: 8 });

    const result = await runViewportBenchmark(probe, env, SMALL);

    expect(result.foreground.focusedThroughout).toBe(false);
    expect(result.valid).toBe(false);
    // The numbers are still reported — a deliberate background run is how the
    // A/B gets done; they are labelled, not withheld.
    expect(result.render.frameMs.p50).toBeGreaterThan(0);
  });

  it('does not trust focus and visibility alone — a throttled run reports both clean', async () => {
    // Measured, not assumed: a *minimised* Electron window reports
    // `document.hasFocus() === true` and `visibilityState === 'visible'` while
    // Chromium throttles it anyway. The run that found this delivered not one
    // rAF callback in 30 s and was 2.4x slower on every CPU-bound number, and
    // both signals the guard trusted said it was in the foreground.
    //
    // So the rAF sweep is the guard, not merely the corroboration: frames that
    // were actually presented are the only evidence the renderer was not
    // deprioritised.
    const clock = new FakeClock();
    const { probe } = fakeProbe(clock);
    const { env } = fakeEnv(clock, { framesBeforeSuspend: 0 });

    const result = await runViewportBenchmark(probe, env, SMALL);

    expect(result.foreground.focusedThroughout).toBe(true);
    expect(result.foreground.visibleThroughout).toBe(true);
    expect(result.presented.valid).toBe(false);
    expect(result.valid).toBe(false);
  });

  it('is satisfied by a run that stayed in the foreground throughout', async () => {
    const clock = new FakeClock();
    const { probe } = fakeProbe(clock);
    const { env } = fakeEnv(clock);

    const result = await runViewportBenchmark(probe, env, SMALL);

    expect(result.foreground).toEqual({ focusedThroughout: true, visibleThroughout: true });
    expect(result.valid).toBe(true);
  });
});

describe('pick latency', () => {
  it('measures all three mechanisms separately over the same rays', async () => {
    const clock = new FakeClock();
    const { probe, calls } = fakeProbe(clock, {
      raycastWorldMesh: 0.2, raycastWholeScene: 5.6, pickVobsBlocking: 0.4,
    });
    const { env } = fakeEnv(clock);

    const result = await runViewportBenchmark(probe, env, SMALL);

    expect(calls.worldMeshRays).toHaveLength(SMALL.rays);
    expect(calls.wholeSceneRays).toHaveLength(SMALL.rays);
    expect(calls.vobPicks).toHaveLength(SMALL.rays);
    // The same rays through each mechanism, so the comparison is like for like.
    expect(calls.wholeSceneRays).toEqual(calls.worldMeshRays);

    expect(result.pickWorldMesh.p50).toBeCloseTo(0.2, 5);
    expect(result.pickWholeScene.p50).toBeCloseTo(5.6, 5);
    // The app's actual mechanism for props, which the spike had no number for.
    expect(result.pickVobs.p50).toBeCloseTo(0.4, 5);
  });

  it('splits the prop pick into what it blocks for and what it waits for', async () => {
    // The readback is asynchronous now, so the prop pick has two costs and they
    // answer different questions. What the main thread spends is what competes
    // with the frame; what the click waits for is the latency a user feels.
    // Reporting only the second would read as a regression against the
    // synchronous 2.1 ms, when it is the first that got smaller.
    const clock = new FakeClock();
    const { probe } = fakeProbe(clock, { pickVobsBlocking: 0.4, pickVobsFence: 6 });
    const { env } = fakeEnv(clock);

    const result = await runViewportBenchmark(probe, env, SMALL);

    expect(result.pickVobsBlocking.p50).toBeCloseTo(0.4, 5);
    expect(result.pickVobs.p50).toBeCloseTo(6.4, 5);
  });

  it('waits for each prop pick before starting the next, so they do not overlap', async () => {
    // Concurrent picks would queue behind one another on the GPU and every
    // reported latency after the first would be a queue depth, not a pick.
    const clock = new FakeClock();
    const { probe, calls } = fakeProbe(clock, { pickVobsBlocking: 0.4, pickVobsFence: 6 });
    const { env } = fakeEnv(clock);

    const result = await runViewportBenchmark(probe, env, SMALL);

    expect(calls.vobPicks).toHaveLength(SMALL.rays);
    // Overlapped, the last ray would report the whole sweep's wall clock.
    expect(result.pickVobs.max).toBeCloseTo(6.4, 5);
  });

  // The first real run measured 0.1 ms for a whole-scene raycast — faster than
  // the same ray through a BVH, and 56x faster than the spike. Every ray had
  // missed: the camera was left wherever the sweep's last frame put it, and a
  // ray that hits nothing is rejected by a bounding sphere and costs nothing.
  // Without a hit count, that reads as a very good result.
  it('aims the rays from inside the world and reports how many hit', async () => {
    const clock = new FakeClock();
    const { probe, calls } = fakeProbe(clock);
    const { env } = fakeEnv(clock);

    const result = await runViewportBenchmark(probe, env, SMALL);

    // The last camera move before the rays is a deliberate viewpoint inside the
    // world — the spike's `place(FRAMES * 0.7)` — and not the sweep's last frame.
    const inside = cameraPose(Math.floor(SMALL.frames * 0.7), SMALL.frames, CENTRE, SPAN);
    expect(calls.placed[calls.placed.length - 1]).toEqual(inside);

    expect(result.pickWorldMesh.hits).toBe(SMALL.rays / 2);
    expect(result.pickWholeScene.hits).toBe(SMALL.rays);
    expect(result.pickVobs.hits).toBe(0);
    expect(result.pickWorldMesh.rays).toBe(SMALL.rays);
  });

  it('keeps a late rAF callback from moving the camera under the rays', async () => {
    // Found by measurement, not by reading: with the prop pick made
    // asynchronous, two minimised runs of the real app answered 32 and 28 hits
    // where every foreground run — and the synchronous build in the same
    // minimised state — answered exactly 25.
    //
    // The rAF sweep in a suspended window ends on its timeout with a callback
    // still outstanding. Chromium delivers it whenever it next composites, and
    // `step` then moves the camera and renders. A synchronous pick loop never
    // gave it the chance; a loop that awaits a fence between rays does, so the
    // rest of the sweep aims from wherever that stray frame left the camera.
    const clock = new FakeClock();
    const { probe, calls } = fakeProbe(clock);
    const { env } = fakeEnv(clock, { framesBeforeSuspend: 3, resumeAfterTimeout: true });

    const result = await runViewportBenchmark(probe, env, SMALL);

    // The rays must be aimed from the fixed viewpoint and nothing may move the
    // camera afterwards — the whole sweep, not just the first ray.
    const inside = cameraPose(Math.floor(SMALL.frames * 0.7), SMALL.frames, CENTRE, SPAN);
    expect(calls.placed[calls.placed.length - 1]).toEqual(inside);
    expect(result.presented.valid).toBe(false);
  });
});
