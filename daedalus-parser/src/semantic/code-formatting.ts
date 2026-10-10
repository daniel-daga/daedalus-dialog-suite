/**
 * The indentation to strip from an action's continuation lines: the source
 * line's, except for a conditional, whose branch lines are generated relative
 * and whose own condition is placed by ConditionalAction itself.
 */
export function continuationIndent(action: { type?: string; sourceIndent?: string }): string | undefined {
  return action.type === 'ConditionalAction' ? undefined : action.sourceIndent;
}

/**
 * Indent generated action lines without inserting whitespace into multiline
 * Daedalus string literals or the interior of block comments. Daedalus ends a
 * string at the next quote and has no escapes, so a small scanner is sufficient
 * and keeps literal bytes intact.
 */
export function indentGeneratedCode(code: string, indent: string, sourceIndent?: string): string {
  const parts = code.split(/(\r\n|\r|\n)/);
  let inString = false;
  let inBlockComment = false;
  let output = '';

  for (let partIndex = 0; partIndex < parts.length; partIndex += 2) {
    let line = parts[partIndex];
    const newline = parts[partIndex + 1] ?? '';
    // A continuation line of parsed source carries its line's absolute
    // indentation (#384); make it relative before indenting it again.
    if (partIndex > 0 && sourceIndent && !inString && !inBlockComment && line.startsWith(sourceIndent)) {
      line = line.slice(sourceIndent.length);
    }
    output += inString || inBlockComment ? line : line.trim() ? indent + line : '';
    output += newline;

    for (let index = 0; index < line.length; index++) {
      const current = line[index];
      const next = line[index + 1];
      if (inBlockComment) {
        if (current === '*' && next === '/') {
          inBlockComment = false;
          index++;
        }
      } else if (inString) {
        if (current === '"') {
          inString = false;
        }
      } else if (current === '"') {
        inString = true;
      } else if (current === '/' && next === '*') {
        inBlockComment = true;
        index++;
      } else if (current === '/' && next === '/') {
        break;
      }
    }
  }

  return output;
}
