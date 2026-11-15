import type { LintRule, Problem } from '../types';

/**
 * `function-overload`: a function name declared again in the same file with a
 * different parameter list (#567).
 *
 * The parser accepts it (#557) — `Hlp_GetInstanceID` takes a `C_NPC` or a
 * `C_ITEM` — and keeps the additional signature as raw source: saved as
 * written, but not editable, and reached by name like the first. That is also
 * exactly what an accidental redeclaration with a changed parameter list looks
 * like, so each one is named. A hint, never more: it must not block a save,
 * and a deliberate overload is legal.
 *
 * A repeated *identical* signature is a `duplicate_declaration` parse error
 * and not this rule. Engine reference stubs are no noise here because the rule
 * reads the scanned project files only, and those follow the project's `.src`
 * lists (#559). The parser's check is per file, so this is too.
 */
export const functionOverloadRule: LintRule = (view): Problem[] => {
  const problems: Problem[] = [];

  for (const { filePath, facts } of view.fileFacts) {
    // `overloads` may be absent on facts cached or built before the field.
    (facts.overloads || []).forEach((overload, index) => {
      problems.push({
        id: `function-overload:${filePath}:${overload.name}:${index}`,
        rule: 'function-overload',
        severity: 'hint',
        message: `Function "${overload.name}" is declared again with a different parameter list. `
          + 'The additional signature is kept as written and cannot be edited here; '
          + 'if it is not a deliberate overload, one of the two is a leftover.',
        locus: { kind: 'script', filePath, functionName: overload.name, line: overload.line }
      });
    });
  }

  return problems;
};
