import type { RoutineEntry } from './routineEntries';

/**
 * The edits routine mode makes to a routine draft (npc-editor.md §6). Pure;
 * each returns a new array and leaves its input alone.
 *
 * **The day is edited as a partition.** A boundary is shared by the entry
 * ending there and the entry starting there, and moving it moves both unless
 * the author detaches it — so an edit never opens a gap or an overlap by
 * accident. A routine that already has them is left as it is; nothing here
 * repairs one.
 *
 * **No window may become empty.** `start === end` is the whole day (the
 * `(00,00,00,00)` idiom, architecture §8), so a window squeezed to nothing
 * would silently turn into one covering everything. A move is clamped a minute
 * short of that instead.
 */

/** One colour per activity, by its index in the draft — the routine editor's
 *  rows and the stops on the map, so the two read as the same thing. Here
 *  rather than beside either view, so the editor's bundle does not pull in
 *  three.js. */
export const ROUTINE_COLORS = ['#5b8def', '#e0a33a', '#4caf7d', '#c265d6', '#e0605a', '#3fb5c4'];

const DAY = 24 * 60;
const mod =(n: number) => ((n % DAY) + DAY) % DAY;
/** Minutes a window lasts; an empty one is the whole day. */
const lengthOf = (entry: RoutineEntry) => mod(entry.endMinute - entry.startMinute) || DAY;

const replaced = (entries: readonly RoutineEntry[], index: number, entry: RoutineEntry) =>
  entries.map((e, i) => (i === index ? entry : e));

/**
 * Move entry `index`'s `edge` to `minute`. The neighbour sharing that
 * boundary moves with it unless `detach`, or unless no entry shares it.
 *
 * A minute outside where the boundary may land is clamped to whichever end
 * it is nearer, one minute inside.
 */
export function moveBoundary(
  entries: readonly RoutineEntry[],
  index: number,
  edge: 'start' | 'end',
  minute: number,
  options: { detach?: boolean } = {},
): RoutineEntry[] {
  const own = entries[index];
  const boundary = edge === 'end' ? own.endMinute : own.startMinute;
  const partnerIndex = options.detach ? -1 : entries.findIndex((e, i) => i !== index &&
    (edge === 'end' ? e.startMinute === boundary : e.endMinute === boundary));
  const partner = partnerIndex === -1 ? undefined : entries[partnerIndex];

  // `before` ends at the boundary, `after` starts there. With both, the
  // boundary may land anywhere on the arc from before's start to after's end.
  const before = edge === 'end' ? own : partner;
  const after = edge === 'end' ? partner : own;
  let moved: number;
  if (before) {
    const arc = after ? Math.min(lengthOf(before) + lengthOf(after), DAY) : DAY;
    let offset = mod(minute - before.startMinute);
    if (offset === 0) offset = 1;
    else if (offset >= arc) offset = offset - arc < DAY - offset ? arc - 1 : 1;
    moved = mod(before.startMinute + offset);
  } else {
    // A start edge nothing ends at: only its own window constrains it.
    moved = mod(own.endMinute - (mod(own.endMinute - minute) || 1));
  }

  let result = replaced(entries, index, edge === 'end' ? { ...own, endMinute: moved } : { ...own, startMinute: moved });
  if (partner) {
    result = replaced(result, partnerIndex, edge === 'end'
      ? { ...partner, startMinute: moved }
      : { ...partner, endMinute: moved });
  }
  return result;
}

/** Split entry `index` at `minute`, strictly inside its window: the entry
 *  ends there, and a copy with no source takes the rest. A minute on or
 *  outside the window changes nothing. */
export function splitEntry(entries: readonly RoutineEntry[], index: number, minute: number): RoutineEntry[] {
  const entry = entries[index];
  const offset = mod(minute - entry.startMinute);
  if (offset === 0 || offset >= lengthOf(entry)) return [...entries];
  const { source: _source, ...rest } = entry;
  return [
    ...entries.slice(0, index),
    { ...entry, endMinute: mod(minute) },
    { ...rest, startMinute: mod(minute) },
    ...entries.slice(index + 1),
  ];
}

/** Remove entry `index`, giving its window to the entry ending where it
 *  starts, else to the entry starting where it ends, else to nobody. */
export function removeEntry(entries: readonly RoutineEntry[], index: number): RoutineEntry[] {
  const removed = entries[index];
  const rest = entries.filter((_, i) => i !== index);
  const before = rest.findIndex((e) => e.endMinute === removed.startMinute);
  if (before !== -1) return replaced(rest, before, { ...rest[before], endMinute: removed.endMinute });
  const after = rest.findIndex((e) => e.startMinute === removed.endMinute);
  if (after !== -1) return replaced(rest, after, { ...rest[after], startMinute: removed.startMinute });
  return rest;
}

export function setState(entries: readonly RoutineEntry[], index: number, state: string): RoutineEntry[] {
  return replaced(entries, index, { ...entries[index], state });
}

export function setWaypoint(entries: readonly RoutineEntry[], index: number, waypoint: string): RoutineEntry[] {
  return replaced(entries, index, { ...entries[index], waypoint });
}
