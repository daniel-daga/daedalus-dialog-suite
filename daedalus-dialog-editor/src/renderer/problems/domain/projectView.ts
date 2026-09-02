import type { SemanticModel, SpawnSite } from '../../../shared/types';
import type { PortalFinding } from '../../../shared/worldTypes';
import type {
  FileFacts,
  FileFactsEntry,
  FileModel,
  FunctionEntry,
  ProjectView,
  WaypointSites,
  WorldWaynetView
} from './types';
import { extractFileFacts } from './fileFacts';

const key = (name: string): string => name.trim().toLowerCase();

/**
 * Builds an aggregated {@link ProjectView} from the parsed per-file models.
 *
 * `knownNpcNames` are the project-index NPC names (npcList ∪ npcPrototypes) that
 * already resolve prototype/instance chains to C_NPC; any file-local instance
 * whose parent is C_NPC is folded in as well so a freshly-added NPC still counts
 * before the next reindex.
 *
 * When `factsCache` is provided, files whose model object is already in the
 * cache skip fact extraction (the per-file walks are the expensive part of a
 * scan; models are immutable, so identity implies unchanged facts). The
 * cross-file aggregates below are always rebuilt — they are cheap and any
 * file's change can affect every other file's problems.
 */
export function buildProjectView(input: {
  files: FileModel[];
  knownNpcNames: string[];
  factsCache?: WeakMap<SemanticModel, FileFacts>;
  waypointSites?: WaypointSites;
  spawnSites?: readonly SpawnSite[];
  npcsWithDialogs?: readonly string[];
  world?: WorldWaynetView;
  portalFindings?: readonly PortalFinding[];
}): ProjectView {
  const {
    files, knownNpcNames, factsCache, waypointSites, spawnSites, npcsWithDialogs, world, portalFindings,
  } = input;

  const fileFacts: FileFactsEntry[] = files.map(({ filePath, model }) => {
    let facts = factsCache?.get(model);
    if (!facts) {
      facts = extractFileFacts(model);
      factsCache?.set(model, facts);
    }
    return { filePath, facts };
  });

  const dialogNameKeys = new Set<string>();
  const functionsByKey = new Map<string, FunctionEntry>();
  const npcNameKeys = new Set<string>(knownNpcNames.map(key));

  for (const { filePath, facts } of fileFacts) {
    for (const dialog of facts.dialogs) {
      dialogNameKeys.add(key(dialog.name));
    }
    for (const func of facts.functions) {
      functionsByKey.set(key(func.name), { func, filePath });
    }
    for (const npcName of facts.npcNames) {
      npcNameKeys.add(key(npcName));
    }
  }

  return {
    fileFacts,
    dialogNameKeys,
    npcNameKeys,
    functionsByKey,
    waypointSites: waypointSites ?? {},
    spawnSites: spawnSites ?? [],
    dialogNpcKeys: new Set((npcsWithDialogs ?? []).map((name) => name.trim().toUpperCase())),
    world,
    portalFindings
  };
}
