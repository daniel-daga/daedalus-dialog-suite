import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import WorldSurface from '../src/renderer/components/world/WorldSurface';
import { useWorldStore } from '../src/renderer/store/worldStore';
import { useProjectStore } from '../src/renderer/store/projectStore';
import { SUMMARY, makeWorldEditorApi, vobIndex, waynetPayload } from './worldFixtures';

/**
 * The World bar's four-group structure (level-editor.md §17) — file, add,
 * edit, view — and the status bar the counts moved to. The safety net beyond
 * the 178-case editing suite, which pins every testid and enablement rule.
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
  // Open world lists the project's worlds (level-editor.md §16.31); these
  // suites want a named file, which is what Browse… still is.
  fireEvent.click(await screen.findByTestId('world-picker-browse'));
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
    expect(screen.getByTestId('world-toolbar-add')).toBeInTheDocument();
    expect(screen.getByTestId('world-toolbar-edit')).toBeInTheDocument();
    expect(screen.getByTestId('world-toolbar-view')).toBeInTheDocument();
    expect(screen.queryByTestId('world-toolbar-stats')).toBeNull();
  });

  it('puts the three add actions in the add group, disabled until a world is open', async () => {
    render(<WorldSurface />);

    const addGroup = screen.getByTestId('world-toolbar-add');
    for (const testId of ['world-add-vob', 'world-add-npc', 'world-add-waypoint-toolbar']) {
      expect(addGroup).toContainElement(screen.getByTestId(testId));
      expect(screen.getByTestId(testId)).toBeDisabled();
    }
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

  it('puts the view controls in the view group once a world is open', async () => {
    await openWorld();

    const viewGroup = screen.getByTestId('world-toolbar-view');
    expect(viewGroup).toContainElement(screen.getByTestId('world-waynet-toggle'));
    expect(viewGroup).toContainElement(screen.getByTestId('world-exposure'));
  });

  it('keeps Time and Names in the bar with their layer off — disabled, and saying why', async () => {
    // Both used to mount only once their layer was on, so the row grew and
    // shifted when a layer was toggled, and nothing said the control existed.
    await openWorld();

    expect(screen.getByTestId('world-time-toggle')).toBeDisabled();
    expect(screen.getByTestId('world-names-toggle')).toBeDisabled();
    fireEvent.mouseOver(screen.getByTestId('world-time-toggle'));
    expect(await screen.findByRole('tooltip')).toHaveTextContent(/Spawns/);

    fireEvent.click(screen.getByTestId('world-spawns-toggle'));
    expect(screen.getByTestId('world-time-toggle')).toBeEnabled();
    expect(screen.getByTestId('world-names-toggle')).toBeEnabled();
  });

  it('cycles the VOB outlines through all, selected and off', async () => {
    // #229: Florian asked to see a scene without the white frames, and
    // separately proposed the line as a selection mark only. Both are modes
    // rather than a swap, so the default reading is unchanged and the orange
    // body tint still marks the selection in every one of them.
    await openWorld();

    const button = screen.getByTestId('world-outlines-toggle');
    expect(button).toHaveAccessibleName('Outlines: All');

    fireEvent.click(button);
    expect(button).toHaveAccessibleName('Outlines: Selected');

    fireEvent.click(button);
    expect(button).toHaveAccessibleName('Outlines: Off');

    fireEvent.click(button);
    expect(button).toHaveAccessibleName('Outlines: All');
  });

  it('keeps the outline control in the view group, beside the other view toggles', async () => {
    await openWorld();

    expect(screen.getByTestId('world-toolbar-view'))
      .toContainElement(screen.getByTestId('world-outlines-toggle'));
  });

  it('puts the counts in the status bar once a world is open, not in the toolbar', async () => {
    await openWorld();

    const stats = screen.getByTestId('world-status-stats');
    expect(screen.getByTestId('world-status-bar')).toContainElement(stats);
    expect(stats).toHaveTextContent('2 VOBs');
    expect(stats).toHaveTextContent('1 triangles');
    expect(screen.getByTestId('world-toolbar-file').parentElement).not.toContainElement(stats);
  });

  it('packs the groups from the left and pins the view group to the right', () => {
    // `space-between` was what made controls jump: every group moved whenever
    // one of them changed width. Left-packed, only the view group's own
    // slack moves when a slider appears inside it.
    render(<WorldSurface />);

    const bar = screen.getByTestId('world-toolbar-file').parentElement;
    expect(bar).toHaveStyle({ flexWrap: 'wrap' });
    expect(bar).not.toHaveStyle({ justifyContent: 'space-between' });
    expect(screen.getByTestId('world-toolbar-view')).toHaveStyle({ marginLeft: 'auto' });
  });

  it('shows every control before a world is open, disabled rather than absent', () => {
    // A control that pops in and out at open/close shifts every group after
    // it in the row — disabled, always mounted, is what keeps the layout
    // stable across the transition.
    render(<WorldSurface />);

    for (const testId of [
      'world-save', 'world-waynet-toggle', 'world-spawns-toggle', 'world-outlines-toggle',
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
    expect(screen.getByTestId('world-outlines-toggle')).toBeEnabled();
    expect(screen.getByTestId('world-exposure')).not.toHaveClass('Mui-disabled');
    expect(screen.getByTestId('world-gizmo-translate')).toBeEnabled();
    for (const testId of ['world-hidden-classes', 'world-snap']) {
      expect(within(screen.getByTestId(testId)).getByRole('combobox'))
        .not.toHaveAttribute('aria-disabled', 'true');
    }
  });

  it('never breaks a group across two rows', () => {
    // Each group is one atomic flex item — flexShrink: 0 is what keeps the
    // wrap point between groups rather than inside one.
    render(<WorldSurface />);

    for (const testId of ['world-toolbar-file', 'world-toolbar-add', 'world-toolbar-edit', 'world-toolbar-view']) {
      expect(screen.getByTestId(testId)).toHaveStyle({ flexShrink: '0', flexWrap: 'nowrap' });
    }
  });

  it('gives every icon-only action an accessible name, reachable by a tooltip', async () => {
    await openWorld();

    for (const [testId, name] of [
      ['world-undo', 'Undo'], ['world-redo', 'Redo'],
      ['world-drop-to-ground', 'Drop to ground'], ['world-align-to-normal', 'Align to normal'],
      ['world-duplicate-vob', 'Duplicate VOB'], ['world-delete-vob', 'Delete VOB'],
      ['world-save', 'Save world'], ['world-gmbt-test', 'Quick test'],
      ['world-waynet-toggle', 'Waynet'], ['world-spawns-toggle', 'Spawns'],
      ['world-gizmo-translate', 'Move'], ['world-gizmo-rotate', 'Turn'],
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
