/**
 * Split editable argument text at top-level commas. Daedalus strings have no
 * escapes; commas in strings, comments and nested expressions remain content.
 * Incomplete expressions remain editable without requiring the native parser.
 */
export function splitDaedalusArguments(text: string): string[] {
  const args: string[] = [];
  let start = 0;
  let depth = 0;
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;
  const append = (end: number) => {
    // Keep physical trailing newlines: trimming them after a // comment would
    // swallow the comma and following argument when the list is regenerated.
    const argument = text.slice(start, end).trimStart().replace(/[ \t]+$/, '');
    if (argument.trim()) args.push(argument);
  };

  for (let index = 0; index < text.length; index++) {
    const current = text[index];
    const next = text[index + 1];
    if (inString) {
      if (current === '"') inString = false;
    } else if (inLineComment) {
      if (current === '\r' || current === '\n') inLineComment = false;
    } else if (inBlockComment) {
      if (current === '*' && next === '/') {
        inBlockComment = false;
        index++;
      }
    } else if (current === '"') {
      inString = true;
    } else if (current === '/' && next === '/') {
      inLineComment = true;
      index++;
    } else if (current === '/' && next === '*') {
      inBlockComment = true;
      index++;
    } else if ('([{'.includes(current)) {
      depth++;
    } else if (')]}'.includes(current)) {
      depth = Math.max(0, depth - 1);
    } else if (current === ',' && depth === 0) {
      append(index);
      start = index + 1;
    }
  }
  append(text.length);
  return args;
}
