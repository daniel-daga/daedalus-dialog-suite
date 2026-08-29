import type { DialogMetadata, SemanticModel, SpawnSite } from '../../shared/types';
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
