import type { CodeGenOptions, CodeGeneratable } from './semanticModelInterfaces';
import { captureActionSource, parseActionCall } from './action-source';
import { ActionParsers } from './parsers/action-parsers';

/**
 * Original text owns trivia outside the editable AST expressions. Current
 * semantic fields own edited expressions, including their comments. Compare
 * against original generated values, never a normalized token approximation.
 */
export function generateActionCode(action: CodeGeneratable, options: CodeGenOptions): string {
  const generated = action.generateCode(options);
  if (!options.includeComments || !action.sourceText) return generated;

  const source = action.sourceText;
  if (!action.sourceCall) {
    // Older IPC models only carry sourceText. Recover the original baseline
    // from that source, not from the already edited fields on this action.
    const original = parseActionCall(source + ';');
    const baseline = ActionParsers.parseSemanticAction(original.node, original.name.text);
    action.sourceCall = captureActionSource(original.node, baseline as CodeGeneratable);
  }
  const previous = action.sourceCall;
  if (previous.version !== 1) throw new Error('Unsupported commented action source metadata.');
  const current = parseActionCall(generated);

  if (previous.arguments.length !== current.arguments.length) {
    // A new arity has no positional correspondence. Preserve only comments
    // outside old editable expressions; argument comments come from the model.
    const comments = previous.outsideComments.map(text => text + (text.startsWith('//') ? '\n' : ' ')).join('');
    return comments + generated;
  }

  const replacements: { start: number; end: number; text: string }[] = [];
  if (previous.name.initialValue !== current.name.text) {
    replacements.push({ start: previous.name.start, end: previous.name.end, text: current.name.text });
  }
  previous.arguments.forEach((argument, index) => {
    const value = current.arguments[index].text;
    if (argument.initialValue !== value.trim()) {
      replacements.push({ start: argument.start, end: argument.end, text: value });
    }
  });

  let result = source.slice(0, previous.closeEnd);
  for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
    result = result.slice(0, replacement.start) + replacement.text + result.slice(replacement.end);
  }
  // Keep the current semicolon/subtitle, including safe multiline subtitles.
  return result + generated.slice(current.closeEnd);
}
