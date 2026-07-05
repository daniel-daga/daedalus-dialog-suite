import {
  buildOptionPool,
  deriveOptionsFromPool,
  type OptionPoolSources,
  type VariableOption
} from '../src/renderer/components/hooks/useVariableOptions';

/**
 * Reference implementation: a verbatim copy of the pre-Phase-3 algorithm
 * (single pass over raw records, filter-then-dedup-then-sort). Used to prove
 * the pool-based rewrite produces byte-for-byte identical output, including
 * the shadowing subtlety described in docs/plans/dialog-open-latency.md
 * §Phase 3: a same-named entry excluded by a filter must not shadow a later,
 * matching entry from a lower-priority source.
 */
function legacyBuildOptions(sources: {
  semanticModel?: Record<string, any>;
  localConstants?: Record<string, any>;
  localVariables?: Record<string, any>;
  localInstances?: Record<string, any>;
  localNpcs?: Record<string, any>;
  localAnimations?: Record<string, any>;
  localFunctions?: Record<string, any>;
  projectConstants?: Record<string, any>;
  projectVariables?: Record<string, any>;
  projectInstances?: Record<string, any>;
  projectNpcs?: Record<string, any>;
  projectAnimations?: Record<string, any>;
  projectFunctions?: Record<string, any>;
  dialogIndex?: Map<string, Array<{ dialogName: string; filePath: string }>>;
  npcList?: string[];
  routineList?: string[];
}, config: {
  typeFilter?: string | string[];
  namePrefix?: string | string[];
  showInstances?: boolean;
  showDialogs?: boolean;
  showFunctions?: boolean;
  showRoutines?: boolean;
}): VariableOption[] {
  const semanticModel = sources.semanticModel;
  const {
    localConstants, localVariables, localInstances, localNpcs, localAnimations, localFunctions,
    projectConstants, projectVariables, projectInstances, projectNpcs, projectAnimations, projectFunctions,
    dialogIndex, npcList, routineList
  } = sources;
  const { typeFilter, namePrefix, showInstances = false, showDialogs = false, showFunctions = false, showRoutines = false } = config;

  const opts: VariableOption[] = [];
  const seenNames = new Set<string>();

  const filters = typeFilter
    ? Array.isArray(typeFilter) ? typeFilter.map((f) => f.toLowerCase()) : [typeFilter.toLowerCase()]
    : null;
  const prefixes = namePrefix
    ? Array.isArray(namePrefix) ? namePrefix.map((p) => p.toLowerCase()) : [namePrefix.toLowerCase()]
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

  const addFromRecord = (record: Record<string, any> | undefined, source: 'variable' | 'constant' | 'instance') => {
    if (!record) return;
    for (const name in record) {
      const item = record[name];
      const lowerName = name.toLowerCase();
      if (!seenNames.has(lowerName)) {
        const itemType = source === 'instance' ? item.parent || 'instance' : item.type;
        if (isTypeMatch(itemType) && isNameMatch(name)) {
          opts.push({ name: item.name || name, type: itemType, source, insertValue: item.name || name, filePath: item.filePath, value: item.value });
          seenNames.add(lowerName);
        }
        if (source === 'instance' && typeof item.displayName === 'string' && item.displayName.trim() !== '') {
          const aliasName = item.displayName.trim();
          const aliasLower = aliasName.toLowerCase();
          const instanceName = item.name || name;
          if (aliasLower !== lowerName && !seenNames.has(aliasLower) && isTypeMatch(itemType) && isNameMatch(aliasName)) {
            opts.push({ name: aliasName, type: itemType, source, insertValue: instanceName, aliasOf: instanceName, filePath: item.filePath, value: item.value });
            seenNames.add(aliasLower);
          }
        }
      }
    }
  };

  addFromRecord(semanticModel?.constants, 'constant');
  addFromRecord(localConstants, 'constant');
  addFromRecord(projectConstants, 'constant');

  addFromRecord(semanticModel?.variables, 'variable');
  addFromRecord(localVariables, 'variable');
  addFromRecord(projectVariables, 'variable');

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

    for (const npcName of npcList || []) {
      const lowerName = npcName.toLowerCase();
      if (!seenNames.has(lowerName) && isTypeMatch('C_NPC') && isNameMatch(npcName)) {
        opts.push({ name: npcName, type: 'C_NPC', source: 'instance' });
        seenNames.add(lowerName);
      }
    }
  }

  if (showFunctions) {
    const addFunctions = (record: Record<string, any> | undefined) => {
      if (!record) return;
      for (const name in record) {
        const lowerName = name.toLowerCase();
        if (!seenNames.has(lowerName) && isNameMatch(name)) {
          opts.push({ name, type: 'function', source: 'instance', filePath: record[name].filePath });
          seenNames.add(lowerName);
        }
      }
    };
    addFunctions(semanticModel?.functions);
    addFunctions(localFunctions);
    addFunctions(projectFunctions);
  }

  if (showRoutines) {
    const addRoutinesFromInstances = (record: Record<string, any> | undefined) => {
      if (!record) return;
      for (const item of Object.values(record)) {
        if (typeof item.dailyRoutine !== 'string' || !item.dailyRoutine) continue;
        const lowerName = item.dailyRoutine.toLowerCase();
        if (!seenNames.has(lowerName) && isNameMatch(item.dailyRoutine)) {
          opts.push({ name: item.dailyRoutine, type: 'routine', source: 'instance', filePath: item.filePath });
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

    for (const routineName of routineList || []) {
      const lowerName = routineName.toLowerCase();
      if (!seenNames.has(lowerName) && isNameMatch(routineName)) {
        opts.push({ name: routineName, type: 'routine', source: 'instance' });
        seenNames.add(lowerName);
      }
    }
  }

  if (showDialogs && dialogIndex) {
    for (const dialogs of dialogIndex.values()) {
      for (const d of dialogs) {
        const lowerName = d.dialogName.toLowerCase();
        if (!seenNames.has(lowerName) && isTypeMatch('C_INFO') && isNameMatch(d.dialogName)) {
          opts.push({ name: d.dialogName, type: 'C_INFO', source: 'dialog', filePath: d.filePath });
          seenNames.add(lowerName);
        }
      }
    }
  }

  return opts.sort((a, b) => a.name.localeCompare(b.name));
}

describe('useVariableOptions shared pool (Phase 3)', () => {
  const baseSources: OptionPoolSources = {
    projectConstants: undefined,
    projectVariables: undefined,
    projectInstances: undefined,
    projectNpcs: undefined,
    projectAnimations: undefined,
    projectFunctions: undefined,
    localConstants: undefined,
    localVariables: undefined,
    localInstances: undefined,
    localNpcs: undefined,
    localAnimations: undefined,
    localFunctions: undefined,
    dialogIndex: undefined,
    npcList: undefined,
    routineList: undefined
  };

  describe('identity + recompute', () => {
    test('returns the same pool identity across calls when every source ref is unchanged', () => {
      const sources: OptionPoolSources = {
        ...baseSources,
        projectConstants: { C_A: { name: 'C_A', type: 'int', value: 1, filePath: '/a.d' } },
        projectVariables: { V_B: { name: 'V_B', type: 'int', filePath: '/b.d' } }
      };

      const pool1 = buildOptionPool(sources);
      const pool2 = buildOptionPool({ ...sources }); // fresh options object, same inner refs

      expect(pool2).toBe(pool1);
      expect(pool2.constants).toBe(pool1.constants);
      expect(pool2.variables).toBe(pool1.variables);
    });

    test('rebuilds when one category ref changes', () => {
      const constants1 = { C_A: { name: 'C_A', type: 'int', value: 1, filePath: '/a.d' } };
      const sources1: OptionPoolSources = { ...baseSources, projectConstants: constants1 };
      const pool1 = buildOptionPool(sources1);

      const constants2 = { C_A: { name: 'C_A', type: 'int', value: 1, filePath: '/a.d' } }; // same content, new object
      const sources2: OptionPoolSources = { ...baseSources, projectConstants: constants2 };
      const pool2 = buildOptionPool(sources2);

      expect(pool2).not.toBe(pool1);
      expect(pool2.constants).not.toBe(pool1.constants);
      // Content is still equivalent even though it was rebuilt.
      expect(pool2.constants).toEqual(pool1.constants);
    });

    test('rebuilding for an unrelated source config does not corrupt a later identical call', () => {
      const constants = { C_A: { name: 'C_A', type: 'int', value: 1, filePath: '/a.d' } };
      const sourcesA: OptionPoolSources = { ...baseSources, projectConstants: constants };
      const poolA1 = buildOptionPool(sourcesA);

      // A different config forces a rebuild (invalidating the cache slot)...
      const otherConstants = { C_B: { name: 'C_B', type: 'int', value: 2, filePath: '/b.d' } };
      buildOptionPool({ ...baseSources, projectConstants: otherConstants });

      // ...but calling with the ORIGINAL refs again must rebuild fresh (not
      // return the stale poolA1 identity, and not return the "other" pool).
      const poolA2 = buildOptionPool(sourcesA);
      expect(poolA2.constants).toEqual(poolA1.constants);
      expect(poolA2.constants[0].name).toBe('C_A');
    });
  });

  describe('filter parity with the legacy single-pass implementation', () => {
    // A constant named SHADOW that a typeFilter of 'int' excludes (it's a
    // string), and a variable also named SHADOW that the same filter matches
    // (it's an int). The excluded constant must NOT shadow the variable.
    const projectConstants = {
      C_A: { name: 'C_A', type: 'int', value: 1, filePath: '/a.d' },
      SHADOW: { name: 'SHADOW', type: 'string', value: 'nope', filePath: '/a.d' }
    };
    const projectVariables = {
      V_B: { name: 'V_B', type: 'int', filePath: '/b.d' },
      SHADOW: { name: 'SHADOW', type: 'int', filePath: '/b.d' }
    };
    const projectInstances = {
      NPC_A: { name: 'NPC_A', parent: 'C_NPC', displayName: 'Alan', dailyRoutine: 'RTN_Start', filePath: '/npc.d' }
    };
    const projectFunctions = {
      fn_test: { filePath: '/f.d' }
    };
    const npcList = ['NPC_FALLBACK'];
    const routineList = ['RTN_Fallback'];
    const dialogIndex = new Map([
      ['NPC_A', [{ dialogName: 'DIA_Test', npc: 'NPC_A', filePath: '/d.d' }]]
    ]);

    const rawSources = {
      projectConstants, projectVariables, projectInstances, projectFunctions,
      npcList, routineList, dialogIndex
    };
    const poolSources: OptionPoolSources = {
      ...baseSources, projectConstants, projectVariables, projectInstances, projectFunctions, npcList, routineList, dialogIndex
    };

    const configs: Array<{ name: string; config: Parameters<typeof legacyBuildOptions>[1] }> = [
      { name: 'no filters, no show flags', config: {} },
      { name: 'typeFilter int (shadowing case)', config: { typeFilter: 'int' } },
      { name: 'namePrefix V_', config: { namePrefix: 'V_' } },
      { name: 'showInstances (alias + npcList fallback)', config: { showInstances: true } },
      { name: 'showInstances + typeFilter C_NPC', config: { showInstances: true, typeFilter: 'C_NPC' } },
      { name: 'showDialogs', config: { showDialogs: true } },
      { name: 'showRoutines (instance dailyRoutine + fallback)', config: { showRoutines: true } },
      { name: 'showFunctions', config: { showFunctions: true } },
      { name: 'everything on', config: { showInstances: true, showDialogs: true, showRoutines: true, showFunctions: true } }
    ];

    test.each(configs)('$name', ({ config }) => {
      const expected = legacyBuildOptions(rawSources, config);
      const pool = buildOptionPool(poolSources);
      const actual = deriveOptionsFromPool(pool, config);
      expect(actual).toEqual(expected);
    });

    test('the shadowing case specifically: SHADOW resolves to the variable, not the excluded constant', () => {
      const pool = buildOptionPool(poolSources);
      const actual = deriveOptionsFromPool(pool, { typeFilter: 'int' });
      const shadow = actual.find((o) => o.name === 'SHADOW');
      expect(shadow).toBeDefined();
      expect(shadow?.source).toBe('variable');
      expect(shadow?.type).toBe('int');
    });

    test('a caller-provided semanticModel takes priority over local and project sources', () => {
      const pool = buildOptionPool(poolSources);
      const semanticModel = {
        constants: { C_A: { name: 'C_A', type: 'int', value: 999, filePath: '/override.d' } }
      } as any;
      const actual = deriveOptionsFromPool(pool, { semanticModel });
      const cA = actual.find((o) => o.name === 'C_A');
      expect(cA?.filePath).toBe('/override.d');
      expect(cA?.value).toBe(999);
    });

    test('local (active-file) sources take priority over project sources for the same name', () => {
      const localConstants = { C_A: { name: 'C_A', type: 'int', value: 42, filePath: '/local.d' } };
      const sources: OptionPoolSources = { ...poolSources, localConstants };
      const pool = buildOptionPool(sources);
      const actual = deriveOptionsFromPool(pool, {});
      const cA = actual.find((o) => o.name === 'C_A');
      expect(cA?.filePath).toBe('/local.d');
      expect(cA?.value).toBe(42);

      const expected = legacyBuildOptions({ ...rawSources, localConstants }, {});
      expect(actual).toEqual(expected);
    });
  });
});
