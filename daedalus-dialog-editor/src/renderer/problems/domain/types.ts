import type { SemanticModel } from '../../../shared/types';

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
  | 'voice-id-malformed';

export interface Problem {
  /** Stable key for React lists and cross-scan dedupe. */
  id: string;
  rule: ProblemRuleId;
  severity: ProblemSeverity;
  /** Human-readable, self-contained description. */
  message: string;
  /** File that owns the offending declaration. */
  filePath: string;
  /** NPC the offending dialog belongs to, when applicable. */
  npc?: string;
  /** Dialog the problem points at, used for navigation. */
  dialogName?: string;
  /** Function the problem points at, used for navigation. */
  functionName?: string;
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
}

/** A pure lint rule: inspects the project view and returns any problems. */
export type LintRule = (view: ProjectView) => Problem[];
