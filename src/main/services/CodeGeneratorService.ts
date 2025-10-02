import { SemanticCodeGenerator } from 'daedalus-parser/semantic-code-generator';
import { Dialog, DialogFunction } from 'daedalus-parser/semantic-model';

export interface CodeGenerationSettings {
  indentChar: '\t' | ' ';
  includeComments: boolean;
  sectionHeaders: boolean;
  uppercaseKeywords: boolean;
}

export class CodeGeneratorService {
  private generator: SemanticCodeGenerator;
  private currentSettings: CodeGenerationSettings;

  constructor(settings?: CodeGenerationSettings) {
    this.currentSettings = settings || {
      indentChar: '\t',
      includeComments: true,
      sectionHeaders: true,
      uppercaseKeywords: true
    };

    this.generator = new SemanticCodeGenerator({
      indentChar: this.currentSettings.indentChar,
      indentSize: 1,
      includeComments: this.currentSettings.includeComments,
      sectionHeaders: this.currentSettings.sectionHeaders,
      uppercaseKeywords: this.currentSettings.uppercaseKeywords
    });
  }

  updateSettings(settings: CodeGenerationSettings) {
    this.currentSettings = settings;
    this.generator = new SemanticCodeGenerator({
      indentChar: settings.indentChar,
      indentSize: 1,
      includeComments: settings.includeComments,
      sectionHeaders: settings.sectionHeaders,
      uppercaseKeywords: settings.uppercaseKeywords
    });
  }

  generate(model: any): string {
    return this.generator.generateSemanticModel(model);
  }

  generateDialog(dialog: Dialog): string {
    return this.generator.generateDialog(dialog);
  }

  generateFunction(func: DialogFunction): string {
    return this.generator.generateFunction(func);
  }
}