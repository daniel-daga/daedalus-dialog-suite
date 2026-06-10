/**
 * Dialog-specific action classes.
 *
 * Contains action types that directly map to dialog-line output or choice
 * navigation in Daedalus dialog scripts.
 */

import type { CodeGenOptions, CodeGeneratable } from './semanticModelInterfaces';

export class DialogLine implements CodeGeneratable {
  public readonly type = 'DialogLine';
  public speaker: string;
  public listener: string;
  public text: string;
  public id: string;
  public inlineComment?: boolean;

  constructor(speaker: string, text: string, id: string, listener?: string) {
    this.speaker = speaker;
    this.text = text;
    this.id = id;
    this.listener = listener ?? (speaker === 'other' ? 'self' : 'other');
  }

  generateCode(options: CodeGenOptions): string {
    const shouldEmitComment = options.includeComments && (this.inlineComment ?? this.text !== this.id);
    const comment = shouldEmitComment ? ` //${this.text}` : '';
    // Fall back to the speaker-derived default only for legacy serialized
    // lines that carry no listener field.
    const listener = this.listener ?? (this.speaker === 'other' ? 'self' : 'other');
    return `AI_Output (${this.speaker}, ${listener}, "${this.id}");${comment}`;
  }

  toDisplayString(): string {
    return `[DialogLine: ${this.speaker} -> ${this.listener}: "${this.text}"]`;
  }

  getTypeName(): string {
    return 'DialogLine';
  }
}

export class Choice implements CodeGeneratable {
  public readonly type = 'Choice';
  public dialogRef: string;
  public text: string;
  public targetFunction: string;
  public textIsExpression?: boolean;

  constructor(dialogRef: string, text: string, targetFunction: string) {
    this.dialogRef = dialogRef;
    this.text = text;
    this.targetFunction = targetFunction;
  }

  generateCode(_options: CodeGenOptions): string {
    if (this.textIsExpression) {
      return `Info_AddChoice (${this.dialogRef}, ${this.text}, ${this.targetFunction});`;
    }
    // Daedalus strings have no escape sequences: emit content verbatim.
    return `Info_AddChoice (${this.dialogRef}, "${this.text}", ${this.targetFunction});`;
  }

  toDisplayString(): string {
    return `[Choice: "${this.text}" -> ${this.targetFunction}]`;
  }

  getTypeName(): string {
    return 'Choice';
  }
}
