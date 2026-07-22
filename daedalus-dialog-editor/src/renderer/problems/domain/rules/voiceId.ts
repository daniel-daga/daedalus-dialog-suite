import type { LintRule, Problem } from '../types';
import { forEachAction } from '../walk';
import type { DialogLineAction } from '../../../../shared/types';

/** One literal, non-empty voice id and where it was written. */
interface VoiceIdOccurrence {
  id: string;
  filePath: string;
  functionName: string;
}

/** Vanilla voice ids end in `_<number>_<number>`, e.g. `DIA_Alrik_Teach_15_00`. */
const VANILLA_PATTERN = /_\d+_\d+$/;

/**
 * `voice-id-duplicate` / `voice-id-malformed`: project-wide checks over every
 * `DialogLine` voice id.
 *
 * Only literal, non-empty ids are considered (expression-valued ids are skipped
 * because their runtime value is unknown). Duplicates are grouped
 * case-insensitively across files and functions, emitting one navigable problem
 * per occurrence; malformed ids are flagged independently, so a single id can
 * raise both a duplicate and a malformed warning.
 */
export const voiceIdRule: LintRule = (view): Problem[] => {
  const occurrences: VoiceIdOccurrence[] = [];

  for (const file of view.files) {
    for (const func of Object.values(file.model.functions || {})) {
      forEachAction(func.actions, (action) => {
        if (action.type !== 'DialogLine') {
          return;
        }
        const line = action as DialogLineAction;
        if (typeof line.id !== 'string' || line.id.trim() === '' || line.idIsExpression) {
          return;
        }
        occurrences.push({ id: line.id, filePath: file.filePath, functionName: func.name });
      });
    }
  }

  const problems: Problem[] = [];

  const byUpperId = new Map<string, VoiceIdOccurrence[]>();
  for (const occ of occurrences) {
    const upper = occ.id.toUpperCase();
    const group = byUpperId.get(upper);
    if (group) {
      group.push(occ);
    } else {
      byUpperId.set(upper, [occ]);
    }
  }

  for (const [upper, group] of byUpperId) {
    if (group.length < 2) {
      continue;
    }
    for (const occ of group) {
      problems.push({
        id: `voice-id-duplicate:${occ.filePath}:${occ.functionName}:${upper}`,
        rule: 'voice-id-duplicate',
        severity: 'warning',
        message: `Voice ID "${occ.id}" is used ${group.length} times across the project.`,
        filePath: occ.filePath,
        functionName: occ.functionName
      });
    }
  }

  for (const occ of occurrences) {
    if (VANILLA_PATTERN.test(occ.id)) {
      continue;
    }
    problems.push({
      id: `voice-id-malformed:${occ.filePath}:${occ.functionName}:${occ.id.toUpperCase()}`,
      rule: 'voice-id-malformed',
      severity: 'warning',
      message: `Voice ID "${occ.id}" does not match the expected naming pattern (…_<number>_<number>).`,
      filePath: occ.filePath,
      functionName: occ.functionName
    });
  }

  return problems;
};
