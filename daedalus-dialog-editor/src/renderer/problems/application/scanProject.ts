import type { FileModel, Problem } from '../domain/types';
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
}

export interface ProjectScanResult {
  problems: Problem[];
  /** How many parsed files the scan actually saw. */
  scannedFileCount: number;
}

export function scanProject(input: ProjectScanInput): ProjectScanResult {
  const view = buildProjectView({ files: input.files, knownNpcNames: input.knownNpcNames });
  return { problems: runRules(view), scannedFileCount: input.files.length };
}
