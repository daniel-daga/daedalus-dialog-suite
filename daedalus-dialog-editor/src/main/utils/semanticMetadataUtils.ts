import type { DialogMetadata, RoutineSite, SemanticModel, SpawnSite } from '../../shared/types';
import { SemanticModelBuilderVisitor } from 'daedalus-parser/semantic-visitor';

import DaedalusParser from 'daedalus-parser';
const daedalusWrapper = new DaedalusParser();

export interface ParsedFileMetadata {
  dialogs: DialogMetadata[];
  instances: Array<{ name: string; parent: string }>;
  prototypes: Array<{ name: string; parent: string }>;
  isQuestFile: boolean;
  routines: string[];
  /** Literal AI_Output voice ids (expression-valued ids are skipped). */
  voiceIds: Array<{ id: string; functionName: string }>;
  /**
   * The full semantic model the metadata pass already built — present only
   * when the parse was clean and both visitor passes completed, so it can be
   * handed to the renderer instead of a second parse (P0 double-parse fix).
   * Error files stay on the parse path, which returns an errors-only model.
   */
  semanticModel?: SemanticModel;
}

const hasQuestTopicConstants = (semanticModel: SemanticModel): boolean => {
  const constantNames = Object.keys(semanticModel.constants || {});
  return constantNames.some((name) => name.toUpperCase().startsWith('TOPIC_'));
};

const hasQuestStateVariables = (semanticModel: SemanticModel): boolean => {
  const variableNames = Object.keys(semanticModel.variables || {});
  return variableNames.some((name) => name.toUpperCase().startsWith('MIS_'));
};

const extractDialogs = (semanticModel: SemanticModel, filePath: string): DialogMetadata[] => {
  const dialogs: DialogMetadata[] = [];

  Object.entries(semanticModel.dialogs || {}).forEach(([dialogName, dialog]) => {
    const npc = dialog?.properties?.npc;
    if (!npc || typeof npc !== 'string') {
      return;
    }

    dialogs.push({
      dialogName: dialog.name || dialogName,
      npc,
      filePath
    });
  });

  return dialogs;
};

const extractInstanceAndPrototypeDeclarations = (
  parseResult: any
): { instances: Array<{ name: string; parent: string }>; prototypes: Array<{ name: string; parent: string }> } => {
  const declarations = typeof daedalusWrapper.extractDeclarations === 'function'
    ? daedalusWrapper.extractDeclarations(parseResult)
    : [];

  const instances: Array<{ name: string; parent: string }> = [];
  const prototypes: Array<{ name: string; parent: string }> = [];
  for (const declaration of declarations) {
    if (!declaration?.name || !declaration.parent) continue;
    if (declaration.type === 'instance') {
      instances.push({ name: declaration.name, parent: declaration.parent });
    } else if (declaration.type === 'prototype') {
      prototypes.push({ name: declaration.name, parent: declaration.parent });
    }
  }
  return { instances, prototypes };
};

const extractDailyRoutines = (semanticModel: SemanticModel): string[] => {
  const routines: string[] = [];
  const seen = new Set<string>();
  for (const instance of Object.values(semanticModel.instances || {})) {
    if (instance.dailyRoutine && !seen.has(instance.dailyRoutine)) {
      routines.push(instance.dailyRoutine);
      seen.add(instance.dailyRoutine);
    }
  }
  return routines;
};

const collectDialogLineVoiceIds = (
  actions: any[],
  functionName: string,
  collected: Array<{ id: string; functionName: string }>
): void => {
  for (const action of actions || []) {
    if (!action) {
      continue;
    }
    if (action.type === 'DialogLine') {
      if (typeof action.id === 'string' && action.id && !action.idIsExpression) {
        collected.push({ id: action.id, functionName });
      }
      continue;
    }
    if (Array.isArray(action.thenActions) || Array.isArray(action.elseActions)) {
      collectDialogLineVoiceIds(action.thenActions || [], functionName, collected);
      collectDialogLineVoiceIds(action.elseActions || [], functionName, collected);
    }
  }
};

const extractVoiceIds = (semanticModel: SemanticModel): Array<{ id: string; functionName: string }> => {
  const voiceIds: Array<{ id: string; functionName: string }> = [];
  for (const [functionName, func] of Object.entries(semanticModel.functions || {})) {
    collectDialogLineVoiceIds(func.actions || [], functionName, voiceIds);
  }
  return voiceIds;
};

// Engine externals that take a waypoint name literal, and the 0-based argument
// index it sits at. Closed, and measured rather than guessed (W5,
// level-editor.md §16.8): every external declared in the G2 MDK's own
// Content/AI/AI_Intern/Externals.d whose string parameter names a place. The
// engine's set is closed, so this one is too — a project's *own* helpers are
// derived from their declarations below, never listed here.
const ENGINE_EXTERNAL_WAYPOINT_ARG_INDEX: Record<string, number> = {
  ai_gotowp: 1,
  npc_getdisttowp: 1,
  ai_teleport: 1,
  ai_startstate: 3,
  ta: 4,
  ta_min: 6,
  // spawnPoint: a waypoint *or* a free point, and both spellings are literal
  // here. Retail measures 3,018 of 3,722 Wld_InsertNpc literals as waypoint
  // names; the FP_ remainder simply never matches a selected waypoint.
  wld_insertnpc: 1,
  wld_insertitem: 1
};

/**
 * Maps a called function's lowercased name to the argument index that holds
 * its waypoint literal — the engine externals above, plus every
 * project-declared function whose own signature has a parameter literally
 * named `waypoint` typed `string` (the derivation rule from §16.8: don't
 * hardcode the project's helper functions, read their own declaration).
 */
export function buildWaypointParamIndex(fileModels: Array<{ semanticModel: SemanticModel }>): Record<string, number> {
  const index: Record<string, number> = { ...ENGINE_EXTERNAL_WAYPOINT_ARG_INDEX };
  for (const { semanticModel } of fileModels) {
    for (const func of Object.values(semanticModel.functions || {})) {
      const paramIndex = (func.parameters || []).findIndex(
        // Both halves case-insensitively: Daedalus is, and the corpus spells
        // the same parameter `waypoint`, `WayPoint` and `WAYPOINT`.
        (param) => param.name?.toLowerCase() === 'waypoint' && param.type?.toLowerCase() === 'string'
      );
      if (paramIndex !== -1) {
        index[func.name.toLowerCase()] = paramIndex;
      }
    }
  }
  return index;
}

/**
 * Waypoint name literals passed to a call site resolved through
 * buildWaypointParamIndex, keyed by UPPERCASED waypoint name (Daedalus is
 * case-insensitive) with the calling routine's own file/function location.
 * Needs every file's semantic model at once — a project helper's waypoint
 * parameter can be declared in one file and called from another.
 */
export function extractWaypointSites(
  fileModels: Array<{ filePath: string; semanticModel: SemanticModel }>
): Record<string, Array<{ filePath: string; functionName: string }>> {
  const paramIndex = buildWaypointParamIndex(fileModels);
  const sites: Record<string, Array<{ filePath: string; functionName: string }>> = {};

  for (const { filePath, semanticModel } of fileModels) {
    for (const [functionName, func] of Object.entries(semanticModel.functions || {})) {
      for (const call of func.callSites || []) {
        const argIndex = paramIndex[call.functionName.toLowerCase()];
        if (argIndex === undefined) continue;

        const arg = call.args?.[argIndex];
        if (!arg || !arg.isString || !arg.value) continue;

        const key = arg.value.toUpperCase();
        if (!sites[key]) {
          sites[key] = [];
        }
        sites[key].push({ filePath, functionName });
      }
    }
  }

  return sites;
}

// The two engine externals that spawn an instance at a place. They are the
// only waypoint externals carrying an instance at argument 0 — every other one
// in ENGINE_EXTERNAL_WAYPOINT_ARG_INDEX acts on `self` — so a spawn is read
// from this pair alone, never from the waypoint table.
const SPAWN_EXTERNAL_NAMES = new Set(['wld_insertnpc', 'wld_insertitem']);

/** A bare Daedalus identifier: anything else at argument 0 is an expression. */
const BARE_IDENTIFIER = /^[A-Za-z_]\w*$/;

/**
 * Static spawn sites: every `Wld_InsertNpc`/`Wld_InsertItem` call whose
 * instance *and* spawn point are both statically resolvable, with the call's
 * own file, function and 1-based line. Names are UPPERCASED because Daedalus
 * is case-insensitive.
 *
 * A site that is not statically resolvable — an expression instance
 * (`Hlp_Random`, an array index, a variable holding a loop's pick) or a
 * non-literal spawn point — is **excluded, never guessed** (level-editor.md §8,
 * design brief §5.1). This is deliberately a second index rather than a
 * widening of `extractWaypointSites`: a spawn and a routine answer different
 * questions about the same waypoint.
 */
export function extractSpawnSites(
  fileModels: Array<{ filePath: string; semanticModel: SemanticModel }>
): SpawnSite[] {
  const sites: SpawnSite[] = [];

  for (const { filePath, semanticModel } of fileModels) {
    for (const [functionName, func] of Object.entries(semanticModel.functions || {})) {
      for (const call of func.callSites || []) {
        if (!SPAWN_EXTERNAL_NAMES.has(call.functionName.toLowerCase())) continue;

        const instanceArg = call.args?.[0];
        const spawnPointArg = call.args?.[1];
        if (!instanceArg || instanceArg.isString || !BARE_IDENTIFIER.test(instanceArg.raw)) continue;
        if (!spawnPointArg || !spawnPointArg.isString || !spawnPointArg.value) continue;

        sites.push({
          instance: instanceArg.raw.toUpperCase(),
          spawnPoint: spawnPointArg.value.toUpperCase(),
          filePath,
          functionName,
          line: call.position.startLine
        });
      }
    }
  }

  return sites;
}

/**
 * Where a routine-carrying call keeps its time window and its waypoint.
 * `startM`/`stopM` are absent for `TA`, which is hour-only.
 */
interface RoutineArgIndex {
  startH: number;
  startM?: number;
  stopH: number;
  stopM?: number;
  waypoint: number;
}

/**
 * The two engine externals that actually install a routine entry, from their
 * own `Externals.d` signatures:
 *
 *   TA     (var C_Npc self, var int start_h,                var int stop_h,                var int state, var string waypoint)
 *   TA_MIN (var C_Npc self, var int start_h, var int start_m, var int stop_h, var int stop_m, var int state, var string waypoint)
 *
 * The waypoint indices agree with `ENGINE_EXTERNAL_WAYPOINT_ARG_INDEX` above,
 * which is the measured table — these are the same two rows with their time
 * slots added.
 */
const ROUTINE_EXTERNAL_ARG_INDEX: Record<string, RoutineArgIndex> = {
  ta: { startH: 1, stopH: 2, waypoint: 4 },
  ta_min: { startH: 1, startM: 2, stopH: 3, stopM: 4, waypoint: 6 }
};

const INTEGER_LITERAL = /^\d+$/;

const MINUTES_PER_DAY = 1440;

/**
 * Which argument of every routine-carrying function holds which part of a
 * window, seeded with the two externals and grown by **following the call**:
 * a `TA_*` wrapper passes its own parameters straight into `TA_MIN`, so the
 * wrapper's layout is read off which of its parameters land in slots already
 * known.
 *
 * This is `buildWaypointParamIndex`'s derivation rule — don't hardcode the
 * project's helper functions, read their own declaration — taken one step
 * further than
 * `buildWaypointParamIndex` needs to. That one can key on a parameter *named*
 * `waypoint`; a window has four parts and no such convention is measured, so
 * matching on names like `start_h` would be an assumption that fails silently
 * and totally on a mod that spells them differently. Following the call
 * assumes nothing but that the wrapper passes its parameters through, which is
 * the only thing a wrapper can do with them.
 *
 * The sweep repeats while it is still learning, so a wrapper around a wrapper
 * resolves too; retail has one level.
 */
export function buildRoutineParamIndex(
  fileModels: Array<{ semanticModel: SemanticModel }>
): Record<string, RoutineArgIndex> {
  const index: Record<string, RoutineArgIndex> = { ...ROUTINE_EXTERNAL_ARG_INDEX };

  let learned = true;
  while (learned) {
    learned = false;

    for (const { semanticModel } of fileModels) {
      for (const func of Object.values(semanticModel.functions || {})) {
        const key = func.name.toLowerCase();
        if (index[key]) continue;

        const parameterAt = new Map<string, number>();
        (func.parameters || []).forEach((param, position) => {
          if (param.name) parameterAt.set(param.name.toLowerCase(), position);
        });
        if (parameterAt.size === 0) continue;

        for (const call of func.callSites || []) {
          const carrier = index[call.functionName.toLowerCase()];
          if (!carrier) continue;

          // Which of this function's own parameters the carrier's slot is
          // handed. A literal or an expression there is not a pass-through:
          // the wrapper fixes that part of the window rather than taking it.
          const passedThrough = (slot: number | undefined): number | undefined => {
            if (slot === undefined) return undefined;
            const arg = call.args?.[slot];
            if (!arg || arg.isString || !BARE_IDENTIFIER.test(arg.raw)) return undefined;
            return parameterAt.get(arg.raw.toLowerCase());
          };

          const startH = passedThrough(carrier.startH);
          const stopH = passedThrough(carrier.stopH);
          const waypoint = passedThrough(carrier.waypoint);
          if (startH === undefined || stopH === undefined || waypoint === undefined) continue;

          index[key] = {
            startH,
            startM: passedThrough(carrier.startM),
            stopH,
            stopM: passedThrough(carrier.stopM),
            waypoint
          };
          learned = true;
          break;
        }
      }
    }
  }

  return index;
}

/**
 * Every routine entry in the project: the time window, the waypoint it puts the
 * NPC at, and the routine function it sits in (level-editor.md §16.19, the
 * slice the time slider waits on).
 *
 * Times come back as minutes since midnight — see `RoutineSite` for why hour 24
 * is 0 and what a window whose end is at or before its start means. An entry
 * whose hour, minute or waypoint is not a literal is **excluded, never
 * guessed**, the same hard rule the spawn index follows (§8, design brief
 * §5.1); a constant hour is as unresolvable here as a computed waypoint,
 * because the main process holds no semantic model of the project to resolve
 * one against.
 */
export function extractRoutineSites(
  fileModels: Array<{ filePath: string; semanticModel: SemanticModel }>
): RoutineSite[] {
  const argIndex = buildRoutineParamIndex(fileModels);
  const sites: RoutineSite[] = [];

  const literalInt = (raw: string | undefined, isString: boolean | undefined): number | undefined => {
    if (raw === undefined || isString || !INTEGER_LITERAL.test(raw)) return undefined;
    return Number.parseInt(raw, 10);
  };

  for (const { filePath, semanticModel } of fileModels) {
    for (const [functionName, func] of Object.entries(semanticModel.functions || {})) {
      for (const call of func.callSites || []) {
        const slots = argIndex[call.functionName.toLowerCase()];
        if (!slots) continue;

        const minuteOfDay = (hourSlot: number, minuteSlot: number | undefined) => {
          const hourArg = call.args?.[hourSlot];
          const hour = literalInt(hourArg?.raw, hourArg?.isString);
          if (hour === undefined) return undefined;
          if (minuteSlot === undefined) return (hour * 60) % MINUTES_PER_DAY;
          const minuteArg = call.args?.[minuteSlot];
          const minute = literalInt(minuteArg?.raw, minuteArg?.isString);
          if (minute === undefined) return undefined;
          return (hour * 60 + minute) % MINUTES_PER_DAY;
        };

        const startMinute = minuteOfDay(slots.startH, slots.startM);
        const endMinute = minuteOfDay(slots.stopH, slots.stopM);
        if (startMinute === undefined || endMinute === undefined) continue;

        const waypointArg = call.args?.[slots.waypoint];
        if (!waypointArg || !waypointArg.isString || !waypointArg.value) continue;

        sites.push({
          routine: functionName.toUpperCase(),
          startMinute,
          endMinute,
          waypoint: waypointArg.value.toUpperCase(),
          filePath,
          line: call.position.startLine
        });
      }
    }
  }

  return sites;
}

/**
 * UPPERCASED NPC instance to the UPPERCASED `daily_routine` it declares — the
 * half of a schedule `extractRoutineSites` cannot carry, because a routine
 * function is shared and knows nothing about who runs it.
 *
 * Declaring the field is the filter: an item instance has no `daily_routine`,
 * so no prototype-chain walk is needed to keep items out.
 *
 * It reads the same whole-project model list `extractRoutineSites` does rather
 * than riding the per-file worker pass `routines` uses, deliberately: both
 * halves of a schedule then come from one set of files, so an NPC never
 * resolves to a routine whose entries the index could not read.
 */
export function extractRoutinesByNpc(
  fileModels: Array<{ semanticModel: SemanticModel }>
): Record<string, string> {
  const byNpc: Record<string, string> = {};

  for (const { semanticModel } of fileModels) {
    for (const instance of Object.values(semanticModel.instances || {})) {
      if (!instance.name || !instance.dailyRoutine) continue;
      byNpc[instance.name.toUpperCase()] = instance.dailyRoutine.toUpperCase();
    }
  }

  return byNpc;
}

export function extractFileMetadataFromSource(sourceCode: string, filePath: string): ParsedFileMetadata {
  const parseResult = daedalusWrapper.parse(sourceCode);
  const tree = parseResult.tree;
  const visitor = new SemanticModelBuilderVisitor();

  visitor.checkForSyntaxErrors(tree.rootNode as any, sourceCode);

  // Try to build as much semantic state as possible, even if syntax errors exist.
  let modelComplete = false;
  try {
    visitor.pass1_createObjects(tree.rootNode as any);
    visitor.pass2_analyzeAndLink(tree.rootNode as any);
    modelComplete = true;
  } catch {
    // Keep partial semantic model for metadata extraction.
  }

  const semanticModel = visitor.semanticModel as SemanticModel;
  const { instances, prototypes } = extractInstanceAndPrototypeDeclarations(parseResult);

  return {
    dialogs: extractDialogs(semanticModel, filePath),
    instances,
    prototypes,
    isQuestFile: hasQuestTopicConstants(semanticModel) || hasQuestStateVariables(semanticModel),
    routines: extractDailyRoutines(semanticModel),
    voiceIds: extractVoiceIds(semanticModel),
    semanticModel: modelComplete && !semanticModel.hasErrors ? semanticModel : undefined
  };
}
