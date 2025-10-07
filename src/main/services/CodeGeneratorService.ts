import { SemanticCodeGenerator } from 'daedalus-parser/semantic-code-generator';
import {
  Dialog,
  DialogFunction,
  DialogLine,
  CreateTopic,
  LogEntry,
  LogSetTopicStatus,
  Action,
  Choice,
  CreateInventoryItems,
  GiveInventoryItems,
  AttackAction,
  SetAttitudeAction,
  ExchangeRoutineAction,
  ChapterTransitionAction
} from 'daedalus-parser/semantic-model';
import type { SemanticModel } from 'daedalus-parser/semantic-model';

interface CodeGeneratorSettings {
  indentChar: '\t' | ' ';
  includeComments: boolean;
  sectionHeaders: boolean;
  uppercaseKeywords: boolean;
}

export class CodeGeneratorService {
  /**
   * Reconstruct semantic model from serialized plain objects
   * When objects pass through IPC, they lose their prototype chain
   */
  private reconstructModel(plainModel: any): SemanticModel {
    const model: SemanticModel = {
      dialogs: {},
      functions: {}
    };

    // Reconstruct functions
    for (const funcName in plainModel.functions) {
      const plainFunc = plainModel.functions[funcName];
      const func = new DialogFunction(plainFunc.name, plainFunc.returnType);
      func.calls = plainFunc.calls || [];
      func.actions = (plainFunc.actions || []).map((action: any) => this.reconstructAction(action));
      model.functions[funcName] = func;
    }

    // Reconstruct dialogs
    for (const dialogName in plainModel.dialogs) {
      const plainDialog = plainModel.dialogs[dialogName];
      const dialog = new Dialog(plainDialog.name, plainDialog.parent);

      // Reconstruct properties, linking to DialogFunction instances
      for (const key in plainDialog.properties) {
        const value = plainDialog.properties[key];

        // Check if this property references a function
        if (typeof value === 'object' && value !== null && 'name' in value && 'returnType' in value) {
          // Link to the reconstructed function
          dialog.properties[key] = model.functions[value.name];
        } else if (typeof value === 'string' && model.functions[value]) {
          // Handle case where it was normalized to just a string name
          dialog.properties[key] = model.functions[value];
        } else {
          dialog.properties[key] = value;
        }
      }

      model.dialogs[dialogName] = dialog;
    }

    return model;
  }

  /**
   * Reconstruct action objects from plain objects
   */
  private reconstructAction(plainAction: any): any {
    // Determine action type and reconstruct with proper class
    if ('speaker' in plainAction && 'text' in plainAction && 'id' in plainAction) {
      return new DialogLine(plainAction.speaker, plainAction.text, plainAction.id);
    } else if ('topic' in plainAction && 'topicType' in plainAction) {
      return new CreateTopic(plainAction.topic, plainAction.topicType);
    } else if ('topic' in plainAction && 'text' in plainAction) {
      return new LogEntry(plainAction.topic, plainAction.text);
    } else if ('topic' in plainAction && 'status' in plainAction) {
      return new LogSetTopicStatus(plainAction.topic, plainAction.status);
    } else if ('dialogRef' in plainAction && 'targetFunction' in plainAction) {
      return new Choice(plainAction.dialogRef, plainAction.text, plainAction.targetFunction);
    } else if ('target' in plainAction && 'item' in plainAction && 'quantity' in plainAction && !('giver' in plainAction)) {
      return new CreateInventoryItems(plainAction.target, plainAction.item, plainAction.quantity);
    } else if ('giver' in plainAction && 'receiver' in plainAction) {
      return new GiveInventoryItems(plainAction.giver, plainAction.receiver, plainAction.item, plainAction.quantity);
    } else if ('attacker' in plainAction && 'attackReason' in plainAction) {
      return new AttackAction(plainAction.attacker, plainAction.target, plainAction.attackReason, plainAction.damage);
    } else if ('attitude' in plainAction) {
      return new SetAttitudeAction(plainAction.target, plainAction.attitude);
    } else if ('routine' in plainAction) {
      return new ExchangeRoutineAction(plainAction.target, plainAction.routine);
    } else if ('chapter' in plainAction && 'world' in plainAction) {
      return new ChapterTransitionAction(plainAction.chapter, plainAction.world);
    } else if ('action' in plainAction) {
      return new Action(plainAction.action);
    }

    // Fallback to plain object
    return plainAction;
  }

  /**
   * Generate Daedalus code from semantic model
   */
  generateCode(plainModel: any, settings: CodeGeneratorSettings): string {
    // Reconstruct the model with proper class instances
    const model = this.reconstructModel(plainModel);

    const generator = new SemanticCodeGenerator({
      indentChar: settings.indentChar,
      includeComments: settings.includeComments,
      sectionHeaders: settings.sectionHeaders,
      uppercaseKeywords: settings.uppercaseKeywords
    });

    return generator.generateSemanticModel(model);
  }
}
