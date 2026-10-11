import type { RoutineArgIndex, SemanticModel } from '../../shared/types';

/**
 * A routine function's `TA_*` calls as entries an editor can change, and the
 * entries written back (npc-editor.md §6). Pure.
 *
 * The file's semantic model already keeps every statement of a function body
 * verbatim as one action, and a save regenerates the function from those
 * actions — so an edit is a new actions list, not a text patch over the file.
 * The writer still patches *within* an action: it rewrites only the tokens
 * whose value changed, so alignment tabs, `08` against `8` and a `24` for
 * midnight survive every edit that does not touch them.
 *
 * Which argument is which comes from `routineLayouts`, the layout the routine
 * index read the call with (architecture §8, "A wrapper's argument layout is
 * found by following the call"), never from a parameter-name convention. A call
 * whose times or waypoint are not literals is not an entry: excluded, never
 * guessed, as the index does.
 */

export interface RoutineEntry {
  /** The callee as written, e.g. `TA_Sit_Throne`. */
  state: string;
  startMinute: number;
  endMinute: number;
  waypoint: string;
  /** The action this entry was read from; absent for a new one. */
  source?: { actionIndex: number };
}

interface ParsedCall {
  callee: string;
  /** Whitespace between the callee and `(`. */
  gap: string;
  /** Each argument as written, surrounding whitespace included. */
  args: string[];
}

type RoutineAction = { type?: string; action?: string };

const MINUTES_PER_DAY = 24 * 60;
const INTEGER = /^\d+$/;
const STRING = /^"([^"]*)"$/;

function parseCall(text: string): ParsedCall | null {
  const match = /^([A-Za-z_][A-Za-z0-9_]*)(\s*)\(([\s\S]*)\)\s*;?\s*$/.exec(text);
  if (!match) return null;
  const args: string[] = [];
  let depth = 0;
  let inString = false;
  let current = '';
  for (const ch of match[3]) {
    if (ch === '"') inString = !inString;
    else if (!inString && ch === '(') depth++;
    else if (!inString && ch === ')') depth--;
    if (ch === ',' && depth === 0 && !inString) {
      args.push(current);
      current = '';
    } else current += ch;
  }
  if (current.trim() !== '' || args.length > 0) args.push(current);
  return { callee: match[1], gap: match[2], args };
}

const layoutOf = (layouts: Record<string, RoutineArgIndex>, callee: string) => layouts[callee.toUpperCase()];

function intAt(call: ParsedCall, slot: number | undefined): number | undefined {
  if (slot === undefined) return 0;
  const raw = call.args[slot]?.trim();
  return raw !== undefined && INTEGER.test(raw) ? Number.parseInt(raw, 10) : undefined;
}

function entryOf(call: ParsedCall, layout: RoutineArgIndex): Omit<RoutineEntry, 'source'> | null {
  const startH = intAt(call, layout.startH);
  const startM = intAt(call, layout.startM);
  const stopH = intAt(call, layout.stopH);
  const stopM = intAt(call, layout.stopM);
  const waypoint = STRING.exec(call.args[layout.waypoint]?.trim() ?? '');
  if (startH === undefined || startM === undefined || stopH === undefined || stopM === undefined || !waypoint) {
    return null;
  }
  return {
    state: call.callee,
    startMinute: (startH * 60 + startM) % MINUTES_PER_DAY,
    endMinute: (stopH * 60 + stopM) % MINUTES_PER_DAY,
    waypoint: waypoint[1],
  };
}

export function readRoutine(actions: readonly unknown[], layouts: Record<string, RoutineArgIndex>): RoutineEntry[] {
  const entries: RoutineEntry[] = [];
  actions.forEach((raw, actionIndex) => {
    const action = raw as RoutineAction;
    if (action.type !== 'Action' || typeof action.action !== 'string') return;
    const call = parseCall(action.action);
    const layout = call && layoutOf(layouts, call.callee);
    const entry = layout && entryOf(call, layout);
    if (entry) entries.push({ ...entry, source: { actionIndex } });
  });
  return entries;
}

/** The hour and minute an edge is written as. An end at midnight is hour 24,
 *  as retail writes it, unless the window starts there too: `(00,00,00,00)`
 *  is the whole-day idiom. */
function edgeOf(entry: RoutineEntry, edge: 'start' | 'end'): { hour: number; minute: number } {
  const minute = edge === 'start' ? entry.startMinute : entry.endMinute;
  const hour = Math.floor(minute / 60);
  if (edge === 'end' && minute === 0 && entry.startMinute !== 0) return { hour: 24, minute: 0 };
  return { hour, minute: minute % 60 };
}

function assertWritable(entry: RoutineEntry, layout: RoutineArgIndex): void {
  const hourOnly = layout.startM === undefined || layout.stopM === undefined;
  if (hourOnly && (entry.startMinute % 60 !== 0 || entry.endMinute % 60 !== 0)) {
    throw new Error(`${entry.state} takes whole hours; its window cannot start or end between them`);
  }
}

/** `raw` with its number replaced, surrounding whitespace and width kept. */
function withNumber(raw: string, value: number): string {
  const core = raw.trim();
  const lead = raw.slice(0, raw.indexOf(core));
  const trail = raw.slice(lead.length + core.length);
  return `${lead}${String(value).padStart(core.length, '0')}${trail}`;
}

function withString(raw: string, value: string): string {
  const core = raw.trim();
  const lead = raw.slice(0, raw.indexOf(core));
  return `${lead}"${value}"${raw.slice(lead.length + core.length)}`;
}

function patchCall(original: ParsedCall, entry: RoutineEntry, layout: RoutineArgIndex): string {
  assertWritable(entry, layout);
  const args = [...original.args];
  const was = entryOf(original, layout)!;
  const setNumber = (slot: number | undefined, value: number) => {
    if (slot === undefined) return;
    if (Number.parseInt(args[slot].trim(), 10) !== value) args[slot] = withNumber(args[slot], value);
  };
  if (was.startMinute !== entry.startMinute) {
    const { hour, minute } = edgeOf(entry, 'start');
    setNumber(layout.startH, hour);
    setNumber(layout.startM, minute);
  }
  if (was.endMinute !== entry.endMinute) {
    const { hour, minute } = edgeOf(entry, 'end');
    setNumber(layout.stopH, hour);
    setNumber(layout.stopM, minute);
  }
  if (was.waypoint !== entry.waypoint) args[layout.waypoint] = withString(args[layout.waypoint], entry.waypoint);
  return `${entry.state}${original.gap}(${args.join(',')})`;
}

const sameLayout = (a: RoutineArgIndex, b: RoutineArgIndex) =>
  a.startH === b.startH && a.startM === b.startM && a.stopH === b.stopH && a.stopM === b.stopM &&
  a.waypoint === b.waypoint;

/** A call written from nothing but the entry, spaced like `template`. Every
 *  argument position has to be one the entry fills: `TA_MIN` also wants
 *  `self` and a `ZS_*` state, which an entry does not carry. */
function freshCall(entry: RoutineEntry, layout: RoutineArgIndex, template: ParsedCall | null): string {
  assertWritable(entry, layout);
  const two = (n: number) => String(n).padStart(2, '0');
  const start = edgeOf(entry, 'start');
  const end = edgeOf(entry, 'end');
  const slots = new Map<number, string>([
    [layout.startH, two(start.hour)],
    [layout.stopH, two(end.hour)],
    [layout.waypoint, `"${entry.waypoint}"`],
  ]);
  if (layout.startM !== undefined) slots.set(layout.startM, two(start.minute));
  if (layout.stopM !== undefined) slots.set(layout.stopM, two(end.minute));
  const count = Math.max(...slots.keys()) + 1;
  if (slots.size !== count) {
    throw new Error(`${entry.state} takes arguments beyond a time window and a waypoint; write it in the script`);
  }
  const spaced = template?.args.slice(1).some((arg) => /^\s/.test(arg)) ?? false;
  const args = Array.from({ length: count }, (_, i) => slots.get(i)!);
  return `${entry.state}${template?.gap ?? ' '}(${args.join(spaced ? ', ' : ',')})`;
}

/**
 * `actions` with the routine's calls replaced by `entries`. An entry with a
 * `source` rewrites that action; a source no entry names any more is dropped;
 * a new entry goes after the action of the entry before it in `entries`, or
 * before the first entry's action when none is before it. Every other action
 * is kept as it is, in place. Throws when an entry cannot be written in its
 * state's layout, naming why.
 */
export function writeRoutine(
  actions: readonly unknown[],
  entries: readonly RoutineEntry[],
  layouts: Record<string, RoutineArgIndex>,
): unknown[] {
  const originals = readRoutine(actions, layouts);
  const sourceIndices = new Set(originals.map((entry) => entry.source!.actionIndex));
  const templateAction = originals[0] && (actions[originals[0].source!.actionIndex] as RoutineAction).action;
  const template = templateAction ? parseCall(templateAction) : null;

  const textOf = (entry: RoutineEntry): string => {
    const layout = layoutOf(layouts, entry.state);
    if (!layout) throw new Error(`${entry.state} is not a routine state this project declares`);
    if (entry.source) {
      const original = parseCall((actions[entry.source.actionIndex] as RoutineAction).action!)!;
      const originalLayout = layoutOf(layouts, original.callee);
      if (sameLayout(layout, originalLayout)) return patchCall(original, entry, layout);
    }
    return freshCall(entry, layout, template);
  };

  // New entries grouped under the sourced entry they follow; -1 is "before
  // the first sourced entry".
  const following = new Map<number, RoutineEntry[]>();
  let anchor = -1;
  const bySource = new Map<number, RoutineEntry>();
  for (const entry of entries) {
    if (entry.source && sourceIndices.has(entry.source.actionIndex)) {
      bySource.set(entry.source.actionIndex, entry);
      anchor = entry.source.actionIndex;
    } else {
      following.set(anchor, [...(following.get(anchor) ?? []), entry]);
    }
  }

  const written = (entry: RoutineEntry) => ({ type: 'Action', action: textOf(entry) });
  const out: unknown[] = [];
  const firstKept = [...bySource.keys()].sort((a, b) => a - b)[0];
  actions.forEach((action, index) => {
    if (index === firstKept) out.push(...(following.get(-1) ?? []).map(written));
    if (!sourceIndices.has(index)) {
      out.push(action);
      return;
    }
    const entry = bySource.get(index);
    if (!entry) return;
    const text = textOf(entry);
    out.push(text === (action as RoutineAction).action ? action : { ...(action as object), action: text });
    out.push(...(following.get(index) ?? []).map(written));
  });
  if (firstKept === undefined) out.push(...(following.get(-1) ?? []).map(written));
  return out;
}

/**
 * `model` with a new routine function appended — `FUNC VOID <name>()` holding
 * `actions` — and put last in the declaration order, so the save writes it at
 * the end of the file, where retail keeps an NPC's routines. The action
 * objects are plain, not parser classes: the model crosses the save IPC as
 * JSON (as `appendInsertNpc`'s does). Throws when the file already declares
 * the name.
 */
export function withRoutineFunction(model: SemanticModel, name: string, actions: unknown[]): SemanticModel {
  if (Object.keys(model.functions).some((existing) => existing.toUpperCase() === name.toUpperCase())) {
    throw new Error(`${name} already exists`);
  }
  const fn = {
    name, returnType: 'VOID', parameters: [], actions, conditions: [], conditionOperator: 'AND',
    calls: [], callSites: [],
  };
  return {
    ...model,
    functions: { ...model.functions, [name]: fn as unknown as SemanticModel['functions'][string] },
    declarationOrder: [...(model.declarationOrder ?? []), { type: 'function', name, blankLinesBefore: 1 }],
  };
}
