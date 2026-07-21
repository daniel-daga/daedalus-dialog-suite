import { getDialogAvailability, type SimDialogAvailability } from '../domain/dialogAvailability';
import { createSimState, executeFunction, selectChoice as executeChoice } from '../domain/engine';
import { canonicalizeIdentifier } from '../domain/identifier';
import type { SimDialogEntry, SimState, SimulatorModel, TranscriptEntry, UnknownValue } from '../domain/types';

export interface SimulatorSessionOptions {
  assumeUnknown?: boolean;
  actionBudget?: number;
}

interface RestartBaseline {
  state: SimState;
  assumeUnknown: boolean;
  selectedEntry?: SimDialogEntry;
  activeFunctionName?: string;
}

interface SessionSnapshot extends RestartBaseline {
  restartBaseline?: RestartBaseline;
}

const cloneValue = (value: number | UnknownValue): number | UnknownValue =>
  typeof value === 'number' ? value : { ...value };

const cloneTranscriptEntry = (entry: TranscriptEntry): TranscriptEntry => ({ ...entry });

const cloneState = (state: SimState): SimState => ({
  misVars: new Map(Array.from(state.misVars, ([key, value]) => [key, cloneValue(value)])),
  assumedMisVars: new Set(state.assumedMisVars),
  knownInfos: new Set(state.knownInfos),
  transcript: state.transcript.map(cloneTranscriptEntry),
  pendingChoices: state.pendingChoices.map((choice) => ({ ...choice })),
  status: state.status,
  terminationReason: state.terminationReason
});

const cloneEntry = (entry: SimDialogEntry | undefined): SimDialogEntry | undefined =>
  entry ? { ...entry } : undefined;

const cloneBaseline = (baseline: RestartBaseline | undefined): RestartBaseline | undefined => baseline && ({
  state: cloneState(baseline.state),
  assumeUnknown: baseline.assumeUnknown,
  selectedEntry: cloneEntry(baseline.selectedEntry),
  activeFunctionName: baseline.activeFunctionName
});

/** Store-free orchestration and history for a single projected simulator model. */
export class SimulatorSession {
  private state: SimState;
  private assumeUnknown: boolean;
  private readonly actionBudget: number | undefined;
  private selectedEntry: SimDialogEntry | undefined;
  private activeFunctionName: string | undefined;
  private restartBaseline: RestartBaseline | undefined;
  private readonly history: SessionSnapshot[] = [];

  constructor(
    private readonly model: SimulatorModel,
    options: SimulatorSessionOptions = {}
  ) {
    this.state = createSimState(model);
    this.assumeUnknown = options.assumeUnknown ?? false;
    this.actionBudget = options.actionBudget;
  }

  getState(): SimState {
    return cloneState(this.state);
  }

  getAssumeUnknown(): boolean {
    return this.assumeUnknown;
  }

  getAvailableDialogs(npc: string): SimDialogAvailability[] {
    return getDialogAvailability(this.model, this.state, npc, this.assumeUnknown)
      .map((availability) => ({ ...availability, entry: { ...availability.entry } }));
  }

  getActiveFunctionName(): string | undefined {
    return this.activeFunctionName;
  }

  canBack(): boolean {
    return this.history.length > 0;
  }

  startDialog(name: string): boolean {
    const entry = this.model.dialogs.find((candidate) =>
      canonicalizeIdentifier(candidate.name) === canonicalizeIdentifier(name)
    );
    if (!entry?.informationFunction) return false;
    if (!this.model.functions.has(canonicalizeIdentifier(entry.informationFunction))) return false;

    const availability = getDialogAvailability(this.model, this.state, entry.npc, this.assumeUnknown)
      .find((candidate) => canonicalizeIdentifier(candidate.entry.name) === canonicalizeIdentifier(entry.name));
    if (!availability || !availability.visible || (availability.value === 'unknown' && !availability.assumedAvailable)) {
      return false;
    }

    const prelaunch = this.captureSnapshot();
    this.history.push(prelaunch);
    this.restartBaseline = this.toRestartBaseline(prelaunch);
    this.runEntry(entry, cloneState(prelaunch.state), prelaunch.assumeUnknown, availability);
    return true;
  }

  selectChoice(index: number): boolean {
    if (this.state.status !== 'awaiting-choice') return false;
    if (!Number.isInteger(index) || index < 0 || index >= this.state.pendingChoices.length) return false;

    this.history.push(this.captureSnapshot());
    const choice = this.state.pendingChoices[index];
    this.state = executeChoice(this.model, this.state, index, this.executionOptions());
    this.activeFunctionName = choice.targetFunction;
    return true;
  }

  back(): boolean {
    const snapshot = this.history.pop();
    if (!snapshot) return false;
    this.restoreSnapshot(snapshot);
    return true;
  }

  restart(): boolean {
    if (!this.selectedEntry || !this.restartBaseline) return false;
    const entry = { ...this.selectedEntry };
    const baseline = cloneBaseline(this.restartBaseline)!;
    this.history.length = 0;
    this.restartBaseline = cloneBaseline(baseline);
    const availability = getDialogAvailability(this.model, baseline.state, entry.npc, baseline.assumeUnknown)
      .find((candidate) => canonicalizeIdentifier(candidate.entry.name) === canonicalizeIdentifier(entry.name));
    this.runEntry(entry, baseline.state, baseline.assumeUnknown, availability);
    return true;
  }

  setAssumeUnknown(value: boolean): void {
    if (this.assumeUnknown === value) return;
    this.history.push(this.captureSnapshot());
    this.assumeUnknown = value;
  }

  private executionOptions() {
    return { assumeUnknown: this.assumeUnknown, actionBudget: this.actionBudget };
  }

  private runEntry(
    entry: SimDialogEntry,
    initialState: SimState,
    initialAssumeUnknown: boolean,
    availability?: SimDialogAvailability
  ): void {
    this.state = cloneState(initialState);
    this.assumeUnknown = initialAssumeUnknown;
    this.selectedEntry = { ...entry };
    this.activeFunctionName = entry.informationFunction;
    if (availability?.value === 'unknown') {
      this.state.transcript.push({
        kind: 'condition-note',
        condition: entry.conditionFunction || entry.name,
        assumed: initialAssumeUnknown,
        ...(availability.reason ? { reason: availability.reason } : {})
      });
    }
    this.state = executeFunction(this.model, this.state, entry.informationFunction!, this.executionOptions());

    // Selecting a C_INFO teaches that entry once its initial synchronous action
    // list has completed, including when it ends at a choice menu. Choice targets
    // are intentionally handled separately and never add known infos.
    if (this.state.terminationReason === 'completed' || this.state.terminationReason === 'stopped') {
      this.state.knownInfos.add(canonicalizeIdentifier(entry.name));
    }
  }

  private captureSnapshot(): SessionSnapshot {
    return {
      state: cloneState(this.state),
      assumeUnknown: this.assumeUnknown,
      selectedEntry: cloneEntry(this.selectedEntry),
      activeFunctionName: this.activeFunctionName,
      restartBaseline: cloneBaseline(this.restartBaseline)
    };
  }

  private toRestartBaseline(snapshot: SessionSnapshot): RestartBaseline {
    return {
      state: cloneState(snapshot.state),
      assumeUnknown: snapshot.assumeUnknown,
      selectedEntry: cloneEntry(snapshot.selectedEntry),
      activeFunctionName: snapshot.activeFunctionName
    };
  }

  private restoreSnapshot(snapshot: SessionSnapshot): void {
    this.state = cloneState(snapshot.state);
    this.assumeUnknown = snapshot.assumeUnknown;
    this.selectedEntry = cloneEntry(snapshot.selectedEntry);
    this.activeFunctionName = snapshot.activeFunctionName;
    this.restartBaseline = cloneBaseline(snapshot.restartBaseline);
  }
}
