import type { DialogFunction } from '../../../shared/types';

export interface UnknownValue {
  kind: 'unknown';
  expression: string;
}

export interface TranscriptLineEntry {
  kind: 'line';
  speaker: 'self' | 'other';
  text: string;
  id: string;
}

export interface TranscriptChoiceEntry {
  kind: 'choice';
  text: string;
  targetFunction: string;
}

export interface TranscriptSideEffectEntry {
  kind: 'side-effect';
  text: string;
}

export interface TranscriptConditionNoteEntry {
  kind: 'condition-note';
  condition: string;
  assumed: boolean;
  reason?: string;
}

export type TranscriptEntry =
  | TranscriptLineEntry
  | TranscriptChoiceEntry
  | TranscriptSideEffectEntry
  | TranscriptConditionNoteEntry;

export interface SimChoice {
  text: string;
  targetFunction: string;
  dialogRef: string;
}

export interface SimState {
  misVars: Map<string, number | UnknownValue>;
  assumedMisVars: Set<string>;
  knownInfos: Set<string>;
  transcript: TranscriptEntry[];
  pendingChoices: SimChoice[];
  status: 'running' | 'awaiting-choice' | 'ended';
  terminationReason?: 'completed' | 'stopped' | 'budget-exceeded' | 'missing-function';
}

export interface SimDialogEntry {
  name: string;
  npc: string;
  nr: number;
  conditionFunction?: string;
  informationFunction?: string;
  important: boolean;
  permanent: boolean;
  sourceOrder: number;
}

export interface SimulatorModel {
  functions: ReadonlyMap<string, DialogFunction>;
  dialogs: readonly SimDialogEntry[];
  declaredMisVariables: ReadonlySet<string>;
  constants: ReadonlyMap<string, string | number | boolean>;
}
