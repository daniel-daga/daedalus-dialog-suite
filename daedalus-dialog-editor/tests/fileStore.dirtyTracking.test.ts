/**
 * workingCode dirty semantics (E2a).
 *
 * A source-dirty file (workingCode differs from originalCode) counts as unsaved
 * and its typed source must never be silently wiped by a model mutation. The
 * only way to reconcile is the explicit adoptWorkingCode action.
 *
 * TDD: the mutation-no-op and adopt cases are red before the rework.
 */

import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { useEditorStore } from '../src/renderer/store/editorStore';
import { isSourceDirty, hasUnsavedChanges } from '../src/renderer/store/fileStore';
import type { FileState } from '../src/renderer/store/fileStore';

const mockParseSource = jest.spyOn(window.editorAPI, 'parseSource');

const makeFileState = (over: Partial<FileState>): FileState => ({
  filePath: 'x.d',
  semanticModel: { dialogs: {}, functions: {}, hasErrors: false, errors: [] },
  isDirty: false,
  lastSaved: new Date(),
  ...over,
});

const baseState = {
  activeFile: null as string | null,
  pendingValidation: null,
  project: null,
  codeSettings: {
    indentChar: '\t' as const,
    includeComments: true,
    sectionHeaders: true,
    uppercaseKeywords: true,
  },
  autoSaveEnabled: true,
  autoSaveInterval: 2000,
};

describe('isSourceDirty / hasUnsavedChanges derivation', () => {
  test('isSourceDirty is true only when workingCode differs from originalCode', () => {
    expect(isSourceDirty(makeFileState({ originalCode: 'a', workingCode: undefined }))).toBe(false);
    expect(isSourceDirty(makeFileState({ originalCode: 'a', workingCode: 'a' }))).toBe(false);
    expect(isSourceDirty(makeFileState({ originalCode: 'a', workingCode: 'b' }))).toBe(true);
  });

  test('hasUnsavedChanges covers model-dirty, source-dirty, and external conflict', () => {
    expect(hasUnsavedChanges(makeFileState({ isDirty: false }))).toBe(false);
    expect(hasUnsavedChanges(makeFileState({ isDirty: true }))).toBe(true);
    expect(hasUnsavedChanges(makeFileState({ originalCode: 'a', workingCode: 'b' }))).toBe(true);
    expect(hasUnsavedChanges(makeFileState({ externalConflict: { detectedAt: 'now' } }))).toBe(true);
  });
});

describe('model mutation while source-dirty', () => {
  beforeEach(() => {
    useEditorStore.setState({ ...baseState, openFiles: new Map() });
  });

  test('no-ops and preserves workingCode, flags blockedBySourceEdit', () => {
    const filePath = 'src-dirty.d';
    useEditorStore.setState({
      openFiles: new Map([[filePath, makeFileState({
        filePath,
        semanticModel: { dialogs: { D1: { properties: { npc: 'NPC1' } } }, functions: {}, hasErrors: false, errors: [] },
        originalCode: 'original source',
        workingCode: 'edited source in the code editor',
      })]]),
      activeFile: filePath,
    });

    useEditorStore.getState().updateDialog(filePath, 'D1', { properties: { npc: 'NPC2' } });

    const fileState = useEditorStore.getState().getFileState(filePath);
    // Mutation was refused
    expect(fileState?.semanticModel.dialogs.D1).toEqual({ properties: { npc: 'NPC1' } });
    expect(fileState?.isDirty).toBe(false);
    // Typed source preserved
    expect(fileState?.workingCode).toBe('edited source in the code editor');
    expect(fileState?.blockedBySourceEdit).toBe(true);
  });

  test('clears workingCode on mutation when it is not source-dirty', () => {
    const filePath = 'clean-source.d';
    useEditorStore.setState({
      openFiles: new Map([[filePath, makeFileState({
        filePath,
        semanticModel: { dialogs: { D1: { properties: { npc: 'NPC1' } } }, functions: {}, hasErrors: false, errors: [] },
        originalCode: 'same',
        workingCode: 'same', // equal → not source-dirty
      })]]),
      activeFile: filePath,
    });

    useEditorStore.getState().updateDialog(filePath, 'D1', { properties: { npc: 'NPC2' } });

    const fileState = useEditorStore.getState().getFileState(filePath);
    expect(fileState?.semanticModel.dialogs.D1).toEqual({ properties: { npc: 'NPC2' } });
    expect(fileState?.isDirty).toBe(true);
    expect(fileState?.workingCode).toBeUndefined();
  });
});

describe('adoptWorkingCode', () => {
  beforeEach(() => {
    useEditorStore.setState({ ...baseState, openFiles: new Map() });
    mockParseSource.mockReset();
  });

  test('success adopts the parsed model, marks dirty, clears workingCode', async () => {
    const filePath = 'adopt-ok.d';
    useEditorStore.setState({
      openFiles: new Map([[filePath, makeFileState({
        filePath,
        semanticModel: { dialogs: {}, functions: {}, hasErrors: false, errors: [] },
        originalCode: 'old',
        workingCode: 'new source',
        blockedBySourceEdit: true,
      })]]),
      activeFile: filePath,
    });

    const parsed = { dialogs: { DNew: { properties: { npc: 'NPC1' } } }, functions: {}, hasErrors: false, errors: [] };
    mockParseSource.mockResolvedValueOnce(parsed as any);

    const result = await useEditorStore.getState().adoptWorkingCode(filePath);

    expect(result.ok).toBe(true);
    const fileState = useEditorStore.getState().getFileState(filePath);
    expect(fileState?.semanticModel.dialogs.DNew).toBeDefined();
    expect(fileState?.isDirty).toBe(true);
    expect(fileState?.workingCode).toBeUndefined();
    expect(fileState?.blockedBySourceEdit).toBeUndefined();
  });

  test('parse errors keep workingCode and return the errors', async () => {
    const filePath = 'adopt-bad.d';
    useEditorStore.setState({
      openFiles: new Map([[filePath, makeFileState({
        filePath,
        semanticModel: { dialogs: { Keep: { properties: { npc: 'NPC1' } } }, functions: {}, hasErrors: false, errors: [] },
        originalCode: 'old',
        workingCode: 'broken source {',
      })]]),
      activeFile: filePath,
    });

    const errors = [{ type: 'syntax_error', message: 'unexpected {', position: { row: 1, column: 1 } }];
    mockParseSource.mockResolvedValueOnce({ dialogs: {}, functions: {}, hasErrors: true, errors } as any);

    const result = await useEditorStore.getState().adoptWorkingCode(filePath);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(errors);
    const fileState = useEditorStore.getState().getFileState(filePath);
    // Old model untouched, typed source retained
    expect(fileState?.semanticModel.dialogs.Keep).toBeDefined();
    expect(fileState?.workingCode).toBe('broken source {');
    expect(fileState?.isDirty).toBe(false);
  });
});
