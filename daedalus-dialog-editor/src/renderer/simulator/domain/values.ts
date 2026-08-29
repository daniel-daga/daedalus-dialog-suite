import { canonicalizeIdentifier } from './identifier';
import type { SimState, SimulatorModel, TranscriptEntry, UnknownValue } from './types';

export const isUnknownValue = (value: number | UnknownValue | undefined): value is UnknownValue =>
  typeof value === 'object' && value !== null && value.kind === 'unknown';

export const cloneValue = (value: number | UnknownValue): number | UnknownValue =>
  typeof value === 'number' ? value : { ...value };

const cloneTranscriptEntry = (entry: TranscriptEntry): TranscriptEntry => ({ ...entry });

/** The one deep clone of scratch state; both the engine and the session use it. */
export const cloneSimState = (state: SimState): SimState => ({
  misVars: new Map(Array.from(state.misVars, ([name, value]) => [name, cloneValue(value)])),
  assumedMisVars: new Set(state.assumedMisVars),
  knownInfos: new Set(state.knownInfos),
  transcript: state.transcript.map(cloneTranscriptEntry),
  pendingChoices: state.pendingChoices.map((choice) => ({ ...choice })),
  status: state.status,
  terminationReason: state.terminationReason
});

/** The identifiers with a fixed numeric value: the booleans and the quest log statuses. */
export const builtInNumber = (value: string): number | undefined => {
  switch (canonicalizeIdentifier(value)) {
    case 'true': return 1;
    case 'false': return 0;
    case 'log_running': return 1;
    case 'log_success': return 2;
    case 'log_failed': return 3;
    case 'log_obsolete': return 4;
    default: return undefined;
  }
};

/** `createSimulatorModel` canonicalizes constant keys, so a direct lookup is complete. */
export const findConstant = (
  model: SimulatorModel,
  name: string
): string | number | boolean | undefined => model.constants.get(canonicalizeIdentifier(name));
