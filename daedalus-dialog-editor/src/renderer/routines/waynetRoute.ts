import type { WaynetPayload } from '../../shared/worldTypes';

/**
 * The way between two routine stops along the waynet (npc-editor.md §6).
 * Pure: shortest path by straight-line edge length over the payload's edge
 * pairs. A leg with no route is `null`, and that is all it claims — what the
 * engine does with an NPC sent somewhere the waynet cannot reach is unmeasured.
 */

export interface WaynetGraph {
  positions: Float32Array;
  /** Per waypoint, its neighbours and the distance to each. */
  neighbours: Array<Array<{ to: number; cost: number }>>;
  /** UPPERCASED name to index. */
  byName: Map<string, number>;
}

export function waynetGraph(waynet: WaynetPayload): WaynetGraph {
  const positions = new Float32Array(waynet.positions);
  const edges = new Uint32Array(waynet.edges);
  const neighbours: WaynetGraph['neighbours'] = Array.from({ length: waynet.count }, () => []);
  const distance = (a: number, b: number) => Math.hypot(
    positions[a * 3] - positions[b * 3],
    positions[a * 3 + 1] - positions[b * 3 + 1],
    positions[a * 3 + 2] - positions[b * 3 + 2],
  );
  for (let pair = 0; pair + 1 < edges.length; pair += 2) {
    const a = edges[pair];
    const b = edges[pair + 1];
    if (a >= waynet.count || b >= waynet.count) continue;
    const cost = distance(a, b);
    neighbours[a].push({ to: b, cost });
    neighbours[b].push({ to: a, cost });
  }
  const byName = new Map<string, number>();
  waynet.names.forEach((name, index) => byName.set(name.toUpperCase(), index));
  return { positions, neighbours, byName };
}

/** Waypoint indices from `from` to `to`, both ends included; `null` when
 *  either name is not in the waynet or no edges join them. */
export function waynetRoute(graph: WaynetGraph, from: string, to: string): number[] | null {
  const start = graph.byName.get(from.toUpperCase());
  const goal = graph.byName.get(to.toUpperCase());
  if (start === undefined || goal === undefined) return null;

  const best = new Float64Array(graph.neighbours.length).fill(Infinity);
  const previous = new Int32Array(graph.neighbours.length).fill(-1);
  best[start] = 0;
  const heap = new MinHeap();
  heap.push(start, 0);
  while (heap.size > 0) {
    const { node, cost } = heap.pop();
    if (node === goal) break;
    if (cost > best[node]) continue;
    for (const { to: next, cost: step } of graph.neighbours[node]) {
      const through = cost + step;
      if (through < best[next]) {
        best[next] = through;
        previous[next] = node;
        heap.push(next, through);
      }
    }
  }
  if (best[goal] === Infinity) return null;

  const route = [goal];
  while (route[0] !== start) route.unshift(previous[route[0]]);
  return route;
}

class MinHeap {
  private items: Array<{ node: number; cost: number }> = [];

  get size(): number {
    return this.items.length;
  }

  push(node: number, cost: number): void {
    const items = this.items;
    items.push({ node, cost });
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (items[parent].cost <= items[i].cost) break;
      [items[parent], items[i]] = [items[i], items[parent]];
      i = parent;
    }
  }

  pop(): { node: number; cost: number } {
    const items = this.items;
    const top = items[0];
    const last = items.pop()!;
    if (items.length > 0) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const left = i * 2 + 1;
        const right = left + 1;
        let smallest = i;
        if (left < items.length && items[left].cost < items[smallest].cost) smallest = left;
        if (right < items.length && items[right].cost < items[smallest].cost) smallest = right;
        if (smallest === i) break;
        [items[smallest], items[i]] = [items[i], items[smallest]];
        i = smallest;
      }
    }
    return top;
  }
}
