import type { SemanticModel } from '../../types/global';
import * as questCommands from '../domain/commands';
import type { QuestGraphCommand } from '../domain/commands';

export interface QuestCommandContext {
  questName: string;
  model: SemanticModel;
}

export const QuestEditingService = {
  runCommand(context: QuestCommandContext, command: QuestGraphCommand) {
    return questCommands.executeQuestGraphCommand(context, command);
  }
};
