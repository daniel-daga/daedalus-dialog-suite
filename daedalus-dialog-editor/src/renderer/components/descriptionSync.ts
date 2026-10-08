/**
 * A dialog's description is the choice the player reads, and in the scripts it
 * is the hero's first line (#277). The two are "in sync" while the
 * description's text equals the information function's first line, and an
 * empty description with no lines counts too, so a new dialog fills from its
 * first line. There is no stored flag: a hand-edited description that differs
 * is what breaks the link, and a description that names a constant never follows.
 */
import type { Dialog, SemanticModel } from '../types/global';
import { sanitizeDaedalusString } from '../utils/pathAndIdentifierUtils';

type ActionList = { actions?: unknown[] } | null | undefined;
type DescribedDialog = Pick<Dialog, 'properties' | 'propertyLiteralKeys' | 'propertyExpressionKeys'>;

/** Text of the function's first top-level dialog line, or '' when it has none. */
export const firstLineText = (fn: ActionList): string => {
  const first = (fn?.actions ?? []).find(
    (action) => (action as { type?: string } | null)?.type === 'DialogLine'
  ) as { text?: string } | undefined;
  return first?.text ?? '';
};

/**
 * The description names a constant (or is another expression) rather than
 * holding text. The parser records the kind in the key lists; the value itself
 * is the string's contents or the expression's source, never quoted.
 */
export const isDescriptionConstant = (dialog: DescribedDialog): boolean =>
  dialog.propertyExpressionKeys?.includes('description') ?? false;

/**
 * As a description holds it: a Daedalus string cannot contain a double quote or
 * a line break, so a first line that has them is followed without.
 */
const asDescriptionText = (text: string): string => sanitizeDaedalusString(text);

export const isDescriptionInSync = (dialog: DescribedDialog, lineText: string): boolean =>
  !isDescriptionConstant(dialog) && (dialog.properties?.description ?? '') === asDescriptionText(lineText);

const withoutDescription = (keys?: string[]) => (keys ?? []).filter((key) => key !== 'description');

/** The dialog with its description set as text, or — `constant` — as a constant's name. */
export const withDescription = <T extends DescribedDialog>(dialog: T, value: string, constant: boolean): T => ({
  ...dialog,
  properties: { ...dialog.properties, description: constant ? value : asDescriptionText(value) },
  propertyLiteralKeys: constant
    ? withoutDescription(dialog.propertyLiteralKeys)
    : [...withoutDescription(dialog.propertyLiteralKeys), 'description'],
  propertyExpressionKeys: constant
    ? [...withoutDescription(dialog.propertyExpressionKeys), 'description']
    : withoutDescription(dialog.propertyExpressionKeys)
});

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
  const dialogs = model.dialogs || {};
  for (const [name, dialog] of Object.entries(dialogs)) {
    if (!dialog?.properties || functionNameOf(dialog.properties.information)?.toLowerCase() !== key) continue;
    if (isDescriptionInSync(dialog, oldLine)) {
      dialogs[name] = withDescription(dialog, newLine, false);
    }
  }
};
