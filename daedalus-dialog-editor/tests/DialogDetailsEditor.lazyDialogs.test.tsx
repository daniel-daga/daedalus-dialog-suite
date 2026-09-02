/**
 * The Review Changes and Play dialog modals load lazily (§3 P3).
 *
 * `DialogSourceViewDialog` already sits behind `React.lazy` so Monaco stays out
 * of the entry chunk; `ReviewChangesDialog` (diff view) and `SimulatorDialog`
 * (the whole simulator domain) are the two remaining modals that a session may
 * never open, and they should cost nothing until their button is pressed.
 *
 * The module factories below flip a flag when Jest first evaluates them — a
 * static import flips both at load; a lazy import flips each on first render.
 * The flags live on `globalThis`: a static import evaluates the factory while
 * this file's own top-level bindings are still in their temporal dead zone.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import DialogDetailsEditor from '../src/renderer/components/DialogDetailsEditor';
import { useEditorStore } from '../src/renderer/store/editorStore';

type Loaded = { review?: boolean; simulator?: boolean };
const loaded = (): Loaded => ((globalThis as any).__ddeLazyLoaded ??= {});

jest.mock('../src/renderer/components/ReviewChangesDialog', () => {
  ((globalThis as any).__ddeLazyLoaded ??= {}).review = true;
  const ReactLib = jest.requireActual<typeof import('react')>('react');
  return {
    __esModule: true,
    default: () => ReactLib.createElement('div', { 'data-testid': 'review-changes-dialog' }),
  };
});

jest.mock('../src/renderer/components/Simulator/SimulatorDialog', () => {
  ((globalThis as any).__ddeLazyLoaded ??= {}).simulator = true;
  const ReactLib = jest.requireActual<typeof import('react')>('react');
  return {
    __esModule: true,
    default: () => ReactLib.createElement('div', { 'data-testid': 'simulator-dialog' }),
  };
});

const FILE = '/test/Dialog.d';
const DIALOG_NAME = 'TestDialog';

const semanticModel = {
  dialogs: {
    [DIALOG_NAME]: {
      properties: { npc: 'NPC1', information: 'TestInfo' },
    },
  },
  functions: {
    TestInfo: { name: 'TestInfo', returnType: 'VOID', actions: [], conditions: [], calls: [] },
  },
  constants: {},
  variables: {},
  instances: {},
  hasErrors: false,
  errors: [],
} as any;

describe('DialogDetailsEditor — lazy modal boundaries', () => {
  beforeEach(() => {
    useEditorStore.setState({
      openFiles: new Map([[FILE, {
        filePath: FILE,
        semanticModel,
        isDirty: false,
        lastSaved: new Date(),
        originalCode: '',
        hasErrors: false,
        errors: [],
      }]]),
      activeFile: FILE,
    } as any);
  });

  it('loads ReviewChangesDialog and SimulatorDialog only when each is opened', async () => {
    render(<DialogDetailsEditor dialogName={DIALOG_NAME} filePath={FILE} semanticModel={semanticModel} />);

    // Neither module has been evaluated by rendering the editor itself.
    expect(loaded().review).toBeUndefined();
    expect(loaded().simulator).toBeUndefined();

    fireEvent.click(screen.getByTestId('review-changes-button'));
    await screen.findByTestId('review-changes-dialog');
    expect(loaded().review).toBe(true);
    expect(loaded().simulator).toBeUndefined();

    fireEvent.click(screen.getByTestId('simulator-launch'));
    await screen.findByTestId('simulator-dialog');
    expect(loaded().simulator).toBe(true);
  });
});
