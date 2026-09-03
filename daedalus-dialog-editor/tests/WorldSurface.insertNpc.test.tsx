import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { useWorldStore } from '../src/renderer/store/worldStore';
import { useProjectStore } from '../src/renderer/store/projectStore';
import { useFileStore, type FileState } from '../src/renderer/store/fileStore';
import type { SemanticModel } from '../src/shared/types';
import { SUMMARY, makeWorldEditorApi, vobIndex, waynetPayload } from './worldFixtures';
import * as mockWorldViewport from './worldViewportMocks';
import WorldSurface from '../src/renderer/components/world/WorldSurface';

/**
 * "Insert NPC here…" (level-editor.md §16.19, slice 16 D and E): the first
 * time the World surface authors into a script it is not editing. The
 * waypoint op goes first and the `script:appendInsertNpc` IPC second — a
 * spawn onto a point that does not exist is the worse half-state — and every
 * refusal slice A and C typed reaches the edit banner. E is the renderer's
 * half of coherence: a `Startup.d` open and dirty in the dialog editor
 * refuses the write, one open and clean is reloaded after it, and the spawn
 * index gains the site without a reindex.
 *
 * Playwright cannot reach any of this: the browser harness has no world.
 */

jest.mock('three', () => mockWorldViewport.mockThree());
jest.mock('three/examples/jsm/controls/OrbitControls.js', () => mockWorldViewport.mockOrbitControls());

jest.mock('react-virtualized-auto-sizer', () => (props: {
  children: (size: { height: number; width: number }) => React.ReactNode;
}) => props.children({ height: 600, width: 320 }));

const TERRAIN: [number, number, number] = [1500.5, -220, 3300.25];

jest.mock('../src/renderer/components/world/WorldViewport', () => {
  const ReactActual = jest.requireActual('react') as typeof React;
  return {
    __esModule: true,
    default: ReactActual.forwardRef((props: {
      onPick: (vob: number | null, point: [number, number, number] | null, additive: boolean) => void;
      onSelectWaypoint: (waypoint: number | null) => void;
    }, ref: React.Ref<{
      raycastDown: () => null; frameVob: () => void; framePoint: () => void;
    }>) => {
      ReactActual.useImperativeHandle(ref, () => ({
        raycastDown: () => null, frameVob: () => undefined, framePoint: () => undefined,
      }));
      return (
        <div data-testid="world-viewport-stub">
          <button type="button" data-testid="stub-pick-terrain" onClick={() => props.onPick(null, TERRAIN, false)}>
            pick terrain
          </button>
          <button type="button" data-testid="stub-pick-waypoint" onClick={() => props.onSelectWaypoint(1)}>
            pick waypoint
          </button>
        </div>
      );
    }),
  };
});

const STARTUP_PATH = 'C:/Story/Startup.d';
const STARTUP_MODEL: SemanticModel = {
  dialogs: {},
  functions: {
    // Retail's spelling beside its `INIT_` twin, which must never be chosen.
    INIT_NewWorld: { name: 'INIT_NewWorld', actions: [] } as never,
    STARTUP_NewWorld: { name: 'STARTUP_NewWorld', actions: [] } as never,
  },
};

const api = {
  ...makeWorldEditorApi(),
  readFile: jest.fn(async (): Promise<string> => ''),
  parseSource: jest.fn(async (): Promise<SemanticModel> => STARTUP_MODEL),
};

const seedProject = (model: SemanticModel = STARTUP_MODEL) => {
  useProjectStore.setState({
    parsedFiles: new Map([[STARTUP_PATH, { filePath: STARTUP_PATH, semanticModel: model, lastParsed: new Date() }]]),
  } as never);
};

const openFileState = (isDirty: boolean): FileState => ({
  filePath: STARTUP_PATH, semanticModel: STARTUP_MODEL, isDirty, lastSaved: new Date(),
});

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
  await waitFor(() => expect(api.getWorldWaynet).toHaveBeenCalled());
  fireEvent.click(screen.getByTestId('world-waynet-toggle'));
  return summary;
}

/** Click the ground and open the Insert NPC dialog off the terrain bar. */
async function openInsertDialog() {
  fireEvent.click(screen.getByTestId('stub-pick-terrain'));
  act(() => useWorldStore.getState().selectVob(null));
  fireEvent.click(await screen.findByTestId('world-insert-npc'));
  await screen.findByTestId('world-insert-npc-dialog');
}

const instanceField = () =>
  within(screen.getByTestId('world-insert-npc-instance')).getByRole('combobox');
const waypointField = () => screen.getByTestId('world-insert-npc-waypoint') as HTMLInputElement;

async function confirmInsert(instance: string) {
  fireEvent.change(instanceField(), { target: { value: instance } });
  fireEvent.click(screen.getByTestId('world-insert-npc-confirm'));
}

const banner = () => screen.findByTestId('world-edit-error');

beforeEach(() => {
  jest.clearAllMocks();
  api.getWorldWaynet.mockResolvedValue(waynetPayload() as never);
  api.getWorldHistoryDepth.mockResolvedValue({ undo: 0, redo: 0 } as never);
  api.appendInsertNpc.mockResolvedValue({ ok: true, line: 7 } as never);
  (window as unknown as { editorAPI: typeof api }).editorAPI = api;
});

afterEach(() => {
  useWorldStore.getState().reset();
  useProjectStore.getState().closeProject();
  useFileStore.setState({ openFiles: new Map(), activeFile: null } as never);
});

describe('Insert NPC here…', () => {
  it('commits the waypoint first, then appends the spawn to STARTUP_<world>', async () => {
    // The order is the decision: a spawn naming a waypoint the world has not
    // got is the worse half-state, so the op lands before the script line.
    seedProject();
    const order: string[] = [];
    api.applyWorldOps.mockImplementation(async () => { order.push('ops'); });
    api.appendInsertNpc.mockImplementation(async () => {
      order.push('ipc');
      return { ok: true, line: 7 };
    });
    await openWorld();
    await openInsertDialog();

    // Prefilled the way "Add waypoint here…" prefills: the first free name.
    expect(waypointField().value).toBe('FP_NEW_3');
    await confirmInsert('PC_Thief');

    await waitFor(() => expect(api.appendInsertNpc).toHaveBeenCalledWith(
      STARTUP_PATH, 'STARTUP_NewWorld', 'PC_Thief', 'FP_NEW_3',
    ));
    expect(api.applyWorldOps).toHaveBeenCalledWith([{
      op: 'AddWaypoint', waypoint: 3, name: 'FP_NEW_3', from: null, to: TERRAIN,
    }]);
    expect(order).toEqual(['ops', 'ipc']);
  });

  it('pushes the new site into the spawn index, uppercased the way the index is', async () => {
    seedProject();
    await openWorld();
    await openInsertDialog();

    await confirmInsert('PC_Thief');

    await waitFor(() => expect(useProjectStore.getState().spawnSiteIndex).toEqual([{
      instance: 'PC_THIEF', spawnPoint: 'FP_NEW_3',
      filePath: STARTUP_PATH, functionName: 'STARTUP_NewWorld', line: 7,
    }]));
  });

  it('refreshes the cached model so STARTUP_<world> carries the new action without a reparse', async () => {
    // Slice A's model edit is the renderer's picture of what C wrote: after
    // the IPC, anything reading the function's actions out of parsedFiles
    // sees the spawn, and no read or parse round trip is spent on it.
    seedProject();
    await openWorld();
    await openInsertDialog();

    await confirmInsert('PC_Thief');

    await waitFor(() => expect(
      useProjectStore.getState().parsedFiles.get(STARTUP_PATH)?.semanticModel.functions.STARTUP_NewWorld.actions,
    ).toEqual([{ type: 'InsertNpcAction', npcInstance: 'PC_Thief', spawnPoint: 'FP_NEW_3' }]));
    expect(api.readFile).not.toHaveBeenCalled();
    expect(api.parseSource).not.toHaveBeenCalled();
    // The seed model itself is left alone.
    expect(STARTUP_MODEL.functions.STARTUP_NewWorld.actions).toEqual([]);
  });

  it('is dead without an instance, and for a waypoint name the world already has', async () => {
    seedProject();
    await openWorld();
    await openInsertDialog();

    expect(screen.getByTestId('world-insert-npc-confirm')).toBeDisabled();
    fireEvent.change(instanceField(), { target: { value: 'PC_Thief' } });
    expect(screen.getByTestId('world-insert-npc-confirm')).toBeEnabled();

    fireEvent.change(waypointField(), { target: { value: 'WP_MIDDLE' } });
    expect(screen.getByTestId('world-insert-npc-confirm')).toBeDisabled();
  });

  describe('refuses before anything is written', () => {
    it('with no script project open', async () => {
      await openWorld();
      await openInsertDialog();

      await confirmInsert('PC_Thief');

      expect(await banner()).toHaveTextContent(/no .*project/i);
      expect(api.applyWorldOps).not.toHaveBeenCalled();
      expect(api.appendInsertNpc).not.toHaveBeenCalled();
    });

    it('when no file declares STARTUP_<world>', async () => {
      seedProject({ dialogs: {}, functions: { INIT_NewWorld: { name: 'INIT_NewWorld', actions: [] } as never } });
      await openWorld();
      await openInsertDialog();

      await confirmInsert('PC_Thief');

      expect(await banner()).toHaveTextContent('STARTUP_NEWWORLD');
      expect(api.applyWorldOps).not.toHaveBeenCalled();
      expect(api.appendInsertNpc).not.toHaveBeenCalled();
    });

    it('when the holding file has parse errors', async () => {
      seedProject({ ...STARTUP_MODEL, hasErrors: true });
      await openWorld();
      await openInsertDialog();

      await confirmInsert('PC_Thief');

      expect(await banner()).toHaveTextContent(/Startup\.d.*syntax errors/i);
      expect(api.applyWorldOps).not.toHaveBeenCalled();
      expect(api.appendInsertNpc).not.toHaveBeenCalled();
    });

    it('when the file is open in the dialog editor with unsaved changes', async () => {
      // E's decision: refuse, not merge. The mtime guard cannot see the
      // editor's stale model, so a dirty save afterwards would drop the spawn.
      seedProject();
      useFileStore.setState({ openFiles: new Map([[STARTUP_PATH, openFileState(true)]]) } as never);
      await openWorld();
      await openInsertDialog();

      await confirmInsert('PC_Thief');

      expect(await banner()).toHaveTextContent(/Startup\.d.*unsaved/i);
      expect(api.applyWorldOps).not.toHaveBeenCalled();
      expect(api.appendInsertNpc).not.toHaveBeenCalled();
    });
  });

  it('does not touch the script when the waypoint op is refused', async () => {
    seedProject();
    api.applyWorldOps.mockRejectedValueOnce(new Error('waypoint FP_NEW_3 refused'));
    await openWorld();
    await openInsertDialog();

    await confirmInsert('PC_Thief');

    expect(await banner()).toHaveTextContent('FP_NEW_3');
    expect(api.appendInsertNpc).not.toHaveBeenCalled();
  });

  it('says the waypoint stands when the script write is refused after it', async () => {
    seedProject();
    api.appendInsertNpc.mockResolvedValueOnce({ ok: false, reason: { kind: 'external-modification' } } as never);
    await openWorld();
    await openInsertDialog();

    await confirmInsert('PC_Thief');

    const shown = await banner();
    expect(shown).toHaveTextContent(/waypoint .*was added/i);
    expect(shown).toHaveTextContent(/changed on disk/i);
    expect(useProjectStore.getState().spawnSiteIndex).toEqual([]);
  });

  it('reloads a file the dialog editor holds open and clean, after the write', async () => {
    seedProject();
    const source = 'func void STARTUP_NewWorld() { Wld_InsertNpc (PC_Thief, "FP_NEW_3"); };';
    const reparsed: SemanticModel = { ...STARTUP_MODEL, constants: {} };
    api.readFile.mockResolvedValueOnce(source);
    api.parseSource.mockResolvedValueOnce(reparsed);
    useFileStore.setState({ openFiles: new Map([[STARTUP_PATH, openFileState(false)]]) } as never);
    await openWorld();
    await openInsertDialog();

    await confirmInsert('PC_Thief');

    await waitFor(() => expect(api.readFile).toHaveBeenCalledWith(STARTUP_PATH));
    // The slot is reused, the way an external change reloads it: the model is
    // the reparse (ids assigned, so not the same object), the source is what
    // was read, and the file is clean.
    await waitFor(() => expect(useFileStore.getState().openFiles.get(STARTUP_PATH)).toMatchObject({
      originalCode: source, isDirty: false, semanticModel: { constants: {} },
    }));
    expect(api.readFile.mock.invocationCallOrder[0]).toBeGreaterThan(api.appendInsertNpc.mock.invocationCallOrder[0]);
  });

  describe('instance existence is a warning, never a refusal', () => {
    // An empty index means "nothing is known", not "nothing is legal"; and an
    // instance declared in a file the index has not parsed is legal too.
    const warning = () => screen.queryByTestId('world-insert-npc-instance-warning');

    it('warns when the project index knows NPCs and the typed one is not among them, and still inserts', async () => {
      seedProject();
      useProjectStore.setState({ npcList: ['Diego', 'PC_Hero'] } as never);
      await openWorld();
      await openInsertDialog();

      fireEvent.change(instanceField(), { target: { value: 'PC_Thief' } });
      expect(warning()).toHaveTextContent('PC_Thief is not an NPC instance this project declares');
      expect(screen.getByTestId('world-insert-npc-confirm')).toBeEnabled();

      fireEvent.click(screen.getByTestId('world-insert-npc-confirm'));
      await waitFor(() => expect(api.appendInsertNpc).toHaveBeenCalledWith(
        STARTUP_PATH, 'STARTUP_NewWorld', 'PC_Thief', 'FP_NEW_3',
      ));
    });

    it('matches the index case-insensitively, the way Daedalus does', async () => {
      seedProject();
      useProjectStore.setState({ npcList: ['Diego', 'PC_Hero'] } as never);
      await openWorld();
      await openInsertDialog();

      fireEvent.change(instanceField(), { target: { value: 'pc_hero' } });
      expect(warning()).toBeNull();
    });

    it('says nothing when the index knows no NPCs', async () => {
      seedProject();
      await openWorld();
      await openInsertDialog();

      fireEvent.change(instanceField(), { target: { value: 'PC_Thief' } });
      expect(warning()).toBeNull();
    });
  });

  describe('a spawn the index already holds is a warning that wants an explicit confirm', () => {
    // Retail spawns the same NPC on a point more than once (chapter re-entry),
    // so this is not a refusal — the button just stops reading "Insert".
    const warning = () => screen.queryByTestId('world-insert-npc-duplicate-warning');
    const existingSite = {
      instance: 'PC_THIEF', spawnPoint: 'WP_MIDDLE',
      filePath: STARTUP_PATH, functionName: 'STARTUP_NewWorld', line: 12,
    };

    it('names the site, matches the index case-insensitively, and inserts anyway on confirm', async () => {
      seedProject();
      useProjectStore.setState({ spawnSiteIndex: [existingSite] } as never);
      await openWorld();
      fireEvent.click(screen.getByTestId('stub-pick-waypoint'));
      await screen.findByTestId('world-waypoint-panel');
      fireEvent.click(screen.getByTestId('world-waypoint-insert-npc'));
      await screen.findByTestId('world-insert-npc-dialog');

      fireEvent.change(instanceField(), { target: { value: 'pc_thief' } });
      expect(warning()).toHaveTextContent('PC_THIEF already spawns at WP_MIDDLE (Startup.d:12)');
      const confirm = screen.getByTestId('world-insert-npc-confirm');
      expect(confirm).toHaveTextContent('Insert anyway');
      expect(confirm).toBeEnabled();

      fireEvent.click(confirm);
      await waitFor(() => expect(api.appendInsertNpc).toHaveBeenCalledWith(
        STARTUP_PATH, 'STARTUP_NewWorld', 'pc_thief', 'WP_MIDDLE',
      ));
    });

    it('says nothing for a different instance on the same point', async () => {
      seedProject();
      useProjectStore.setState({ spawnSiteIndex: [existingSite] } as never);
      await openWorld();
      fireEvent.click(screen.getByTestId('stub-pick-waypoint'));
      await screen.findByTestId('world-waypoint-panel');
      fireEvent.click(screen.getByTestId('world-waypoint-insert-npc'));
      await screen.findByTestId('world-insert-npc-dialog');

      fireEvent.change(instanceField(), { target: { value: 'PC_Hero' } });
      expect(warning()).toBeNull();
      expect(screen.getByTestId('world-insert-npc-confirm')).toHaveTextContent(/^Insert$/);
    });
  });

  it('spawns at the selected waypoint from its panel, with no waypoint op', async () => {
    seedProject();
    await openWorld();
    fireEvent.click(screen.getByTestId('stub-pick-waypoint'));
    await screen.findByTestId('world-waypoint-panel');
    fireEvent.click(screen.getByTestId('world-waypoint-insert-npc'));
    await screen.findByTestId('world-insert-npc-dialog');

    expect(waypointField().value).toBe('WP_MIDDLE');
    expect(waypointField()).toBeDisabled();
    await confirmInsert('PC_Thief');

    await waitFor(() => expect(api.appendInsertNpc).toHaveBeenCalledWith(
      STARTUP_PATH, 'STARTUP_NewWorld', 'PC_Thief', 'WP_MIDDLE',
    ));
    expect(api.applyWorldOps).not.toHaveBeenCalled();
  });
});
