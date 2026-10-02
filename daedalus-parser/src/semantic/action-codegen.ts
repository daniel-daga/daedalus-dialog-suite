import type { CodeGenOptions, CodeGeneratable } from './semanticModelInterfaces';

interface Token {
  text: string;
  start: number;
  end: number;
  comment: boolean;
}

interface Call {
  name: Token;
  args: Token[][];
  close: Token;
}

// Only scan a single generated call. Daedalus strings have no escapes: a
// backslash is literal and the next quote closes even a multiline string.
function tokens(code: string): Token[] {
  const result: Token[] = [];
  // Keep decimal literals whole: leading fractional zeros are significant.
  const pattern = /\/\*[^]*?\*\/|\/\/[^\r\n]*|"[^"]*"|\s+|[A-Za-z_][A-Za-z0-9_]*|[0-9]+(?:\.[0-9]+)?|./g;
  for (const match of code.matchAll(pattern)) {
    const text = match[0];
    if (/^\s+$/.test(text)) continue;
    result.push({
      text,
      start: match.index!,
      end: match.index! + text.length,
      comment: text.startsWith('//') || text.startsWith('/*')
    });
  }
  return result;
}

function callFromTokens(allTokens: Token[]): Call | null {
  const code = allTokens.filter(token => !token.comment);
  if (!code[0] || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(code[0].text) || code[1]?.text !== '(') return null;
  const args: Token[][] = [];
  let current: Token[] = [];
  let depth = 1;
  for (const token of code.slice(2)) {
    if (token.text === '(' || token.text === '[') depth++;
    if (token.text === ')' || token.text === ']') depth--;
    if (depth === 0) {
      if (current.length > 0) args.push(current);
      return { name: code[0], args, close: token };
    }
    if (token.text === ',' && depth === 1) {
      args.push(current);
      current = [];
    } else {
      current.push(token);
    }
  }
  return null;
}

function sameArgument(source: Token[], generated: Token[]): boolean {
  const normalize = (token: Token) => /^\d+$/.test(token.text) ? String(Number(token.text)) : token.text;
  return source.length === generated.length && source.every((token, index) => normalize(token) === normalize(generated[index]));
}

function renderComments(comments: Token[]): string {
  return comments.map(token => token.text + (token.text.startsWith('//') ? '\n' : ' ')).join('');
}

/**
 * Reconcile a commented call with the current semantic fields instead of
 * replaying stale source. Unchanged arguments and surrounding trivia stay
 * verbatim. Comments inside an edited expression move before its replacement;
 * a line comment always gets a newline before the new executable expression.
 * No additional metadata is required, so older JSON models work as well.
 */
export function generateActionCode(action: CodeGeneratable & { sourceText?: string }, options: CodeGenOptions): string {
  const generated = action.generateCode(options);
  if (!options.includeComments || !action.sourceText) return generated;

  const source = action.sourceText;
  const originalTokens = tokens(source);
  const generatedTokens = tokens(generated);
  const originalCall = callFromTokens(originalTokens);
  const currentCall = callFromTokens(generatedTokens);
  if (!originalCall || !currentCall || originalCall.args.length !== currentCall.args.length) {
    // A structural edit such as a changed call arity cannot use the old call
    // layout. Keep its comments ahead of the current semantic statement.
    const missingComments = originalTokens.filter(token => token.comment &&
      !generatedTokens.some(current => current.comment && current.text === token.text));
    return renderComments(missingComments) + generated;
  }

  const replacements: { start: number; end: number; text: string }[] = [];
  if (originalCall.name.text.toLowerCase() !== currentCall.name.text.toLowerCase()) {
    replacements.push({ start: originalCall.name.start, end: originalCall.name.end, text: currentCall.name.text });
  }
  for (let index = 0; index < originalCall.args.length; index++) {
    const previous = originalCall.args[index];
    const current = currentCall.args[index];
    if (sameArgument(previous, current)) continue;
    if (previous.length === 0 || current.length === 0) return generated;
    const start = previous[0].start;
    const end = previous[previous.length - 1].end;
    const replacement = generated.slice(current[0].start, current[current.length - 1].end);
    const replacementTokens = tokens(replacement);
    const comments = originalTokens.filter(token => token.comment && token.start >= start && token.end <= end &&
      !replacementTokens.some(updated => updated.comment && updated.text === token.text));
    replacements.push({ start, end, text: renderComments(comments) + replacement });
  }

  // Semicolons and AI_Output subtitles come from the current model, rather
  // than from the cached call (which deliberately excludes the subtitle).
  let result = source.slice(0, originalCall.close.end);
  for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
    result = result.slice(0, replacement.start) + replacement.text + result.slice(replacement.end);
  }
  return result + generated.slice(currentCall.close.end);
}
