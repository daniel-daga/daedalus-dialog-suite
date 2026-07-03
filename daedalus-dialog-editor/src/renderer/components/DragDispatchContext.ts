import { createContext } from 'react';

/**
 * Move handler for one droppable list: (sourceIndex, destinationIndex) => void.
 * Each ActionsList registers one, keyed by its namespaced droppableId.
 */
export type DragMoveHandler = (sourceIndex: number, destinationIndex: number) => void;

/**
 * Registry shared by a single DragDropContext per dialog-editing pane (fix-05
 * §2.5). The dnd library forbids nested DragDropContexts, so the top-level
 * pane (DialogActionsSection) renders exactly one context and every descendant
 * ActionsList — including nested ConditionalAction branches and InlineChoice
 * sub-lists — registers its per-list move handler here instead of mounting its
 * own context. The pane's onDragEnd dispatches by `source.droppableId`.
 *
 * A null context means no pane provider is present (e.g. a standalone render or
 * a unit test); in that case ActionsList falls back to its own DragDropContext.
 */
export interface DragDispatchContextValue {
  register: (droppableId: string, handler: DragMoveHandler) => () => void;
}

export const DragDispatchContext = createContext<DragDispatchContextValue | null>(null);
