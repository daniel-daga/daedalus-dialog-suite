import type { LintRule, Problem } from '../types';

/**
 * `output-unit-stale` / `output-unit-missing`: every `AI_Output` line in the
 * project against the OutputUnit database the game actually reads (#264).
 *
 * Subtitles do not come from the scripts at runtime. They come from `OU.BIN`,
 * which reparsing does not regenerate — so a line edited here compiles cleanly
 * and shows the old text in game, and our own GMBT quick test passes
 * `--noupdatesubtitles`, which means testing with our own button reproduces the
 * stale subtitle rather than exposing it. To a user who does not know the OU
 * mechanic that reads as this editor's bug. Nothing here could notice it.
 *
 * This is the check half of #264. Each finding also carries the line the
 * database should hold, which the panel's "Update OUs" writes — the fix half.
 *
 * `view.outputUnits` absent means no database was found — nothing is known, so
 * nothing is reported. That is not the same as an empty database, and a project
 * legitimately opens with no Gothic install behind it.
 */
export const outputUnitDriftRule: LintRule = (view): Problem[] => {
  const units = view.outputUnits;
  if (!units) return [];

  const problems: Problem[] = [];

  for (const file of view.fileFacts) {
    for (const func of file.facts.functions) {
      for (const { id, text: comment, line } of func.voiceIds) {
        // Ids are matched case-insensitively because Daedalus is and the OU
        // writer upper-cases; the subtitle is compared verbatim because it is
        // what the player reads, so a changed capital is a real edit. Only the
        // ends are trimmed: the retail OU holds `// Text. ` as `Text.`.
        const text = comment.trim();
        const recorded = units.get(id.trim().toUpperCase())?.trim();
        const locus = { kind: 'script' as const, filePath: file.filePath, functionName: func.name, line };

        if (recorded === undefined) {
          problems.push({
            id: `output-unit-missing:${file.filePath}:${func.name}:${id.toUpperCase()}`,
            rule: 'output-unit-missing',
            severity: 'warning',
            message:
              `"${id}" is not in the OutputUnit database, so the game has no subtitle for it. ` +
              'Update the OUs before testing this line.',
            locus,
            outputUnitLine: { name: id, text }
          });
        } else if (recorded !== text) {
          problems.push({
            id: `output-unit-stale:${file.filePath}:${func.name}:${id.toUpperCase()}`,
            rule: 'output-unit-stale',
            severity: 'warning',
            message:
              `"${id}" says "${text}" here, but the OutputUnit database still holds "${recorded}" — ` +
              'which is what the game will show.',
            locus,
            outputUnitLine: { name: id, text }
          });
        }
      }
    }
  }

  return problems;
};

/**
 * How many of the project's `AI_Output` lines the database also holds, and how
 * many of those disagree (#265). A line the database lacks is neither: it says
 * nothing about which language the database is in. Null without a database.
 */
export function outputUnitAgreement(view: Parameters<LintRule>[0]): { compared: number; stale: number } | null {
  const units = view.outputUnits;
  if (!units) return null;
  let compared = 0;
  let stale = 0;
  for (const file of view.fileFacts) {
    for (const func of file.facts.functions) {
      for (const { id, text } of func.voiceIds) {
        const recorded = units.get(id.trim().toUpperCase());
        if (recorded === undefined) continue;
        compared += 1;
        if (recorded.trim() !== text.trim()) stale += 1;
      }
    }
  }
  return { compared, stale };
}

/**
 * Whether the disagreement is too wide to be edits: German MDK scripts over an
 * English OU (#265), or the reverse. Every line then reads as stale, which is
 * true line by line and wrong as a diagnosis — and "Update OUs" would overwrite
 * the database with the other language. No edit session touches half of the
 * lines a mod shares with its OU; twenty is the floor so a tiny project's two
 * edited lines are not called a language.
 */
export function looksLikeAnotherLanguage({ compared, stale }: { compared: number; stale: number }): boolean {
  return compared >= 20 && stale * 2 >= compared;
}
