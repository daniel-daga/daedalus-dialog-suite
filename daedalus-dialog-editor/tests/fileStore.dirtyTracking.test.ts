/**
 * Dirty semantics after the source-editing state machine was removed (F2).
 *
 * The Source Code view was commented out of `MainLayout` but its state machine
 * stayed wired, so in the shipped app `workingCode` was permanently undefined,
 * `isSourceDirty` permanently false, and every branch keyed on it unreachable.
 * The machine is deleted: a file is unsaved when its model is dirty or it is in
 * external conflict, and a model mutation is never refused.
 *
 * TDD: the removal guard and the always-applies mutation case are red before
 * the deletion lands.
 */

import * as fs from 'fs';
import * as path from 'path';
import { describe, test, expect, beforeEach } from '@jest/globals';
import { useEditorStore } from '../src/renderer/store/editorStore';
import * as fileStoreModule from '../src/renderer/store/fileStore';
import { hasUnsavedChanges } from '../src/renderer/store/fileStore';
import type { FileState } from '../src/renderer/store/fileStore';

const RENDERER_DIR = path.join(__dirname, '..', 'src', 'renderer');

const makeFileState = (over: Partial<FileState>): FileState => ({
  filePath: 'x.d',
  semanticModel: { dialogs: {}, functions: {}, hasErrors: false, errors: [] },
  isDirty: false,
  lastSaved: new Date(),
  ...over,
});

const baseState = {
  activeFile: null as string | null,
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

describe('hasUnsavedChanges derivation', () => {
  test('covers model-dirty and external conflict, and nothing else', () => {
    expect(hasUnsavedChanges(makeFileState({ isDirty: false }))).toBe(false);
    expect(hasUnsavedChanges(makeFileState({ isDirty: true }))).toBe(true);
    expect(hasUnsavedChanges(makeFileState({ externalConflict: { detectedAt: 'now' } }))).toBe(true);
    // A file that merely differs from its on-disk snapshot is not unsaved —
    // there is no source buffer any more.
    expect(hasUnsavedChanges(makeFileState({ isDirty: false, originalCode: 'a' }))).toBe(false);
  });
});

describe('source-editing state machine is removed (F2)', () => {
  test('the source-editing components are gone', () => {
    expect(fs.existsSync(path.join(RENDERER_DIR, 'components', 'SourceCodeEditor.tsx'))).toBe(false);
    expect(fs.existsSync(path.join(RENDERER_DIR, 'components', 'SourceEditsPendingBanner.tsx'))).toBe(false);
  });

  test('fileStore exposes no source-buffer actions or predicate', () => {
    expect('isSourceDirty' in fileStoreModule).toBe(false);
    const store = useEditorStore.getState() as Record<string, unknown>;
    expect(store.setWorkingCode).toBeUndefined();
    expect(store.adoptWorkingCode).toBeUndefined();
    expect(store.saveSource).toBeUndefined();
  });

  test('fileStore carries no source-buffer state or mutation guard', () => {
    const source = fs.readFileSync(path.join(RENDERER_DIR, 'store', 'fileStore.ts'), 'utf8');
    expect(source).not.toContain('workingCode');
    expect(source).not.toContain('blockedBySourceEdit');
    expect(source).not.toContain('refuseMutationIfSourceDirty');
  });

  test('the dead source view is gone from the layout and the view union', () => {
    const layout = fs.readFileSync(path.join(RENDERER_DIR, 'components', 'MainLayout.tsx'), 'utf8');
    expect(layout).not.toContain('SourceCodeEditor');
    expect(layout).not.toContain('SourceEditsPendingBanner');
    const uiSelection = fs.readFileSync(path.join(RENDERER_DIR, 'store', 'uiSelectionStore.ts'), 'utf8');
    expect(uiSelection).not.toContain("'source'");
  });
});

describe('model mutation', () => {
  beforeEach(() => {
    useEditorStore.setState({ ...baseState, openFiles: new Map() });
  });

  test('always applies and marks the file dirty — nothing can refuse it', () => {
    const filePath = 'mutate.d';
    useEditorStore.setState({
      openFiles: new Map([[filePath, makeFileState({
        filePath,
        semanticModel: { dialogs: { D1: { properties: { npc: 'NPC1' } } }, functions: {}, hasErrors: false, errors: [] },
        originalCode: 'original source',
      })]]),
      activeFile: filePath,
    });

    useEditorStore.getState().updateDialog(filePath, 'D1', { properties: { npc: 'NPC2' } });

    const fileState = useEditorStore.getState().getFileState(filePath);
    expect(fileState?.semanticModel.dialogs.D1).toEqual({ properties: { npc: 'NPC2' } });
    expect(fileState?.isDirty).toBe(true);
  });
});
