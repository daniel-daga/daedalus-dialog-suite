/**
 * Pure helper types and functions for quest undo/redo history management.
 * Extracted from editorStore to separate the history concern from the store.
 */

import type { SemanticModel } from '../types/global';

export interface QuestNodePosition {
  x: number;
  y: number;
}

export type QuestNodePositionMap = Map<string, QuestNodePosition>;

/**
 * Snapshot used by the unified edit history (dialog + quest surfaces).
 * The timestamp coalesces rapid edits into a single undo step; quest-surface
 * snapshots use timestamp 0 so later edits never coalesce into them.
 * The model is held by reference (structurally shared with Immer-frozen
 * fileStore state), not deep-cloned.
 */
export interface EditSnapshot {
  /**
   * Monotonic, process-unique id assigned when the snapshot is created. Quest
   * batch entries reference this id to validate — eviction-proof, unlike stack
   * depths — that the exact snapshot they pushed still sits on a member file's
   * stack before a batch undo/redo acts (finding U1).
   */
  id: number;
  model: SemanticModel;
  nodePositions: Map<string, QuestNodePositionMap>;
  timestamp: number;
}

export interface EditHistoryState {
  past: EditSnapshot[];
  future: EditSnapshot[];
}

/**
 * One file's participation in a quest batch. Records the id of the exact
 * snapshot pushed onto (or created for) the file's edit history, so batch
 * undo/redo can verify that no newer edit has landed on top before reverting.
 * Snapshot ids are monotonic and eviction-proof, which makes id equality a
 * sound staleness check (finding U1).
 */
export interface QuestBatchEntry {
  filePath: string;
  snapshotId: number;
}

export interface QuestBatchHistoryState {
  past: QuestBatchEntry[][];
  future: QuestBatchEntry[][];
}

export const normalizeBatchFilePaths = (filePaths: string[]): string[] => (
  Array.from(new Set(filePaths.filter((filePath) => filePath.trim().length > 0)))
);

export function cloneQuestNodePositionsForFile(
  positions: Map<string, QuestNodePositionMap> | undefined
): Map<string, QuestNodePositionMap> {
  if (!positions) return new Map();
  const cloned = new Map<string, QuestNodePositionMap>();
  positions.forEach((nodeMap, questName) => {
    const nextNodeMap: QuestNodePositionMap = new Map();
    nodeMap.forEach((position, nodeId) => {
      nextNodeMap.set(nodeId, { x: position.x, y: position.y });
    });
    cloned.set(questName, nextNodeMap);
  });
  return cloned;
}
