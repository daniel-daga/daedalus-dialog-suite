import type { CodeGeneratable } from './semanticModelInterfaces';

/** Parsed callee and the generator baseline, independent of editor projection. */
export interface CallIdentity {
  version: 1;
  sourceName: string;
  generatedName: string;
}

/** Current arguments and explicit callee edits always win over the parse baseline. */
export function generateCallExpression(owner: CodeGeneratable, name: string, args: string[], spaceBeforeParen = false): string {
  const identity = owner.callIdentity;
  let callee = name;
  if (identity && name === identity.generatedName) {
    callee = identity.sourceName;
  } else if (!identity && owner.sourceText && owner.sourceCall && name === owner.sourceCall.name.initialValue) {
    // Older serialized commented actions already own the original callee range.
    callee = owner.sourceText.slice(owner.sourceCall.name.start, owner.sourceCall.name.end);
  }
  return `${callee}${spaceBeforeParen ? ' ' : ''}(${args.join(', ')})`;
}

export function generateCallStatement(owner: CodeGeneratable, name: string, args: string[]): string {
  return `${generateCallExpression(owner, name, args, true)};`;
}
