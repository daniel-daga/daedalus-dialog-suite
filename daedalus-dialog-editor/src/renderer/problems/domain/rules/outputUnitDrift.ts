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
 * This is the check half of #264. It reports the drift; regenerating the
 * database is the other half and is not built.
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
      for (const { id, text, line } of func.voiceIds) {
        // Ids are matched case-insensitively because Daedalus is and the OU
        // writer upper-cases; the subtitle is compared verbatim because it is
        // what the player reads, so a changed capital is a real edit.
        const recorded = units.get(id.trim().toUpperCase());
        const locus = { kind: 'script' as const, filePath: file.filePath, functionName: func.name, line };

        if (recorded === undefined) {
          problems.push({
            id: `output-unit-missing:${file.filePath}:${func.name}:${id.toUpperCase()}`,
            rule: 'output-unit-missing',
            severity: 'warning',
            message:
              `"${id}" is not in the OutputUnit database, so the game has no subtitle for it. ` +
              'Regenerate the OUs before testing this line.',
            locus
          });
        } else if (recorded !== text) {
          problems.push({
            id: `output-unit-stale:${file.filePath}:${func.name}:${id.toUpperCase()}`,
            rule: 'output-unit-stale',
            severity: 'warning',
            message:
              `"${id}" says "${text}" here, but the OutputUnit database still holds "${recorded}" — ` +
              'which is what the game will show.',
            locus
          });
        }
      }
    }
  }

  return problems;
};
