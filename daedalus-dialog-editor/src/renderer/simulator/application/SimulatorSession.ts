import { getDialogAvailability, type SimDialogAvailability } from '../domain/dialogAvailability';
import { createSimState, executeFunction, selectChoice as executeChoice } from '../domain/engine';
import { canonicalizeIdentifier } from '../domain/identifier';
import type { SimDialogEntry, SimState, SimulatorModel } from '../domain/types';
import { cloneSimState } from '../domain/values';

/** Why a launch would be refused, so the UI can say it instead of doing nothing. */
export type StartCheck = { ok: true } | { ok: false; reason: string };

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

const cloneEntry = (entry: SimDialogEntry | undefined): SimDialogEntry | undefined =>
  entry ? { ...entry } : undefined;

const cloneBaseline = (baseline: RestartBaseline | undefined): RestartBaseline | undefined => baseline && ({
  state: cloneSimState(baseline.state),
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
    return cloneSimState(this.state);
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

  /** The refusal `startDialog` would return, with the reason it would not give. */
  canStartDialog(name: string): StartCheck {
    const entry = this.findEntry(name);
    if (!entry) return { ok: false, reason: `Dialog "${name.trim()}" is not in the simulated model.` };
    if (!entry.informationFunction) {
      return { ok: false, reason: `"${entry.name}" has no information function.` };
    }
    if (!this.model.functions.has(canonicalizeIdentifier(entry.informationFunction))) {
      return { ok: false, reason: `Information function "${entry.informationFunction}" was not found.` };
    }

    const availability = this.findAvailability(entry, this.state, this.assumeUnknown);
    if (!availability || !availability.visible) {
      return { ok: false, reason: `The condition of "${entry.name}" is false in the current scratch state.` };
    }
    if (availability.value === 'unknown' && !availability.assumedAvailable) {
      return {
        ok: false,
        reason: `The condition of "${entry.name}" is unknown${availability.reason ? `: ${availability.reason}` : '.'} Enable "Assume unknown conditions are true" to launch it.`
      };
    }
    return { ok: true };
  }

  startDialog(name: string): boolean {
    if (!this.canStartDialog(name).ok) return false;
    const entry = this.findEntry(name)!;
    const availability = this.findAvailability(entry, this.state, this.assumeUnknown);

    const prelaunch = this.captureSnapshot();
    this.history.push(prelaunch);
    this.restartBaseline = this.toRestartBaseline(prelaunch);
    this.runEntry(entry, cloneSimState(prelaunch.state), prelaunch.assumeUnknown, availability);
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
    const availability = this.findAvailability(entry, baseline.state, baseline.assumeUnknown);
    this.runEntry(entry, baseline.state, baseline.assumeUnknown, availability);
    return true;
  }

  setAssumeUnknown(value: boolean): void {
    if (this.assumeUnknown === value) return;
    this.history.push(this.captureSnapshot());
    this.assumeUnknown = value;
  }

  private findEntry(name: string): SimDialogEntry | undefined {
    return this.model.dialogs.find((candidate) =>
      canonicalizeIdentifier(candidate.name) === canonicalizeIdentifier(name)
    );
  }

  private findAvailability(
    entry: SimDialogEntry,
    state: SimState,
    assumeUnknown: boolean
  ): SimDialogAvailability | undefined {
    return getDialogAvailability(this.model, state, entry.npc, assumeUnknown)
      .find((candidate) => canonicalizeIdentifier(candidate.entry.name) === canonicalizeIdentifier(entry.name));
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
    this.state = cloneSimState(initialState);
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
    // are intentionally handled separately and never add known infos, and a
    // permanent C_INFO never registers as known in the engine at all.
    if (!entry.permanent
      && (this.state.terminationReason === 'completed' || this.state.terminationReason === 'stopped')) {
      this.state.knownInfos.add(canonicalizeIdentifier(entry.name));
    }
  }

  private captureSnapshot(): SessionSnapshot {
    return {
      state: cloneSimState(this.state),
      assumeUnknown: this.assumeUnknown,
      selectedEntry: cloneEntry(this.selectedEntry),
      activeFunctionName: this.activeFunctionName,
      restartBaseline: cloneBaseline(this.restartBaseline)
    };
  }

  private toRestartBaseline(snapshot: SessionSnapshot): RestartBaseline {
    return {
      state: cloneSimState(snapshot.state),
      assumeUnknown: snapshot.assumeUnknown,
      selectedEntry: cloneEntry(snapshot.selectedEntry),
      activeFunctionName: snapshot.activeFunctionName
    };
  }

  private restoreSnapshot(snapshot: SessionSnapshot): void {
    this.state = cloneSimState(snapshot.state);
    this.assumeUnknown = snapshot.assumeUnknown;
    this.selectedEntry = cloneEntry(snapshot.selectedEntry);
    this.activeFunctionName = snapshot.activeFunctionName;
    this.restartBaseline = cloneBaseline(snapshot.restartBaseline);
  }
}
