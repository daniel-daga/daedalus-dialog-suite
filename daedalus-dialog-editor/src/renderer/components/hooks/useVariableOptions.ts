import { useMemo } from 'react';
import { useProjectStore } from '../../store/projectStore';
import { useFileStore } from '../../store/fileStore';
import type { SemanticModel } from '../../types/global';

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

  return useMemo(() => {
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

          // For item instances, support matching by display name while inserting instance id.
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

    // Constants (highest priority for same names)
    addFromRecord(semanticModel?.constants, 'constant');
    addFromRecord(localConstants, 'constant');
    addFromRecord(projectConstants, 'constant');

    // Variables
    addFromRecord(semanticModel?.variables, 'variable');
    addFromRecord(localVariables, 'variable');
    addFromRecord(projectVariables, 'variable');

    // Instances
    if (showInstances) {
      addFromRecord(semanticModel?.instances, 'instance');
      addFromRecord(localInstances, 'instance');
      addFromRecord(projectInstances, 'instance');
      addFromRecord(semanticModel?.npcs, 'instance');
      addFromRecord(localNpcs, 'instance');
      addFromRecord(projectNpcs, 'instance');
      addFromRecord(semanticModel?.animations, 'instance');
      addFromRecord(localAnimations, 'instance');
      addFromRecord(projectAnimations, 'instance');

      // Fallback: project index NPC list
      for (const npcName of npcList || []) {
        const lowerName = npcName.toLowerCase();
        if (!seenNames.has(lowerName) && isTypeMatch('C_NPC') && isNameMatch(npcName)) {
          opts.push({ name: npcName, type: 'C_NPC', source: 'instance' });
          seenNames.add(lowerName);
        }
      }
    }

    // Functions
    if (showFunctions) {
      const addFunctions = (record: Record<string, any> | undefined) => {
        if (!record) return;
        for (const name in record) {
          const lowerName = name.toLowerCase();
          if (!seenNames.has(lowerName) && isNameMatch(name)) {
            opts.push({
              name,
              type: 'function',
              source: 'instance',
              filePath: record[name].filePath
            });
            seenNames.add(lowerName);
          }
        }
      };
      addFunctions(semanticModel?.functions);
      addFunctions(localFunctions);
      addFunctions(projectFunctions);
    }

    // Daily routines
    if (showRoutines) {
      const addRoutinesFromInstances = (record: Record<string, any> | undefined) => {
        if (!record) return;
        for (const item of Object.values(record)) {
          if (typeof item.dailyRoutine !== 'string' || !item.dailyRoutine) continue;
          const lowerName = item.dailyRoutine.toLowerCase();
          if (!seenNames.has(lowerName) && isNameMatch(item.dailyRoutine)) {
            opts.push({
              name: item.dailyRoutine,
              type: 'routine',
              source: 'instance',
              filePath: item.filePath
            });
            seenNames.add(lowerName);
          }
        }
      };
      addRoutinesFromInstances(semanticModel?.instances);
      addRoutinesFromInstances(localInstances);
      addRoutinesFromInstances(projectInstances);
      addRoutinesFromInstances(semanticModel?.npcs);
      addRoutinesFromInstances(localNpcs);
      addRoutinesFromInstances(projectNpcs);

      // Fallback: project index routine list
      for (const routineName of routineList || []) {
        const lowerName = routineName.toLowerCase();
        if (!seenNames.has(lowerName) && isNameMatch(routineName)) {
          opts.push({ name: routineName, type: 'routine', source: 'instance' });
          seenNames.add(lowerName);
        }
      }
    }

    // Dialogs
    if (showDialogs && dialogIndex) {
      for (const dialogs of dialogIndex.values()) {
        for (const d of dialogs) {
          const lowerName = d.dialogName.toLowerCase();
          if (!seenNames.has(lowerName) && isTypeMatch('C_INFO') && isNameMatch(d.dialogName)) {
            opts.push({
              name: d.dialogName,
              type: 'C_INFO',
              source: 'dialog',
              filePath: d.filePath
            });
            seenNames.add(lowerName);
          }
        }
      }
    }

    return opts.sort((a, b) => a.name.localeCompare(b.name));
  }, [
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
    semanticModel,
    typeFilter,
    namePrefix,
    showInstances,
    showDialogs,
    showFunctions,
    showRoutines,
    dialogIndex,
    npcList,
    routineList
  ]);
}
