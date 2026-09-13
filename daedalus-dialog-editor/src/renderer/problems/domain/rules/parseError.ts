import type { LintRule, Problem } from '../types';

/**
 * `parse-error`: a file the project index could not parse.
 *
 * The one rule whose input is not derived from the parsed models at all —
 * because the file it is about has none. `extractFileMetadataFromSource`
 * already calls `checkForSyntaxErrors` on every file in the project and then
 * *withholds* the model of any file that has errors, so before this the errors
 * were found and dropped: a project with a broken file nobody had opened
 * reported clean (#267). The index carries them now, capped per file, and this
 * rule turns them into rows.
 *
 * It is also the only rule that can name a line. The semantic model keeps
 * source positions on top-level declarations alone, so every other finding
 * addresses a dialog or a function; a syntax error has nothing *but* a
 * position. Nothing jumps to it — the source view is gone — but the panel shows
 * it, and clicking the row opens the file, which renders `SyntaxErrorsDisplay`.
 */
export const parseErrorRule: LintRule = (view): Problem[] => {
  const problems: Problem[] = [];

  for (const file of view.parseErrors) {
    file.errors.forEach((error, index) => {
      problems.push({
        id: `parse-error:${file.filePath}:${index}`,
        rule: 'parse-error',
        severity: 'error',
        // The offending source is what tells one syntax error in a file from
        // the next; the parser's message already carries line and column.
        message: error.text ? `${error.message} — ${error.text}` : error.message,
        locus: { kind: 'script', filePath: file.filePath, line: error.line }
      });
    });

    // What the index capped away. Saying the count is the difference between a
    // list that is short and a list that is lying.
    const hidden = file.total - file.errors.length;
    if (hidden > 0) {
      problems.push({
        id: `parse-error-more:${file.filePath}`,
        rule: 'parse-error',
        severity: 'error',
        message: `…and ${hidden} more syntax error${hidden === 1 ? '' : 's'} in this file.`,
        locus: { kind: 'script', filePath: file.filePath }
      });
    }
  }

  return problems;
};
