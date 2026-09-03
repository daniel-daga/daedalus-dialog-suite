import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import WorldSurface from '../src/renderer/components/world/WorldSurface';
import { useWorldStore } from '../src/renderer/store/worldStore';
import { useProjectStore } from '../src/renderer/store/projectStore';
import { SUMMARY, makeWorldEditorApi, vobIndex, waynetPayload } from './worldFixtures';

/**
 * The World bar's four-group structure (level-editor.md §17) — the toolbar restructure's own safety net beyond the 178-case
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
    // The install chooser left with §16.28 — sources are the project file's.
    expect(fileGroup).toContainElement(screen.getByTestId('world-open'));
    expect(fileGroup).toContainElement(screen.getByTestId('world-save'));
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

  it('wraps between groups on a narrow window, and justifies each row', () => {
    render(<WorldSurface />);

    const bar = screen.getByTestId('world-toolbar-file').parentElement;
    expect(bar).toHaveStyle({ flexWrap: 'wrap', justifyContent: 'space-between' });
  });

  it('shows every control before a world is open, disabled rather than absent', () => {
    // A control that pops in and out at open/close shifts every group after
    // it in the row — disabled, always mounted, is what keeps the layout
    // stable across the transition.
    render(<WorldSurface />);

    for (const testId of [
      'world-save', 'world-waynet-toggle', 'world-spawns-toggle',
      'world-gizmo-translate', 'world-gizmo-rotate',
      'world-drop-to-ground', 'world-align-to-normal', 'world-duplicate-vob',
      'world-delete-vob', 'world-undo', 'world-redo',
    ]) {
      expect(screen.getByTestId(testId)).toBeInTheDocument();
      expect(screen.getByTestId(testId)).toBeDisabled();
    }
    // The Slider's root is a `<span>`, not a native form element —
    // `toBeDisabled` finds nothing there. MUI does apply `Mui-disabled` to
    // it, so check that instead.
    expect(screen.getByTestId('world-exposure')).toHaveClass('Mui-disabled');
    // Each select `TextField`'s `data-testid` lands on the outer
    // `MuiFormControl-root` div, not on the interactive `role="combobox"`
    // MUI actually marks `aria-disabled` on — reach that instead.
    for (const testId of ['world-hidden-classes', 'world-snap']) {
      expect(within(screen.getByTestId(testId)).getByRole('combobox'))
        .toHaveAttribute('aria-disabled', 'true');
    }
  });

  it('enables the always-visible controls once a world is open', async () => {
    await openWorld();

    expect(screen.getByTestId('world-save')).toBeEnabled();
    expect(screen.getByTestId('world-waynet-toggle')).toBeEnabled();
    expect(screen.getByTestId('world-spawns-toggle')).toBeEnabled();
    expect(screen.getByTestId('world-exposure')).not.toHaveClass('Mui-disabled');
    expect(screen.getByTestId('world-gizmo-translate')).toBeEnabled();
    for (const testId of ['world-hidden-classes', 'world-snap']) {
      expect(within(screen.getByTestId(testId)).getByRole('combobox'))
        .not.toHaveAttribute('aria-disabled', 'true');
    }
  });

  it('shows placeholder stat chips before a world is open, never a bare zero', () => {
    render(<WorldSurface />);

    const statsGroup = screen.getByTestId('world-toolbar-stats');
    expect(statsGroup).toHaveTextContent('—');
    expect(statsGroup).not.toHaveTextContent('0 VOBs');
  });

  it('never breaks a group across two rows', () => {
    // Each group is one atomic flex item — flexShrink: 0 is what keeps the
    // wrap point between groups rather than inside one.
    render(<WorldSurface />);

    for (const testId of ['world-toolbar-file', 'world-toolbar-overlays', 'world-toolbar-edit', 'world-toolbar-stats']) {
      expect(screen.getByTestId(testId)).toHaveStyle({ flexShrink: '0', flexWrap: 'nowrap' });
    }
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
