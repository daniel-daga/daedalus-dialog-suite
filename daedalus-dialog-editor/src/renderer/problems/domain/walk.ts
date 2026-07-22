import type { DialogAction } from '../../../shared/types';

/**
 * Visits every action reachable from `actions`, descending into
 * `ConditionalAction` then/else branches. Order is pre-order (a conditional is
 * visited before its nested actions). Shared by the choice and voice-id rules,
 * which both need to see actions nested inside conditional branches.
 */
export function forEachAction(
  actions: DialogAction[] | undefined,
  visit: (action: DialogAction) => void
): void {
  for (const action of actions || []) {
    visit(action);
    if (action.type === 'ConditionalAction') {
      forEachAction(action.thenActions, visit);
      forEachAction(action.elseActions, visit);
    }
  }
}
