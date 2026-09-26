/**
 * A dialog's description is the choice the player reads, and in the scripts it
 * is the hero's first line (#277). The two are "in sync" while the
 * description's text equals the information function's first line, and an
 * empty description with no lines counts too, so a new dialog fills from its
 * first line. There is no stored flag: a hand-edited description that differs
 * is what breaks the link.
 */
import type { SemanticModel } from '../types/global';

type ActionList = { actions?: unknown[] } | null | undefined;

/** Text of the function's first top-level dialog line, or '' when it has none. */
export const firstLineText = (fn: ActionList): string => {
  const first = (fn?.actions ?? []).find(
    (action) => (action as { type?: string } | null)?.type === 'DialogLine'
  ) as { text?: string } | undefined;
  return first?.text ?? '';
};

/** The description as the player reads it — the parser keeps a string literal's quotes. */
const descriptionText = (description: unknown): string => {
  const text = typeof description === 'string' ? description : '';
  return text.length >= 2 && text.startsWith('"') && text.endsWith('"') ? text.slice(1, -1) : text;
};

export const isDescriptionInSync = (description: unknown, lineText: string): boolean =>
  descriptionText(description) === lineText;

/** Written quoted: an unquoted single word would be emitted as an identifier. */
export const descriptionFromLine = (lineText: string): string => `"${lineText}"`;

const functionNameOf = (ref: unknown): string | undefined =>
  typeof ref === 'string' ? ref : (ref as { name?: string } | null)?.name;

/**
 * Carry a change of `functionName`'s first line into every dialog that uses it
 * as its information function and whose description matched `oldLine`, read
 * before the edit. Mutates `model` — the store's draft, inside the same write.
 */
export const followFirstLine = (
  model: SemanticModel,
  functionName: string,
  oldLine: string,
  after: ActionList
): void => {
  const newLine = firstLineText(after);
  if (oldLine === newLine) return;

  const key = functionName.toLowerCase();
  for (const dialog of Object.values(model.dialogs || {})) {
    const properties = dialog?.properties;
    if (!properties || functionNameOf(properties.information)?.toLowerCase() !== key) continue;
    if (isDescriptionInSync(properties.description, oldLine)) {
      properties.description = descriptionFromLine(newLine);
    }
  }
};
