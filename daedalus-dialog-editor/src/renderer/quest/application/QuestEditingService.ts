import type { SemanticModel } from '../../types/global';
import * as questCommands from '../domain/commands';
import type { QuestGraphCommand } from '../domain/commands';
import {
  getQuestGuardrailDeltaWarnings,
  isQuestGuardrailWarningBlocking,
  type QuestGuardrailWarning
} from '../domain/guardrails';

export interface QuestCommandContext {
  questName: string;
  model: SemanticModel;
}

export interface QuestModelUpdate {
  filePath: string;
  updatedModel: SemanticModel;
}

export interface ApplyQuestUpdatesDeps {
  /**
   * Reads the CURRENT fileStore model for a path. Injected so the guardrail check
   * runs against apply-time state (closing the preview-to-apply TOCTOU), and so the
   * service stays testable without touching the store singleton.
   */
  getCurrentModel: (filePath: string) => SemanticModel | null | undefined;
  /** The raw, validation-free history primitive (historyStore.applyQuestModelsWithHistory). */
  applyQuestModelsWithHistory: (updates: Array<{ filePath: string; model: SemanticModel }>) => void;
}

export interface ApplyQuestUpdatesResult {
  ok: boolean;
  blockingWarnings: QuestGuardrailWarning[];
}

export const QuestEditingService = {
  runCommand(context: QuestCommandContext, command: QuestGraphCommand) {
    return questCommands.executeQuestGraphCommand(context, command);
  },

  /**
   * Single choke point for committing quest model edits. Recomputes guardrail delta
   * warnings for every update against the CURRENT fileStore model (not the preview-time
   * model), refuses the whole batch if any warning is blocking, and otherwise routes
   * through the injected history primitive. Quest UI must apply edits through here rather
   * than calling applyQuestModelsWithHistory directly.
   */
  applyQuestUpdates(
    questName: string | null,
    updates: QuestModelUpdate[],
    deps: ApplyQuestUpdatesDeps
  ): ApplyQuestUpdatesResult {
    const blockingWarnings: QuestGuardrailWarning[] = [];

    updates.forEach((update) => {
      const currentModel = deps.getCurrentModel(update.filePath);
      if (!currentModel) return;
      getQuestGuardrailDeltaWarnings(currentModel, update.updatedModel, questName).forEach((warning) => {
        if (isQuestGuardrailWarningBlocking(warning.id)) {
          blockingWarnings.push(warning);
        }
      });
    });

    if (blockingWarnings.length > 0) {
      return { ok: false, blockingWarnings };
    }

    deps.applyQuestModelsWithHistory(
      updates.map((update) => ({ filePath: update.filePath, model: update.updatedModel }))
    );
    return { ok: true, blockingWarnings: [] };
  }
};
