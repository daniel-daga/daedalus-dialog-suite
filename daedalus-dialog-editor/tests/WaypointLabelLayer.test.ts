/**
 * The waypoint name layer (level-editor.md §16.19 slice 8).
 *
 * DOM rather than Three.js, and the reason is worth keeping: there is no text
 * in this scene at all — no sprite, no canvas texture, no SDF font — and the
 * one thing a name has to be is *legible*, at which HTML is better than
 * anything a first cut would build on the GPU. The renderer's CSP allows
 * `style-src 'unsafe-inline'`, which is what lets a transform be written
 * straight onto the element.
 *
 * The things that fail silently:
 *
 *   - a label that takes pointer events eats the click that would have picked
 *     the VOB or waypoint underneath it, and the viewport is entirely
 *     click-driven. Nothing about the picture would look wrong.
 *   - a pool that grows without shrinking leaves stale names on screen when
 *     fewer waypoints are in view than were a frame ago.
 *
 * @jest-environment jsdom
 */

import { WaypointLabelLayer } from '../src/renderer/world/WaypointLabelLayer';

const NAMES = ['WP_START', 'WP_MIDDLE', 'FP_CAMP'];

const shown = (layer: WaypointLabelLayer) =>
  Array.from(layer.root.children).filter((el) => !(el as HTMLElement).hidden);

const textOf = (layer: WaypointLabelLayer) =>
  shown(layer).map((el) => el.textContent);

describe('WaypointLabelLayer', () => {
  it('draws a name at the position it is given', () => {
    const layer = new WaypointLabelLayer(NAMES);

    layer.update([{ waypoint: 1, x: 120, y: 80 }]);

    expect(textOf(layer)).toEqual(['WP_MIDDLE']);
    const label = shown(layer)[0] as HTMLElement;
    expect(label.style.transform).toContain('120px');
    expect(label.style.transform).toContain('80px');
  });

  it('lets clicks through to the viewport underneath', () => {
    // The viewport picks VOBs and waypoints by click. A label over a dot that
    // swallowed the click would make exactly the waypoint you are looking at
    // the one you cannot select.
    const layer = new WaypointLabelLayer(NAMES);
    layer.update([{ waypoint: 0, x: 10, y: 10 }]);

    expect(layer.root.style.pointerEvents).toBe('none');
    expect((shown(layer)[0] as HTMLElement).style.pointerEvents).toBe('none');
  });

  it('reuses its elements rather than rebuilding them every frame', () => {
    // This runs in the draw loop, so a fresh element per frame would churn the
    // DOM sixty times a second.
    const layer = new WaypointLabelLayer(NAMES);
    layer.update([{ waypoint: 0, x: 10, y: 10 }]);
    const first = shown(layer)[0];

    layer.update([{ waypoint: 0, x: 20, y: 30 }]);

    expect(shown(layer)[0]).toBe(first);
    expect((first as HTMLElement).style.transform).toContain('20px');
  });

  it('hides the surplus when fewer waypoints are in view than a frame ago', () => {
    const layer = new WaypointLabelLayer(NAMES);
    layer.update([
      { waypoint: 0, x: 10, y: 10 },
      { waypoint: 1, x: 20, y: 20 },
      { waypoint: 2, x: 30, y: 30 },
    ]);
    expect(shown(layer)).toHaveLength(3);

    layer.update([{ waypoint: 2, x: 30, y: 30 }]);

    expect(textOf(layer)).toEqual(['FP_CAMP']);
  });

  it('shows nothing at all when told to hide', () => {
    const layer = new WaypointLabelLayer(NAMES);
    layer.update([{ waypoint: 0, x: 10, y: 10 }]);

    layer.setVisible(false);

    expect(layer.root.hidden).toBe(true);
  });

  it('skips a waypoint the name list has not got', () => {
    // The names come from the waynet payload and the positions from the
    // overlay; a world reopened between the two would otherwise label
    // `undefined`.
    const layer = new WaypointLabelLayer(NAMES);

    layer.update([{ waypoint: 9, x: 10, y: 10 }, { waypoint: 0, x: 20, y: 20 }]);

    expect(textOf(layer)).toEqual(['WP_START']);
  });

  it('takes its container off the page when disposed', () => {
    const host = document.createElement('div');
    const layer = new WaypointLabelLayer(NAMES);
    host.appendChild(layer.root);

    layer.dispose();

    expect(host.children).toHaveLength(0);
  });
});
