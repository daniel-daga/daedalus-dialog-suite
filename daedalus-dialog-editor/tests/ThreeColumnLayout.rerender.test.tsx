/**
 * §3 P1: ThreeColumnLayout must not subscribe to the whole `openFiles` Map and
 * is memo-wrapped.
 *
 * Every edit flush gives `openFiles` a fresh Map identity in the immer
 * fileStore; the layout only ever reads its OWN file's entry in render, so a
 * change to a different open file must not re-render it — and a parent
 * re-render with the same `filePath` prop must be absorbed by React.memo.
 *
 * The probe is the (stubbed) always-rendered EditorColumn child: any
 * ThreeColumnLayout render re-renders the stub, so its render count IS the
 * layout's render count.
 */
import React from 'react';
import { describe, test, expect, beforeEach } from '@jest/globals';
import { render, act, fireEvent, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import ThreeColumnLayout from '../src/renderer/components/ThreeColumnLayout';
import { useProjectStore } from '../src/renderer/store/projectStore';
import { useUISelectionStore } from '../src/renderer/store/uiSelectionStore';
import { useFileStore, type FileState } from '../src/renderer/store/fileStore';

jest.mock('../src/renderer/components/NpcColumn', () => () => null);
jest.mock('../src/renderer/components/DialogTreeColumn', () => () => null);
let mockEditorColumnRenders = 0;
jest.mock('../src/renderer/components/EditorColumn', () => {
  const ReactActual = jest.requireActual<typeof React>('react');
  return {
    __esModule: true,
    default: ReactActual.forwardRef(() => {
      mockEditorColumnRenders += 1;
      return null;
    }),
  };
});
jest.mock('../src/renderer/components/SearchPanel', () => () => null);
jest.mock('../src/renderer/components/SyntaxErrorsDisplay', () => () => null);
jest.mock('../src/renderer/components/DeleteDialogConfirmDialog', () => () => null);
jest.mock('../src/renderer/components/RenameDialogConfirmDialog', () => () => null);

const emptyModel = {
  dialogs: {},
  functions: {},
  hasErrors: false,
  errors: [],
};

const makeFileState = (filePath: string): FileState => ({
  filePath,
  semanticModel: { ...emptyModel } as never,
  isDirty: false,
  lastSaved: new Date(),
});

const OWN = '/proj/DIA_Own.d';
const OTHER = '/proj/DIA_Other.d';

describe('ThreeColumnLayout - §3 P1 per-file subscription + memo', () => {
  beforeEach(() => {
    mockEditorColumnRenders = 0;
    // Single-file mode: the layout renders its full body from the file's model.
    useProjectStore.setState({
      projectPath: null,
      npcList: [],
      dialogIndex: new Map(),
      allDialogFiles: [],
      mergedSemanticModel: { ...emptyModel, constants: {}, variables: {}, instances: {} },
    } as never);
    useUISelectionStore.setState({
      selectedNPC: null,
      selectedDialog: null,
      selectedFunctionName: null,
    } as never);
    useFileStore.setState({
      openFiles: new Map([
        [OWN, makeFileState(OWN)],
        [OTHER, makeFileState(OTHER)],
      ]),
      activeFile: OWN,
    } as never);
  });

  test('an edit flush on a different open file does not re-render; its own file does', () => {
    render(<ThreeColumnLayout filePath={OWN} />);
    const afterMount = mockEditorColumnRenders;
    expect(afterMount).toBeGreaterThan(0);

    const mapBefore = useFileStore.getState().openFiles;
    act(() => {
      useFileStore.setState((s) => {
        s.openFiles.get(OTHER)!.isDirty = true;
      });
    });
    // Sanity: the Map identity really changed while OWN's entry is untouched.
    expect(useFileStore.getState().openFiles).not.toBe(mapBefore);
    expect(useFileStore.getState().openFiles.get(OWN)).toBe(mapBefore.get(OWN));

    expect(mockEditorColumnRenders).toBe(afterMount);

    // A change to the layout's own file still reaches the editor.
    act(() => {
      useFileStore.setState((s) => {
        s.openFiles.get(OWN)!.isDirty = true;
      });
    });
    expect(mockEditorColumnRenders).toBeGreaterThan(afterMount);
  });

  test('a parent re-render with the same filePath prop is absorbed by memo', () => {
    const Parent: React.FC = () => {
      const [, bump] = React.useState(0);
      return (
        <>
          <button data-testid="bump" onClick={() => bump((n) => n + 1)} />
          <ThreeColumnLayout filePath={OWN} />
        </>
      );
    };

    render(<Parent />);
    const beforeBump = mockEditorColumnRenders;

    fireEvent.click(screen.getByTestId('bump'));
    expect(mockEditorColumnRenders).toBe(beforeBump);
  });
});
