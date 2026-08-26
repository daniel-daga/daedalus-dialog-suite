import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

/**
 * Pure UI selection state: which NPC / dialog / quest / function / action the
 * user currently has selected, and which main view (dialog, quest, variable,
 * problems) is active.
 *
 * Extracted from editorStore so that file-lifecycle and history concerns are
 * not co-located with ephemeral UI cursor state.
 */

/** The top-level views. `world` is the level editor (level-editor.md §6). */
export type ActiveView = 'dialog' | 'quest' | 'variable' | 'problems' | 'world';

interface UISelectionStore {
  selectedNPC: string | null;
  selectedDialog: string | null;
  selectedQuest: string | null;
  selectedFunctionName: string | null;
  selectedAction: number | null;
  activeView: ActiveView;

  setSelectedNPC: (npcName: string | null) => void;
  setSelectedDialog: (dialogName: string | null) => void;
  setSelectedQuest: (questName: string | null) => void;
  setSelectedFunctionName: (functionName: string | null) => void;
  setSelectedAction: (actionIndex: number | null) => void;
  setActiveView: (view: ActiveView) => void;
  /** Reset all selection state to initial values (called by editorStore.resetEditorSession). */
  resetUISelection: () => void;
}

const INITIAL_STATE = {
  selectedNPC: null,
  selectedDialog: null,
  selectedQuest: null,
  selectedFunctionName: null,
  selectedAction: null,
  activeView: 'dialog' as const,
};

export const useUISelectionStore = create<UISelectionStore>()(
  immer((set) => ({
    ...INITIAL_STATE,

    setSelectedNPC: (npcName) => set((state) => { state.selectedNPC = npcName; }),
    setSelectedDialog: (dialogName) => set((state) => { state.selectedDialog = dialogName; }),
    setSelectedQuest: (questName) => set((state) => { state.selectedQuest = questName; }),
    setSelectedFunctionName: (functionName) => set((state) => { state.selectedFunctionName = functionName; }),
    setSelectedAction: (actionIndex) => set((state) => { state.selectedAction = actionIndex; }),
    setActiveView: (view) => set((state) => { state.activeView = view; }),

    resetUISelection: () => set((state) => {
      state.selectedNPC = INITIAL_STATE.selectedNPC;
      state.selectedDialog = INITIAL_STATE.selectedDialog;
      state.selectedQuest = INITIAL_STATE.selectedQuest;
      state.selectedFunctionName = INITIAL_STATE.selectedFunctionName;
      state.selectedAction = INITIAL_STATE.selectedAction;
      state.activeView = INITIAL_STATE.activeView;
    }),
  }))
);
