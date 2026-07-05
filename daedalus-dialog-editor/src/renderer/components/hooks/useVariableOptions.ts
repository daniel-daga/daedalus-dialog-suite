import { useMemo } from 'react';
import { useProjectStore } from '../../store/projectStore';
import { useFileStore } from '../../store/fileStore';
import type { SemanticModel, DialogMetadata } from '../../types/global';

export type VariableOptionSource = 'variable' | 'constant' | 'instance' | 'dialog' | 'new';

export interface VariableOption {
  name: string;
  type: string;
  source: VariableOptionSource;
  insertValue?: string;
  aliasOf?: string;
  filePath?: string;
  value?: string | number | boolean;
  isCreationSuggestion?: boolean;
}

export interface UseVariableOptionsConfig {
  /** Optional additional semantic model to merge with the global project model */
  semanticModel?: SemanticModel;
  /** Filter by variable/constant type (e.g. 'int', 'string') */
  typeFilter?: string | string[];
  /** Filter by name prefix (e.g. 'TOPIC_') */
  namePrefix?: string | string[];
  /** Whether to include instances (NPCs, items, etc.) */
  showInstances?: boolean;
  /** Whether to include dialogs from the project index */
  showDialogs?: boolean;
  /** Whether to include functions (e.g. routines) */
  showFunctions?: boolean;
  /** Whether to include daily routines from NPC instances */
  showRoutines?: boolean;
}

// ---------------------------------------------------------------------------
// Shared option pool (Phase 3 of docs/plans/dialog-open-latency.md)
//
// Building the full candidate list from ~11k project symbols and sorting it
// used to happen inside every mounted VariableAutocomplete field's own
// `useMemo` (28 call sites). The candidate-list assembly (flattening the
// constant/variable/instance/function/dialog records into arrays) is the
// expensive part at Gothic scale; it is identical for every field that reads
// the same project + active-file state, so it is hoisted into a module-level
// cache keyed by the identity of the underlying store references (mirrors the
// `mergeCache` idiom in `projectStore.ts`). Each field then only filters +
// dedups the (small) survivor set and sorts that, instead of the whole pool.
// ---------------------------------------------------------------------------

interface ConstVarCandidate {
  name: string;
  type: string;
  filePath?: string;
  value?: string | number | boolean;
}

interface InstanceCandidate {
  name: string;
  itemType: string;
  displayName?: string;
  dailyRoutine?: string;
  filePath?: string;
  value?: string | number | boolean;
}

interface FunctionCandidate {
  name: string;
  filePath?: string;
}

interface DialogCandidate {
  name: string;
  filePath?: string;
}

export interface OptionPool {
  /** local (active-file) + project constants, in that priority order */
  constants: ConstVarCandidate[];
  variables: ConstVarCandidate[];
  /** local + project `instances` records */
  instanceItems: InstanceCandidate[];
  /** local + project `npcs` records */
  npcItems: InstanceCandidate[];
  /** local + project `animations` records */
  animationItems: InstanceCandidate[];
  /** local + project functions */
  functions: FunctionCandidate[];
  /** project index NPC fallback list (reference, not copied) */
  npcList: string[];
  /** project index routine fallback list (reference, not copied) */
  routineList: string[];
  dialogs: DialogCandidate[];
}

export interface OptionPoolSources {
  projectConstants: Record<string, any> | undefined;
  projectVariables: Record<string, any> | undefined;
  projectInstances: Record<string, any> | undefined;
  projectNpcs: Record<string, any> | undefined;
  projectAnimations: Record<string, any> | undefined;
  projectFunctions: Record<string, any> | undefined;
  localConstants: Record<string, any> | undefined;
  localVariables: Record<string, any> | undefined;
  localInstances: Record<string, any> | undefined;
  localNpcs: Record<string, any> | undefined;
  localAnimations: Record<string, any> | undefined;
  localFunctions: Record<string, any> | undefined;
  dialogIndex: Map<string, DialogMetadata[]> | undefined;
  npcList: string[] | undefined;
  routineList: string[] | undefined;
}

const extractConstVarCandidates = (
  records: Array<Record<string, any> | undefined>
): ConstVarCandidate[] => {
  const out: ConstVarCandidate[] = [];
  for (const record of records) {
    if (!record) continue;
    for (const name in record) {
      const item = record[name];
      out.push({ name: item.name || name, type: item.type, filePath: item.filePath, value: item.value });
    }
  }
  return out;
};

const extractInstanceCandidates = (
  records: Array<Record<string, any> | undefined>
): InstanceCandidate[] => {
  const out: InstanceCandidate[] = [];
  for (const record of records) {
    if (!record) continue;
    for (const name in record) {
      const item = record[name];
      out.push({
        name: item.name || name,
        itemType: item.parent || 'instance',
        displayName: typeof item.displayName === 'string' ? item.displayName : undefined,
        dailyRoutine: typeof item.dailyRoutine === 'string' ? item.dailyRoutine : undefined,
        filePath: item.filePath,
        value: item.value
      });
    }
  }
  return out;
};

const extractFunctionCandidates = (
  records: Array<Record<string, any> | undefined>
): FunctionCandidate[] => {
  const out: FunctionCandidate[] = [];
  for (const record of records) {
    if (!record) continue;
    for (const name in record) {
      out.push({ name, filePath: record[name].filePath });
    }
  }
  return out;
};

const extractDialogCandidates = (
  dialogIndex: Map<string, DialogMetadata[]> | undefined
): DialogCandidate[] => {
  const out: DialogCandidate[] = [];
  if (!dialogIndex) return out;
  for (const dialogs of dialogIndex.values()) {
    for (const d of dialogs) {
      out.push({ name: d.dialogName, filePath: d.filePath });
    }
  }
  return out;
};

const buildOptionPoolFromSources = (sources: OptionPoolSources): OptionPool => ({
  constants: extractConstVarCandidates([sources.localConstants, sources.projectConstants]),
  variables: extractConstVarCandidates([sources.localVariables, sources.projectVariables]),
  instanceItems: extractInstanceCandidates([sources.localInstances, sources.projectInstances]),
  npcItems: extractInstanceCandidates([sources.localNpcs, sources.projectNpcs]),
  animationItems: extractInstanceCandidates([sources.localAnimations, sources.projectAnimations]),
  functions: extractFunctionCandidates([sources.localFunctions, sources.projectFunctions]),
  npcList: sources.npcList || [],
  routineList: sources.routineList || [],
  dialogs: extractDialogCandidates(sources.dialogIndex)
});

// Module-level (not per-hook-instance) cache: every mounted VariableAutocomplete
// field reads the same store references on a given render pass, so a single
// cache slot keyed by reference identity is shared and reused by all of them.
let poolCache: { signature: unknown[]; pool: OptionPool } | null = null;

const SOURCE_KEYS: Array<keyof OptionPoolSources> = [
  'projectConstants',
  'projectVariables',
  'projectInstances',
  'projectNpcs',
  'projectAnimations',
  'projectFunctions',
  'localConstants',
  'localVariables',
  'localInstances',
  'localNpcs',
  'localAnimations',
  'localFunctions',
  'dialogIndex',
  'npcList',
  'routineList'
];

/**
 * Builds (or reuses) the shared, unfiltered option pool. Reuses the previous
 * pool by reference when every source ref is `===` to the last build (mirrors
 * the `mergeCache` idiom in `projectStore.ts`).
 */
export const buildOptionPool = (sources: OptionPoolSources): OptionPool => {
  const signature: unknown[] = SOURCE_KEYS.map((key) => sources[key]);

  if (
    poolCache &&
    poolCache.signature.length === signature.length &&
    poolCache.signature.every((ref, i) => ref === signature[i])
  ) {
    return poolCache.pool;
  }

  const pool = buildOptionPoolFromSources(sources);
  poolCache = { signature, pool };
  return pool;
};

interface DeriveOptionsConfig {
  semanticModel?: SemanticModel;
  typeFilter?: string | string[];
  namePrefix?: string | string[];
  showInstances: boolean;
  showDialogs: boolean;
  showFunctions: boolean;
  showRoutines: boolean;
}

/**
 * Derives one field's option list from the shared pool. Preserves the exact
 * semantics of the original single-pass implementation: same-named entries
 * from every source are candidates (the pool does not dedup), and dedup via
 * `seenNames` only applies to entries that already passed this field's
 * `typeFilter`/`namePrefix`/`show*` gating — so a same-named entry excluded by
 * a filter never shadows a later, matching one. Source priority (highest
 * first) is: caller `semanticModel` > local (active file) > project; within
 * each, constant > variable > instance > dialog, matching the pre-Phase-3
 * behavior.
 */
export const deriveOptionsFromPool = (pool: OptionPool, config: DeriveOptionsConfig): VariableOption[] => {
  const { semanticModel, typeFilter, namePrefix, showInstances, showDialogs, showFunctions, showRoutines } = config;

  const opts: VariableOption[] = [];
  const seenNames = new Set<string>();

  const filters = typeFilter
    ? Array.isArray(typeFilter)
      ? typeFilter.map((f) => f.toLowerCase())
      : [typeFilter.toLowerCase()]
    : null;

  const prefixes = namePrefix
    ? Array.isArray(namePrefix)
      ? namePrefix.map((p) => p.toLowerCase())
      : [namePrefix.toLowerCase()]
    : null;

  const isTypeMatch = (type: string | undefined) => {
    if (!filters) return true;
    if (!type) return false;
    return filters.includes(type.toLowerCase());
  };

  const isNameMatch = (name: string) => {
    if (!prefixes) return true;
    const lowerName = name.toLowerCase();
    return prefixes.some((p) => lowerName.startsWith(p));
  };

  // Raw-record variant, used only for the (optional, per-field) caller
  // `semanticModel` — small, so no pool extraction is needed for it.
  const addFromRecord = (
    record: Record<string, any> | undefined,
    source: 'variable' | 'constant' | 'instance'
  ) => {
    if (!record) return;

    for (const name in record) {
      const item = record[name];
      const lowerName = name.toLowerCase();

      if (!seenNames.has(lowerName)) {
        const itemType = source === 'instance' ? item.parent || 'instance' : item.type;

        if (isTypeMatch(itemType) && isNameMatch(name)) {
          opts.push({
            name: item.name || name,
            type: itemType,
            source,
            insertValue: item.name || name,
            filePath: item.filePath,
            value: item.value
          });
          seenNames.add(lowerName);
        }

        if (
          source === 'instance' &&
          typeof item.displayName === 'string' &&
          item.displayName.trim() !== ''
        ) {
          const aliasName = item.displayName.trim();
          const aliasLower = aliasName.toLowerCase();
          const instanceName = item.name || name;
          if (
            aliasLower !== lowerName &&
            !seenNames.has(aliasLower) &&
            isTypeMatch(itemType) &&
            isNameMatch(aliasName)
          ) {
            opts.push({
              name: aliasName,
              type: itemType,
              source,
              insertValue: instanceName,
              aliasOf: instanceName,
              filePath: item.filePath,
              value: item.value
            });
            seenNames.add(aliasLower);
          }
        }
      }
    }
  };

  const addFunctionsFromRecord = (record: Record<string, any> | undefined) => {
    if (!record) return;
    for (const name in record) {
      const lowerName = name.toLowerCase();
      if (!seenNames.has(lowerName) && isNameMatch(name)) {
        opts.push({ name, type: 'function', source: 'instance', filePath: record[name].filePath });
        seenNames.add(lowerName);
      }
    }
  };

  const addRoutinesFromRecord = (record: Record<string, any> | undefined) => {
    if (!record) return;
    for (const item of Object.values(record)) {
      const it = item as any;
      if (typeof it.dailyRoutine !== 'string' || !it.dailyRoutine) continue;
      const lowerName = it.dailyRoutine.toLowerCase();
      if (!seenNames.has(lowerName) && isNameMatch(it.dailyRoutine)) {
        opts.push({ name: it.dailyRoutine, type: 'routine', source: 'instance', filePath: it.filePath });
        seenNames.add(lowerName);
      }
    }
  };

  // Pre-extracted-candidate variants, used for the shared (local + project) pool.
  const addConstVarFromCandidates = (candidates: ConstVarCandidate[], source: 'constant' | 'variable') => {
    for (const c of candidates) {
      const lowerName = c.name.toLowerCase();
      if (!seenNames.has(lowerName) && isTypeMatch(c.type) && isNameMatch(c.name)) {
        opts.push({ name: c.name, type: c.type, source, insertValue: c.name, filePath: c.filePath, value: c.value });
        seenNames.add(lowerName);
      }
    }
  };

  const addInstanceFromCandidates = (candidates: InstanceCandidate[]) => {
    for (const c of candidates) {
      const lowerName = c.name.toLowerCase();
      if (!seenNames.has(lowerName)) {
        if (isTypeMatch(c.itemType) && isNameMatch(c.name)) {
          opts.push({
            name: c.name,
            type: c.itemType,
            source: 'instance',
            insertValue: c.name,
            filePath: c.filePath,
            value: c.value
          });
          seenNames.add(lowerName);
        }

        if (c.displayName && c.displayName.trim() !== '') {
          const aliasName = c.displayName.trim();
          const aliasLower = aliasName.toLowerCase();
          if (
            aliasLower !== lowerName &&
            !seenNames.has(aliasLower) &&
            isTypeMatch(c.itemType) &&
            isNameMatch(aliasName)
          ) {
            opts.push({
              name: aliasName,
              type: c.itemType,
              source: 'instance',
              insertValue: c.name,
              aliasOf: c.name,
              filePath: c.filePath,
              value: c.value
            });
            seenNames.add(aliasLower);
          }
        }
      }
    }
  };

  const addFunctionsFromCandidates = (candidates: FunctionCandidate[]) => {
    for (const c of candidates) {
      const lowerName = c.name.toLowerCase();
      if (!seenNames.has(lowerName) && isNameMatch(c.name)) {
        opts.push({ name: c.name, type: 'function', source: 'instance', filePath: c.filePath });
        seenNames.add(lowerName);
      }
    }
  };

  const addRoutinesFromCandidates = (candidates: InstanceCandidate[]) => {
    for (const c of candidates) {
      if (!c.dailyRoutine) continue;
      const lowerName = c.dailyRoutine.toLowerCase();
      if (!seenNames.has(lowerName) && isNameMatch(c.dailyRoutine)) {
        opts.push({ name: c.dailyRoutine, type: 'routine', source: 'instance', filePath: c.filePath });
        seenNames.add(lowerName);
      }
    }
  };

  // Constants (highest priority for same names)
  addFromRecord(semanticModel?.constants, 'constant');
  addConstVarFromCandidates(pool.constants, 'constant');

  // Variables
  addFromRecord(semanticModel?.variables, 'variable');
  addConstVarFromCandidates(pool.variables, 'variable');

  // Instances
  if (showInstances) {
    addFromRecord(semanticModel?.instances, 'instance');
    addInstanceFromCandidates(pool.instanceItems);
    addFromRecord(semanticModel?.npcs, 'instance');
    addInstanceFromCandidates(pool.npcItems);
    addFromRecord(semanticModel?.animations, 'instance');
    addInstanceFromCandidates(pool.animationItems);

    // Fallback: project index NPC list
    for (const npcName of pool.npcList) {
      const lowerName = npcName.toLowerCase();
      if (!seenNames.has(lowerName) && isTypeMatch('C_NPC') && isNameMatch(npcName)) {
        opts.push({ name: npcName, type: 'C_NPC', source: 'instance' });
        seenNames.add(lowerName);
      }
    }
  }

  // Functions
  if (showFunctions) {
    addFunctionsFromRecord(semanticModel?.functions);
    addFunctionsFromCandidates(pool.functions);
  }

  // Daily routines
  if (showRoutines) {
    addRoutinesFromRecord(semanticModel?.instances);
    addRoutinesFromCandidates(pool.instanceItems);
    addRoutinesFromRecord(semanticModel?.npcs);
    addRoutinesFromCandidates(pool.npcItems);

    // Fallback: project index routine list
    for (const routineName of pool.routineList) {
      const lowerName = routineName.toLowerCase();
      if (!seenNames.has(lowerName) && isNameMatch(routineName)) {
        opts.push({ name: routineName, type: 'routine', source: 'instance' });
        seenNames.add(lowerName);
      }
    }
  }

  // Dialogs
  if (showDialogs) {
    for (const d of pool.dialogs) {
      const lowerName = d.name.toLowerCase();
      if (!seenNames.has(lowerName) && isTypeMatch('C_INFO') && isNameMatch(d.name)) {
        opts.push({ name: d.name, type: 'C_INFO', source: 'dialog', filePath: d.filePath });
        seenNames.add(lowerName);
      }
    }
  }

  return opts.sort((a, b) => a.name.localeCompare(b.name));
};

/**
 * Builds and memoises the full list of autocomplete options for
 * `VariableAutocomplete`.  Fetches data from `useProjectStore` and merges in
 * an optional caller-provided `semanticModel`.
 */
export function useVariableOptions({
  semanticModel,
  typeFilter,
  namePrefix,
  showInstances = false,
  showDialogs = false,
  showFunctions = false,
  showRoutines = false
}: UseVariableOptionsConfig): VariableOption[] {
  // Subscribe to each field individually so autocomplete consumers only
  // re-render when one of these actually changes, not on every projectStore
  // mutation (e.g. ingestion progress, selection changes). The merged model is
  // subscribed per category (not by whole-model identity) so the category-
  // stable merge (§2.1) lets an edit touching only functions skip the full
  // option rebuild+sort for constants/variables/instances.
  const projectConstants = useProjectStore((s) => s.mergedSemanticModel.constants);
  const projectVariables = useProjectStore((s) => s.mergedSemanticModel.variables);
  const projectInstances = useProjectStore((s) => s.mergedSemanticModel.instances);
  const projectNpcs = useProjectStore((s) => s.mergedSemanticModel.npcs);
  const projectAnimations = useProjectStore((s) => s.mergedSemanticModel.animations);
  const projectFunctions = useProjectStore((s) => s.mergedSemanticModel.functions);
  const dialogIndex = useProjectStore((s) => s.dialogIndex);
  const npcList = useProjectStore((s) => s.npcList);
  const routineList = useProjectStore((s) => s.routineList);

  // Active-file model, read per category from the file store. This replaces the
  // per-renderer `semanticModel` local-model prop that action renderers used to
  // thread (fix-07 §2.8): in single-file mode the merged project model is empty,
  // so the edited file's own symbols are only available here. Each read selects a
  // single category ref, so an action edit that leaves a category untouched does
  // not rebuild options.
  const localConstants = useFileStore((s) => (s.activeFile ? s.openFiles.get(s.activeFile)?.semanticModel?.constants : undefined));
  const localVariables = useFileStore((s) => (s.activeFile ? s.openFiles.get(s.activeFile)?.semanticModel?.variables : undefined));
  const localInstances = useFileStore((s) => (s.activeFile ? s.openFiles.get(s.activeFile)?.semanticModel?.instances : undefined));
  const localNpcs = useFileStore((s) => (s.activeFile ? s.openFiles.get(s.activeFile)?.semanticModel?.npcs : undefined));
  const localAnimations = useFileStore((s) => (s.activeFile ? s.openFiles.get(s.activeFile)?.semanticModel?.animations : undefined));
  const localFunctions = useFileStore((s) => (s.activeFile ? s.openFiles.get(s.activeFile)?.semanticModel?.functions : undefined));

  // Shared pool: built once per source-identity change and reused by every
  // mounted VariableAutocomplete field (see `buildOptionPool` above).
  const pool = buildOptionPool({
    projectConstants,
    projectVariables,
    projectInstances,
    projectNpcs,
    projectAnimations,
    projectFunctions,
    localConstants,
    localVariables,
    localInstances,
    localNpcs,
    localAnimations,
    localFunctions,
    dialogIndex,
    npcList,
    routineList
  });

  return useMemo(
    () => deriveOptionsFromPool(pool, { semanticModel, typeFilter, namePrefix, showInstances, showDialogs, showFunctions, showRoutines }),
    [pool, semanticModel, typeFilter, namePrefix, showInstances, showDialogs, showFunctions, showRoutines]
  );
}
