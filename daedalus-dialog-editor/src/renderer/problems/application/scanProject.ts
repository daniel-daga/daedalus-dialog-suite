import type { SemanticModel } from '../../../shared/types';
import type {
  FileFacts,
  FileModel,
  Problem,
  WaypointSites,
  WorldWaynetView
} from '../domain/types';
import { buildProjectView } from '../domain/projectView';
import { runRules } from '../domain/runRules';

/**
 * Application-layer adapter for the Problems panel. Store-agnostic: it takes the
 * already-parsed per-file models plus the project's known NPC names, builds the
 * aggregated view, and runs every lint rule. Kept separate from the store so it
 * can be unit-tested without React or Zustand.
 */
export interface ProjectScanInput {
  files: FileModel[];
  knownNpcNames: string[];
  /**
   * Optional per-model facts cache carried across scans by the caller: files
   * whose model object is unchanged since the last scan skip re-extraction
   * (see {@link buildProjectView}).
   */
  factsCache?: WeakMap<SemanticModel, FileFacts>;
  /** The project index's waypoint sites, for the `waypoint-not-in-world` rule. */
  waypointSites?: WaypointSites;
  /**
   * The waynet of the world currently open. Absent when there is none, and the
   * rule that reads it then returns nothing rather than calling every site
   * dangling.
   */
  world?: WorldWaynetView;
}

export interface ProjectScanResult {
  problems: Problem[];
  /** How many parsed files the scan actually saw. */
  scannedFileCount: number;
}

export function scanProject(input: ProjectScanInput): ProjectScanResult {
  const view = buildProjectView({
    files: input.files,
    knownNpcNames: input.knownNpcNames,
    factsCache: input.factsCache,
    waypointSites: input.waypointSites,
    world: input.world
  });
  return { problems: runRules(view), scannedFileCount: input.files.length };
}
