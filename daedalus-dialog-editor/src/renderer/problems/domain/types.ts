import type { SemanticModel, SpawnSite } from '../../../shared/types';

/**
 * Domain types for the project-wide Problems panel.
 *
 * This layer is pure: no React, MUI, Electron, or store imports. Rules are pure
 * functions over an aggregated {@link ProjectView} built from the parsed
 * per-file semantic models the renderer already caches.
 */

export type ProblemSeverity = 'error' | 'warning';

export type ProblemRuleId =
  | 'npc-not-found'
  | 'knowsinfo-dangling'
  | 'choice-no-clearchoices'
  | 'orphaned-function'
  | 'voice-id-duplicate'
  | 'voice-id-malformed'
  | 'waypoint-not-in-world'
  | 'duplicate-spawn';

/**
 * A problem in the scripts: a declaration in a file, which is what the panel
 * navigates to by opening the file and selecting the symbol.
 */
export interface ScriptLocus {
  kind: 'script';
  /** File that owns the offending declaration. */
  filePath: string;
  /** NPC the offending dialog belongs to, when applicable. */
  npc?: string;
  /** Dialog the problem points at, used for navigation. */
  dialogName?: string;
  /** Function the problem points at, used for navigation. */
  functionName?: string;
  /**
   * The waypoint name a `waypoint-not-in-world` finding names, in the script's
   * own casing. Carried so the Problems panel's "Add to world" action has a
   * name to hand `AddWaypoint` without parsing one back out of `message`.
   */
  waypoint?: string;
}

/**
 * A problem in the open world. It has no file, no dialog and no function —
 * which is why `Problem` carries a union rather than a file path (§16.20).
 * Every field is an address into the world that was open when the scan ran:
 * names where the world has them, indices where it does not.
 */
export interface WorldLocus {
  kind: 'world';
  /** Name of the offending waynet point. */
  waypoint?: string;
  /** Index of the offending VOB in the world summary, as of the scan. */
  vob?: number;
  /** Index of the offending world-mesh polygon, as of the scan. */
  polygon?: number;
}

/** Where a problem is. */
export type ProblemLocus = ScriptLocus | WorldLocus;

export interface Problem {
  /** Stable key for React lists and cross-scan dedupe. */
  id: string;
  rule: ProblemRuleId;
  severity: ProblemSeverity;
  /** Human-readable, self-contained description. */
  message: string;
  /** Where the problem is, and what navigating to it means. */
  locus: ProblemLocus;
}

/** One parsed file: its path and full semantic model. */
export interface FileModel {
  filePath: string;
  model: SemanticModel;
}

/**
 * Everything the lint rules need to know about one dialog, precomputed from its
 * model object. Reference properties are resolved to plain function names.
 */
export interface DialogFacts {
  name: string;
  /** Raw `npc` property when it is a string (may be empty/whitespace). */
  npc?: string;
  /** Function name of the `information` property, when present. */
  informationRef?: string;
  /** Function name of the `condition` property, when present. */
  conditionRef?: string;
}

/**
 * Everything the lint rules need to know about one function, precomputed by a
 * single walk over its (possibly nested) actions and conditions.
 */
export interface FunctionFacts {
  name: string;
  /** True when the function contains at least one `Choice` action. */
  hasChoice: boolean;
  /** True when the function contains at least one `ClearChoicesAction`. */
  hasClearChoices: boolean;
  /** Raw `Choice.targetFunction` names in encounter order. */
  choiceTargets: string[];
  /** The function's `calls` list. */
  calls: string[];
  /** Non-empty `Npc_KnowsInfo` dialog refs with their condition index. */
  knowsInfoRefs: Array<{ index: number; dialogRef: string }>;
  /** Literal, non-empty voice ids in encounter order. */
  voiceIds: string[];
}

/**
 * Per-file lint inputs derived from a semantic model. Pure function of the
 * model object, so it can be cached against the model's identity — everything
 * cross-file (name sets, reference graph, duplicates) is aggregated later.
 */
export interface FileFacts {
  dialogs: DialogFacts[];
  functions: FunctionFacts[];
  /** Names of file-local C_NPC instances plus `npcs` entries. */
  npcNames: string[];
}

/** One file's facts together with its path. */
export interface FileFactsEntry {
  filePath: string;
  facts: FileFacts;
}

/** A dialog function's facts together with the file that declares it. */
export interface FunctionEntry {
  func: FunctionFacts;
  filePath: string;
}

/**
 * Aggregated, case-insensitive project view built from every parsed file.
 * The `*Keys` sets hold lowercased names for existence checks; the original
 * casing is preserved on the underlying facts for display.
 */
export interface ProjectView {
  fileFacts: FileFactsEntry[];
  /** Lowercased names of every dialog across the project. */
  dialogNameKeys: ReadonlySet<string>;
  /** Lowercased names of every known NPC (C_NPC instances + prototypes). */
  npcNameKeys: ReadonlySet<string>;
  /** Every dialog function across the project, keyed by lowercased name. */
  functionsByKey: ReadonlyMap<string, FunctionEntry>;
  /** Script sites naming a waypoint; empty when the project index has none. */
  waypointSites: WaypointSites;
  /** Static spawn sites from the project index; empty when it has none. */
  spawnSites: readonly SpawnSite[];
  /**
   * UPPERCASED names of every NPC the project index holds at least one dialog
   * for. Dialog is what separates a character from a monster template — both
   * are `C_NPC` instances — and `duplicate-spawn` fires only for characters.
   * Empty means nothing is known, never that nothing is legal.
   */
  dialogNpcKeys: ReadonlySet<string>;
  /** The open world's waynet names, or undefined when no world is open. */
  world?: WorldWaynetView;
}

/**
 * Waypoint-name literals found in scripts, keyed by UPPERCASED name — the
 * project index's `waypointSites`, threaded in whole rather than rebuilt here:
 * it rides `buildProjectIndex`'s worker-pool pass, so it sees every file in the
 * project, while the per-file models this view is otherwise built from are
 * capped and depend on what has been opened.
 */
export type WaypointSites = Record<string, Array<{ filePath: string; functionName: string }>>;

/**
 * The waynet of the world that is currently open, as a set of names. This is
 * reference data, not a file the rules walk — the same shape `knownNpcNames`
 * has, and absent for the same reason it can be empty: no world open means
 * nothing is known, never that nothing is legal.
 */
export interface WorldWaynetView {
  /** Uppercased names of every waypoint in the waynet. */
  pointNameKeys: ReadonlySet<string>;
  /**
   * Uppercased names of the world's free points — its **`zCVobSpot` VOBs**,
   * which is where a world keeps them. Disjoint from `pointNameKeys`: retail
   * NewWorld has 2,254 of these and not one waypoint named `FP_*`.
   *
   * Not the waynet's stored `free_point` flag, which this used to read. That
   * flag marks a waypoint standing in no edge so `WayNet::save` keeps it — a
   * storage fact, true of 1 waypoint in NewWorld (`TOT`) and of none that a
   * script names. Reading it left this set unable to answer for any of the 874
   * `FP_` sites in the retail scripts.
   */
  freePointNames: readonly string[];
}

/**
 * Does the open world have a place by this name? **The one answer both
 * surfaces take** — the Problems rule and the spawn-point jump button — so
 * that a name cannot be missing in one and present in the other, which is
 * exactly what they used to disagree about.
 *
 * Waypoints match exactly. Free points match by **substring**, because the
 * engine's free-point search does: `Wld_IsFPAvailable(self, "ROAM")` reaches
 * `FP_ROAM_CITY_01`, and since every free point starts `FP_` a script fragment
 * is almost never a prefix of one. Prefix-matching therefore invented a finding
 * for legal code, which is the failure the free-point branch exists to prevent.
 * Measured against the retail scripts, the looser form changes nothing else:
 * 867 of their 874 `FP_` sites name a free point in full, one names a prefix
 * (`FP_ROAM_OW_SNAPPER_OW_ORC` for `…_ORC6/7/8`), and none needs the infix
 * case — which reaches the rule only through a project's own helper declaring
 * a `var string waypoint` parameter.
 */
export const worldHasPoint = (world: WorldWaynetView, name: string): boolean => {
  const upper = name.toUpperCase();
  // The empty name is in no world. Said here rather than left to the callers:
  // every string contains `''`, so a substring match would answer *true* for
  // any world holding one free point — and the next caller is a text field
  // being typed into, where the empty name is the normal state.
  if (!upper) return false;
  return world.pointNameKeys.has(upper)
    || world.freePointNames.some((freePoint) => freePoint.includes(upper));
};

/** A pure lint rule: inspects the project view and returns any problems. */
export type LintRule = (view: ProjectView) => Problem[];
