import { SemanticCodeGenerator } from 'daedalus-parser/semantic-code-generator';
import { deserializeSemanticModel } from 'daedalus-parser/semantic-model';

interface CodeGeneratorSettings {
  indentChar: '\t' | ' ';
  includeComments: boolean;
  sectionHeaders: boolean;
  uppercaseKeywords: boolean;
}

export class CodeGeneratorService {
  /**
   * Generate Daedalus code from semantic model
   */
  generateCode(plainModel: any, settings: CodeGeneratorSettings): string {
    // Reconstruct the model with proper class instances using the parser's deserializer
    const model = deserializeSemanticModel(plainModel);

    const generator = new SemanticCodeGenerator({
      indentChar: settings.indentChar,
      includeComments: settings.includeComments,
      sectionHeaders: settings.sectionHeaders,
      uppercaseKeywords: settings.uppercaseKeywords
    });

    return generator.generateSemanticModel(model);
  }

  /**
   * Generate Daedalus code for a specific dialog
   */
  generateDialogCode(plainModel: any, dialogName: string, settings: CodeGeneratorSettings): string {
    // Reconstruct the model with proper class instances
    const model = deserializeSemanticModel(plainModel);

    const generator = new SemanticCodeGenerator({
      indentChar: settings.indentChar,
      includeComments: settings.includeComments,
      sectionHeaders: settings.sectionHeaders,
      uppercaseKeywords: settings.uppercaseKeywords
    });

    return generator.generateDialogWithFunctions(dialogName, model);
  }
}
