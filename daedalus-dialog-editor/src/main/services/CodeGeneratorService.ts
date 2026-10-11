import { SemanticCodeGenerator } from 'daedalus-parser/semantic-code-generator';
import { deserializeSemanticModel } from 'daedalus-parser/semantic-model';
import type { CodeGenerationSettings } from '../../shared/types';

export class CodeGeneratorService {
  /**
   * Generate Daedalus code from semantic model.
   *
   * `allowPartialModel` threads through to the generator's fix-01 P7 guard:
   * without it, generating from a model with parse errors throws. The forced
   * save path passes it so the user can knowingly write a partial model.
   */
  generateCode(
    plainModel: any,
    settings: CodeGenerationSettings,
    options?: { allowPartialModel?: boolean }
  ): string {
    // Reconstruct the model with proper class instances using the parser's deserializer
    const model = deserializeSemanticModel(plainModel);

    const generator = new SemanticCodeGenerator({
      indentChar: settings.indentChar,
      includeComments: settings.includeComments,
      sectionHeaders: settings.sectionHeaders,
      uppercaseKeywords: settings.uppercaseKeywords,
      preserveSourceStyle: true,
      allowPartialModel: options?.allowPartialModel === true
    });

    return generator.generateSemanticModel(model);
  }

  /**
   * Generate Daedalus code for a specific dialog
   */
  generateDialogCode(plainModel: any, dialogName: string, settings: CodeGenerationSettings): string {
    // Reconstruct the model with proper class instances
    const model = deserializeSemanticModel(plainModel);

    const generator = new SemanticCodeGenerator({
      indentChar: settings.indentChar,
      includeComments: settings.includeComments,
      sectionHeaders: settings.sectionHeaders,
      uppercaseKeywords: settings.uppercaseKeywords,
      preserveSourceStyle: true
    });

    return generator.generateDialogWithFunctions(dialogName, model);
  }
}
