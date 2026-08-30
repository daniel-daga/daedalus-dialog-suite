import { labelTextFor, type WaypointLabel } from './waypointLabels';

// Waypoint names drawn over the viewport (level-editor.md §16.19 slice 8) —
// and, on a point the spawn layer marks, the NPCs standing on it instead
// (slice 14). Which of the two a label says is `labelTextFor`'s; this class
// only asks and draws.
//
// **DOM, not Three.js, and deliberately.** There is no text in this scene at
// all — no sprite, no canvas texture, no SDF font — and adding one would be a
// dependency and a font atlas before the first name appeared. A name has to be
// legible above everything else, and HTML is better at that than anything a
// first cut would build on the GPU. The renderer's CSP allows
// `style-src 'unsafe-inline'` (`security-model.md`), which is what lets the
// transform be written straight onto the element.
//
// It is driven from the draw loop, so it holds a pool of elements and moves
// them: a fresh element per frame would churn the DOM sixty times a second. The
// pool only ever grows to `LABEL_CAP`, because that is what
// `chooseWaypointLabels` hands it.
//
// Nothing in here takes pointer events. The viewport is entirely click-driven —
// VOB picking, waypoint picking, terrain placement — and a label over a dot
// that swallowed the click would make the waypoint you are looking at the one
// you cannot select, with nothing about the picture looking wrong.

export class WaypointLabelLayer {
  /** Append this to the viewport host, over the canvas. */
  readonly root: HTMLDivElement;
  private pool: HTMLDivElement[] = [];

  /**
   * `occupantsAt` is who is standing on a waypoint, asked for rather than
   * handed over (§16.19 slice 14): the layer is built once per world and the
   * occupancy changes under it on every tick of the time slider, every state
   * pick and every toggle of the spawn layer. Omitted, this is the layer slice
   * 8 shipped — waypoint names and nothing else.
   */
  constructor(
    private names: readonly string[],
    private occupantsAt: (waypoint: number) => readonly string[] = () => [],
  ) {
    this.root = document.createElement('div');
    const style = this.root.style;
    style.position = 'absolute';
    style.inset = '0';
    style.overflow = 'hidden';
    style.pointerEvents = 'none';
  }

  /** Draw exactly these, at these screen positions, and nothing else. */
  update(labels: readonly WaypointLabel[]): void {
    let drawn = 0;
    for (const label of labels) {
      const waypointName = this.names[label.waypoint];
      // The names come from the waynet payload and the positions from the
      // overlay. They are the same world today, but a stale candidate list
      // would otherwise put the string "undefined" on screen.
      if (waypointName === undefined) continue;
      const name = labelTextFor(waypointName, this.occupantsAt(label.waypoint));

      const element = this.elementAt(drawn);
      // Read before write: assigning identical text still invalidates layout.
      if (element.textContent !== name) element.textContent = name;
      element.style.transform = `translate(-50%, -140%) translate(${label.x}px, ${label.y}px)`;
      element.hidden = false;
      drawn += 1;
    }

    // Whatever the last frame drew and this one does not. Without it a name
    // stays on screen after its waypoint has gone off it.
    for (let i = drawn; i < this.pool.length; i++) this.pool[i].hidden = true;
  }

  setVisible(visible: boolean): void {
    this.root.hidden = !visible;
  }

  private elementAt(index: number): HTMLDivElement {
    const existing = this.pool[index];
    if (existing) return existing;

    const element = document.createElement('div');
    const style = element.style;
    style.position = 'absolute';
    style.left = '0';
    style.top = '0';
    style.pointerEvents = 'none';
    style.whiteSpace = 'nowrap';
    style.font = '11px system-ui, sans-serif';
    // Legible over any world: ZenGin's lighting is baked into the vertex
    // colours, so the picture behind a label is as likely to be a white sky as
    // a black cave and neither a light nor a dark label works alone.
    style.color = '#fff';
    style.background = 'rgba(0, 0, 0, 0.6)';
    style.padding = '1px 4px';
    style.borderRadius = '3px';
    this.pool.push(element);
    this.root.appendChild(element);
    return element;
  }

  dispose(): void {
    this.root.remove();
    this.pool = [];
  }
}
