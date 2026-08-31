import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import WorldSurface from '../src/renderer/components/world/WorldSurface';
import { useWorldStore } from '../src/renderer/store/worldStore';
import { useProjectStore } from '../src/renderer/store/projectStore';
import { SUMMARY, makeWorldEditorApi, vobIndex, waynetPayload } from './worldFixtures';

/**
 * The World bar's four-group structure (level-editor-ui-improvements.md
 * slice 5) — the toolbar restructure's own safety net beyond the 178-case
 * editing suite, which pins every testid and enablement rule surviving the
 * move to `toolbar/*.tsx` unchanged.
 */

jest.mock('react-virtualized-auto-sizer', () => (props: {
  children: (size: { height: number; width: number }) => React.ReactNode;
}) => props.children({ height: 600, width: 320 }));

jest.mock('../src/renderer/components/world/WorldViewport', () => {
  const ReactActual = jest.requireActual('react') as typeof React;
  return {
    __esModule: true,
    default: ReactActual.forwardRef((_props: unknown, ref: React.Ref<{
      raycastDown: () => null; frameVob: () => void; framePoint: () => void;
    }>) => {
      ReactActual.useImperativeHandle(ref, () => ({
        raycastDown: () => null, frameVob: () => undefined, framePoint: () => undefined,
      }));
      return <div data-testid="world-viewport-stub" />;
    }),
  };
});

const api = makeWorldEditorApi();

async function openWorld() {
  const summary = { ...SUMMARY, vobIndex: vobIndex([[0, 0, 0], [10, 20, 30]]) };
  api.openWorldDialog.mockResolvedValueOnce('C:/Gothic/NewWorld.zen' as never);
  api.openWorld.mockResolvedValueOnce(summary as never);
  api.getWorldMesh.mockResolvedValueOnce({ groups: [], bbox: summary.bbox } as never);
  api.getWorldVisuals.mockResolvedValueOnce({ visuals: [], stats: { vobsPlaced: 0 } } as never);
  render(<WorldSurface />);
  fireEvent.click(screen.getByTestId('world-open'));
  await screen.findByTestId('world-viewport-stub');
  return summary;
}

beforeEach(() => {
  jest.clearAllMocks();
  api.getWorldWaynet.mockResolvedValue(waynetPayload() as never);
  api.getWorldHistoryDepth.mockResolvedValue({ undo: 0, redo: 0 } as never);
  (window as unknown as { editorAPI: typeof api }).editorAPI = api;
});

afterEach(() => {
  useWorldStore.getState().reset();
  useProjectStore.getState().closeProject();
});

describe('the World bar', () => {
  it('has the four group containers before a world is even open', () => {
    render(<WorldSurface />);

    expect(screen.getByTestId('world-toolbar-file')).toBeInTheDocument();
    expect(screen.getByTestId('world-toolbar-overlays')).toBeInTheDocument();
    expect(screen.getByTestId('world-toolbar-edit')).toBeInTheDocument();
    expect(screen.getByTestId('world-toolbar-stats')).toBeInTheDocument();
  });

  it('puts the file controls in the file group', () => {
    render(<WorldSurface />);

    const fileGroup = screen.getByTestId('world-toolbar-file');
    expect(fileGroup).toContainElement(screen.getByTestId('world-choose-install'));
    expect(fileGroup).toContainElement(screen.getByTestId('world-open'));
  });

  it('puts the edit controls in the edit group once a world is open', async () => {
    await openWorld();

    const editGroup = screen.getByTestId('world-toolbar-edit');
    expect(editGroup).toContainElement(screen.getByTestId('world-gizmo-translate'));
    expect(editGroup).toContainElement(screen.getByTestId('world-undo'));
    expect(editGroup).toContainElement(screen.getByTestId('world-delete-vob'));
  });

  it('puts the overlay controls in the overlays group once a world is open', async () => {
    await openWorld();

    const overlayGroup = screen.getByTestId('world-toolbar-overlays');
    expect(overlayGroup).toContainElement(screen.getByTestId('world-waynet-toggle'));
    expect(overlayGroup).toContainElement(screen.getByTestId('world-exposure'));
  });

  it('puts the stat chips in the stats group once a world is open', async () => {
    await openWorld();

    const statsGroup = screen.getByTestId('world-toolbar-stats');
    expect(statsGroup).toHaveTextContent('VOBs');
  });

  it('does not wrap, and scrolls horizontally instead', () => {
    render(<WorldSurface />);

    const bar = screen.getByTestId('world-toolbar-file').parentElement;
    expect(bar).toHaveStyle({ flexWrap: 'nowrap', overflowX: 'auto' });
  });

  it('gives every icon-only action an accessible name, reachable by a tooltip', async () => {
    await openWorld();

    for (const [testId, name] of [
      ['world-undo', 'Undo'], ['world-redo', 'Redo'],
      ['world-drop-to-ground', 'Drop to ground'], ['world-align-to-normal', 'Align to normal'],
      ['world-duplicate-vob', 'Duplicate VOB'], ['world-delete-vob', 'Delete VOB'],
    ] as const) {
      expect(screen.getByTestId(testId)).toHaveAccessibleName(name);
    }

    fireEvent.mouseOver(screen.getByTestId('world-undo'));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Undo (Ctrl+Z)');
  });

  it('keeps the gizmo ToggleButtonGroup working with each button wrapped in its own Tooltip', async () => {
    // The MUI gotcha this pins: ToggleButtonGroup clones its *direct*
    // children to inject value/selected/onChange, and a Tooltip wrapping a
    // ToggleButton (rather than the reverse) is what keeps that plumbing
    // intact — get the nesting backwards and the group stops driving the
    // buttons' selected state.
    await openWorld();

    const translate = screen.getByTestId('world-gizmo-translate');
    const rotate = screen.getByTestId('world-gizmo-rotate');
    expect(translate).toHaveAttribute('aria-pressed', 'true');
    expect(rotate).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(rotate);

    expect(translate).toHaveAttribute('aria-pressed', 'false');
    expect(rotate).toHaveAttribute('aria-pressed', 'true');

    fireEvent.mouseOver(rotate);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Turn (E)');
  });
});
