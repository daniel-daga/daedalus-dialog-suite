import type { DialogFunction, SemanticModel } from '../../../shared/types';

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

/** A dialog function together with the file that declares it. */
export interface FunctionEntry {
  func: DialogFunction;
  filePath: string;
}

/**
 * Aggregated, case-insensitive project view built from every parsed file.
 * The `*Keys` sets hold lowercased names for existence checks; the original
 * casing is preserved on the underlying model objects for display.
 */
export interface ProjectView {
  files: FileModel[];
  /** Lowercased names of every dialog across the project. */
  dialogNameKeys: ReadonlySet<string>;
  /** Lowercased names of every known NPC (C_NPC instances + prototypes). */
  npcNameKeys: ReadonlySet<string>;
  /** Every dialog function across the project, keyed by lowercased name. */
  functionsByKey: ReadonlyMap<string, FunctionEntry>;
}

/** A pure lint rule: inspects the project view and returns any problems. */
export type LintRule = (view: ProjectView) => Problem[];
