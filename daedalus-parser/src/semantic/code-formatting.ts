/**
 * Indent generated action lines without inserting whitespace into multiline
 * Daedalus string literals. Daedalus ends a string at the next quote and has
 * no escapes, so a small scanner is sufficient and keeps literal bytes intact.
 */
export function indentGeneratedCode(code: string, indent: string): string {
  const parts = code.split(/(\r\n|\r|\n)/);
  let inString = false;
  let inBlockComment = false;
  let output = '';

  for (let partIndex = 0; partIndex < parts.length; partIndex += 2) {
    const line = parts[partIndex];
    const newline = parts[partIndex + 1] ?? '';
    output += inString ? line : line.trim() ? indent + line : '';
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
