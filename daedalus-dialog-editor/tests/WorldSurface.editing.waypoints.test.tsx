// First: the mock factories below read it, and the imports after it load them.
import * as mockViewportStub from './worldSurfaceViewportStub';
import { describe, it, expect } from '@jest/globals';
import { screen, fireEvent, waitFor, act } from '@testing-library/react';
import { useWorldStore } from '../src/renderer/store/worldStore';
import { useProjectStore } from '../src/renderer/store/projectStore';
import { type WaynetPayload } from '../src/shared/worldTypes';
import { WAYPOINT_MOVE, WAYPOINT_TO, WAYPOINT_WAS, waynetPayload } from './worldFixtures';
import { TERRAIN, vp } from './worldSurfaceViewportStub';
import { api, openWorld } from './worldSurfaceEditingHarness';

/**
 * The World surface's half of an edit — waypoints. Fixtures, the
 * viewport stub and `openWorld` are in `worldSurfaceEditingHarness.tsx`.
 */

jest.mock('react-virtualized-auto-sizer', () => mockViewportStub.autoSizerStub);
jest.mock('../src/renderer/components/world/WorldViewport', () => mockViewportStub.viewportStubModule());

describe('a waypoint dragged in the viewport', () => {
  /**
   * Open a world with a known waynet payload, then turn the overlay on.
   *
   * The payload is queued *before* the open, which is where it is read: the
   * waynet's names are the Problems scan's world input, so they are fetched
   * with the mesh and the visuals rather than when the overlay first asks.
   * The toggle still matters — a waypoint cannot be picked until something
   * draws one, and the overlay is off until asked for.
   */
  async function openWithWaynet(): Promise<WaynetPayload> {
    const payload = waynetPayload();
    api.getWorldWaynet.mockResolvedValueOnce(payload as never);
    await openWorld();
    await waitFor(() => expect(api.getWorldWaynet).toHaveBeenCalled());

    fireEvent.click(screen.getByTestId('world-waynet-toggle'));
    return payload;
  }

  it('becomes a MoveWaypoint carrying where it was, and reaches the main process', async () => {
    // The name rides along with the index because a stale index always resolves
    // to *some* waypoint and moves it, where a stale path resolves to nothing.
    // One string compare is the only guard the address admits.
    await openWithWaynet();

    fireEvent.click(screen.getByTestId('stub-drag-waypoint'));

    await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalledWith([WAYPOINT_MOVE]));
  });

  it('writes the committed move into the payload the overlay draws', async () => {
    // The overlay's position attribute is a view over this very buffer, so this
    // is what makes the moved waypoint — and every edge into it — stay where it
    // was put. Nothing else writes it: the VOB projection has no row for a
    // waypoint and refuses the op by name.
    const payload = await openWithWaynet();

    fireEvent.click(screen.getByTestId('stub-drag-waypoint'));

    await waitFor(() => expect(Array.from(new Float32Array(payload.positions).slice(3, 6)))
      .toEqual(WAYPOINT_TO));
  });

  it('does not touch the payload until the main process has taken the op', async () => {
    const payload = await openWithWaynet();
    let take = (): void => undefined;
    api.applyWorldOps.mockImplementationOnce(() => new Promise<undefined>((resolve) => {
      take = () => resolve(undefined);
    }));

    fireEvent.click(screen.getByTestId('stub-drag-waypoint'));
    await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalled());
    expect(Array.from(new Float32Array(payload.positions).slice(3, 6))).toEqual(WAYPOINT_WAS);

    take();
    await waitFor(() => expect(Array.from(new Float32Array(payload.positions).slice(3, 6)))
      .toEqual(WAYPOINT_TO));
  });

  it('puts the waypoint back when the op is refused, and says so', async () => {
    // The viewport has already drawn the drag into the payload. Left alone the
    // waypoint sits where the world does not have it, and it is the *file* that
    // would disagree — a waypoint has no property grid to notice it.
    const payload = await openWithWaynet();
    api.applyWorldOps.mockRejectedValueOnce(new Error('waypoint 1 is not WP_MIDDLE'));

    fireEvent.click(screen.getByTestId('stub-drag-waypoint'));

    await waitFor(() => expect(vp.appliedOps)
      .toEqual([{ ...WAYPOINT_MOVE, from: WAYPOINT_TO, to: WAYPOINT_WAS }]));
    expect(Array.from(new Float32Array(payload.positions).slice(3, 6))).toEqual(WAYPOINT_WAS);
    expect(await screen.findByTestId('world-edit-error')).toHaveTextContent('WP_MIDDLE');
  });

  it('is undone through the same path a VOB move is', async () => {
    // Undo does not go back through `commitOps` — the op log is in the main
    // process and it says what it undid. An undone waypoint move has to reach
    // the payload the same way the commit did, or the overlay keeps drawing the
    // move after the world has dropped it.
    const payload = await openWithWaynet();
    fireEvent.click(screen.getByTestId('stub-drag-waypoint'));
    await waitFor(() => expect(Array.from(new Float32Array(payload.positions).slice(3, 6)))
      .toEqual(WAYPOINT_TO));

    api.undoWorldEdit.mockResolvedValueOnce(
      [{ ...WAYPOINT_MOVE, from: WAYPOINT_TO, to: WAYPOINT_WAS }] as never,
    );
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });

    await waitFor(() => expect(Array.from(new Float32Array(payload.positions).slice(3, 6)))
      .toEqual(WAYPOINT_WAS));
  });

  it('does not ask for a fresh VOB index — a waypoint renumbers nothing', async () => {
    // A waynet op is not structural: it changes no enumeration, so the columnar
    // projection and the instanced scene are both still correct. Re-reading
    // either would cost what an open costs, and would re-frame the camera away
    // from the waypoint that was just dragged.
    await openWithWaynet();
    api.refreshWorldIndex.mockClear();
    api.getWorldVisuals.mockClear();

    fireEvent.click(screen.getByTestId('stub-drag-waypoint'));

    await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalled());
    expect(api.refreshWorldIndex).not.toHaveBeenCalled();
    expect(api.getWorldVisuals).not.toHaveBeenCalled();
  });

  it('lets go of the waypoint when the overlay is switched off', async () => {
    // The overlay is hidden, not destroyed, so nothing else would notice. A
    // gizmo left standing on a waypoint that is no longer drawn is a gizmo in
    // mid-air — and it is still draggable, which would commit a move to a
    // waypoint the user cannot see.
    await openWithWaynet();
    fireEvent.click(screen.getByTestId('stub-pick-waypoint'));
    await waitFor(() => expect(vp.selectedWaypoint).toBe(1));

    fireEvent.click(screen.getByTestId('world-waynet-toggle'));

    await waitFor(() => expect(vp.selectedWaypoint).toBeNull());
  });

  it('hands the picked waypoint back down, and lets go of the VOB selection', async () => {
    // One gizmo. The VOB selection standing behind a selected waypoint is what
    // would make the Delete VOB button act on something invisible.
    await openWithWaynet();
    expect(vp.selection).toEqual([1]);

    fireEvent.click(screen.getByTestId('stub-pick-waypoint'));

    await waitFor(() => expect(vp.selectedWaypoint).toBe(1));
    expect(vp.selection).toEqual([]);
  });

  it('shows the routines that name the selected waypoint, from the project-wide index', async () => {
    // §16.8 W2: the panel is the only UI a selected waypoint has, and the
    // index it reads is keyed uppercase — the routine's own case is kept.
    useProjectStore.setState({
      waypointSiteIndex: {
        WP_MIDDLE: [{ filePath: 'C:/Story/TA_Baker.d', functionName: 'TA_Baker_Day' }],
      },
    } as never);
    await openWithWaynet();

    fireEvent.click(screen.getByTestId('stub-pick-waypoint'));

    // The name is the rename field's value since W1, not text content.
    expect(await screen.findByDisplayValue('WP_MIDDLE')).toBeInTheDocument();
    expect(screen.getByTestId('world-waypoint-panel')).toHaveTextContent('TA_Baker_Day');
    expect(screen.getByTestId('world-waypoint-panel')).toHaveTextContent('TA_Baker.d');
  });

  it('says no routine names the waypoint when the index has none', async () => {
    await openWithWaynet();

    fireEvent.click(screen.getByTestId('stub-pick-waypoint'));

    expect(await screen.findByTestId('world-waypoint-panel')).toHaveTextContent(/no script in this project/i);
  });

  it('names the instances spawned at the selected waypoint', async () => {
    // §16.19 slice 3: without this the panel lists sites, so three NPCs
    // inserted at a point read exactly like a routine passing through.
    useProjectStore.setState({
      spawnSiteIndex: [
        {
          instance: 'GRD_200_XARDAS', spawnPoint: 'WP_MIDDLE',
          filePath: 'C:/Story/Startup.d', functionName: 'STARTUP_NEWWORLD', line: 12,
        },
        {
          instance: 'BAU_961_GAAN', spawnPoint: 'WP_MIDDLE',
          filePath: 'C:/Story/Startup.d', functionName: 'STARTUP_NEWWORLD', line: 13,
        },
        {
          instance: 'MIL_350_MARTIN', spawnPoint: 'WP_ELSEWHERE',
          filePath: 'C:/Story/Startup.d', functionName: 'STARTUP_NEWWORLD', line: 14,
        },
      ],
    } as never);
    await openWithWaynet();

    fireEvent.click(screen.getByTestId('stub-pick-waypoint'));

    const spawns = await screen.findByTestId('world-waypoint-spawns');
    expect(spawns).toHaveTextContent('GRD_200_XARDAS');
    expect(spawns).toHaveTextContent('BAU_961_GAAN');
    expect(spawns).not.toHaveTextContent('MIL_350_MARTIN');
  });

  it('does not also list a spawn as a routine passing through', async () => {
    // `extractWaypointSites` visits `Wld_InsertNpc` too, so the same call is in
    // both indexes: listed twice, the spawn section says nothing the site list
    // did not already say wrongly.
    useProjectStore.setState({
      waypointSiteIndex: {
        WP_MIDDLE: [
          { filePath: 'C:/Story/Startup.d', functionName: 'STARTUP_NEWWORLD' },
          { filePath: 'C:/Story/TA_Baker.d', functionName: 'TA_Baker_Day' },
        ],
      },
      spawnSiteIndex: [{
        instance: 'GRD_200_XARDAS', spawnPoint: 'WP_MIDDLE',
        filePath: 'C:/Story/Startup.d', functionName: 'STARTUP_NEWWORLD', line: 12,
      }],
    } as never);
    await openWithWaynet();

    fireEvent.click(screen.getByTestId('stub-pick-waypoint'));

    await screen.findByTestId('world-waypoint-panel');
    expect(screen.getByTestId('world-waypoint-spawns')).toHaveTextContent('STARTUP_NEWWORLD');
    expect(screen.getByTestId('world-waypoint-sites')).toHaveTextContent('TA_Baker_Day');
    expect(screen.getByTestId('world-waypoint-sites')).not.toHaveTextContent('STARTUP_NEWWORLD');
  });

  it('groups by NPC: a spawned NPC whose routine also stops here gets one row and one button', async () => {
    // Daniel 2026-10-07: the spawn and its own routine's stop were two rows
    // with two "Routines" buttons opening the same NPC. A stop of an NPC not
    // spawned here still gets its own row — but one per NPC, not per routine.
    useProjectStore.setState({
      waypointSiteIndex: {
        WP_MIDDLE: [
          { filePath: 'C:/Story/Startup.d', functionName: 'STARTUP_NEWWORLD' },
          { filePath: 'C:/Story/GRD_200_Xardas.d', functionName: 'Rtn_Start_200' },
          { filePath: 'C:/Story/BAU_900_Farim.d', functionName: 'Rtn_Start_900' },
          { filePath: 'C:/Story/BAU_900_Farim.d', functionName: 'Rtn_Tot_900' },
        ],
      },
      spawnSiteIndex: [{
        instance: 'GRD_200_XARDAS', spawnPoint: 'WP_MIDDLE',
        filePath: 'C:/Story/Startup.d', functionName: 'STARTUP_NEWWORLD', line: 12,
      }],
      routineNpcIndex: { GRD_200_XARDAS: 'RTN_START_200', BAU_900_FARIM: 'RTN_START_900' },
      routineStateIndex: { BAU_900_FARIM: { id: 900, states: { TOT: 'RTN_TOT_900' } } },
    } as never);
    await openWithWaynet();

    fireEvent.click(screen.getByTestId('stub-pick-waypoint'));

    await screen.findByTestId('world-waypoint-panel');
    const spawns = screen.getByTestId('world-waypoint-spawns');
    expect(spawns).toHaveTextContent('Rtn_Start_200');
    expect(screen.getAllByRole('button', { name: 'Edit routines of GRD_200_XARDAS' })).toHaveLength(1);
    expect(screen.getByTestId('world-waypoint-sites')).not.toHaveTextContent('Rtn_Start_200');
    expect(screen.getAllByRole('button', { name: 'Edit routines of BAU_900_FARIM' })).toHaveLength(1);
    expect(screen.getByTestId('world-waypoint-sites')).toHaveTextContent('Rtn_Tot_900');
  });

  describe('drawn as markers in the viewport', () => {
    // §16.19 slice 4 — the first thing in Phase 1c a person sees. The markers
    // stand on the waypoints the spawns name, so the layer needs the waynet
    // payload for its positions even when the waynet itself is not on screen.
    const SPAWNS = [{
      instance: 'GRD_200_XARDAS', spawnPoint: 'WP_MIDDLE',
      filePath: 'C:/Story/Startup.d', functionName: 'STARTUP_NEWWORLD', line: 12,
    }];

    it('hands the project index down and shows the layer when it is switched on', async () => {
      useProjectStore.setState({ spawnSiteIndex: SPAWNS } as never);
      await openWorld();
      expect(vp.showSpawns).toBe(false);

      fireEvent.click(screen.getByTestId('world-spawns-toggle'));

      await waitFor(() => expect(vp.showSpawns).toBe(true));
      expect(vp.spawns).toEqual(SPAWNS);
    });

    it('asks for the waynet the markers stand on when the open did not land it', async () => {
      // The positions are the waypoints', and the open's own read is allowed to
      // fail over a world that stays open — it leaves `waynet` null, which the
      // rest of the surface reads as "nothing is known". Switched on against
      // that, the layer would draw nothing at all and look like a project that
      // spawns nobody here, so it asks the way the waynet toggle does.
      useProjectStore.setState({ spawnSiteIndex: SPAWNS } as never);
      api.getWorldWaynet.mockRejectedValueOnce(new Error('worker died'));
      await openWorld();
      await waitFor(() => expect(api.getWorldWaynet).toHaveBeenCalledTimes(1));
      api.getWorldWaynet.mockResolvedValueOnce(waynetPayload() as never);

      fireEvent.click(screen.getByTestId('world-spawns-toggle'));

      await waitFor(() => expect(api.getWorldWaynet).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(vp.waynet).not.toBeNull());
    });

    it('switches back off without touching the waynet overlay', async () => {
      // Two independent layers: the waynet is a graph and the markers are the
      // script's opinion of it, and turning one off must not take the other.
      await openWithWaynet();
      fireEvent.click(screen.getByTestId('world-spawns-toggle'));
      await waitFor(() => expect(vp.showSpawns).toBe(true));

      fireEvent.click(screen.getByTestId('world-spawns-toggle'));

      await waitFor(() => expect(vp.showSpawns).toBe(false));
      expect(vp.waynet).not.toBeNull();
    });
  });

  describe('named over the world (§16.19 slice 8)', () => {
    // The shell's half again: the toggle appears when something is drawing
    // waypoints, and reaches the viewport. Which names get drawn, and where, is
    // `waypointLabels`' and `WaypointLabelLayer`'s.

    it('disables the names toggle while nothing is drawing waypoints', async () => {
      // Both layers off, so there is nothing on screen a name could sit on.
      // Disabled rather than absent, so the bar does not grow when a layer
      // comes on (§17).
      await openWorld();

      expect(screen.getByTestId('world-names-toggle')).toBeDisabled();
    });

    it('offers it with the waynet on, and hands the choice down', async () => {
      await openWorld();
      fireEvent.click(screen.getByTestId('world-waynet-toggle'));
      await waitFor(() => expect(vp.showWaynet).toBe(true));
      expect(vp.showWaypointNames).toBe(false);

      fireEvent.click(screen.getByTestId('world-names-toggle'));

      await waitFor(() => expect(vp.showWaypointNames).toBe(true));
    });

    it('offers it with only the spawn markers on', async () => {
      // The markers stand on waypoints, so their names are exactly as askable
      // there — and this is the case where the label layer draws the marked
      // subset rather than the whole net.
      useProjectStore.setState({ spawnSiteIndex: [] } as never);
      await openWorld();
      fireEvent.click(screen.getByTestId('world-spawns-toggle'));
      await waitFor(() => expect(vp.showSpawns).toBe(true));

      expect(screen.getByTestId('world-names-toggle')).toBeInTheDocument();
    });

    it('switches back off without touching either layer', async () => {
      await openWorld();
      fireEvent.click(screen.getByTestId('world-waynet-toggle'));
      await waitFor(() => expect(vp.showWaynet).toBe(true));
      fireEvent.click(screen.getByTestId('world-names-toggle'));
      await waitFor(() => expect(vp.showWaypointNames).toBe(true));

      fireEvent.click(screen.getByTestId('world-names-toggle'));

      await waitFor(() => expect(vp.showWaypointNames).toBe(false));
      expect(vp.showWaynet).toBe(true);
    });
  });

  describe('and moved through the day by the time slider (§16.19 slice 5)', () => {
    // The shell's half: the control exists, it reaches the viewport as a
    // minute, and it hands down the routine index the schedule reads. Where the
    // markers actually land is `SpawnOverlay.test.ts` and `routineSchedule`'s.
    const ROUTINES = [{
      routine: 'RTN_START_FARIM', startMinute: 8 * 60, endMinute: 22 * 60,
      waypoint: 'WP_MIDDLE', filePath: 'C:/Story/Rtn.d', line: 3,
    }];

    async function openWithSpawns() {
      useProjectStore.setState({
        spawnSiteIndex: [{
          instance: 'BAU_900_FARIM', spawnPoint: 'WP_MIDDLE',
          filePath: 'C:/Story/Startup.d', functionName: 'STARTUP_NEWWORLD', line: 12,
        }],
        routineSiteIndex: ROUTINES,
        routineNpcIndex: { BAU_900_FARIM: 'RTN_START_FARIM' },
      } as never);
      await openWorld();
      fireEvent.click(screen.getByTestId('world-spawns-toggle'));
      await waitFor(() => expect(vp.showSpawns).toBe(true));
    }

    it('hands the routine index down beside the spawns', async () => {
      await openWithSpawns();

      expect(vp.routines).toEqual({
        sites: ROUTINES,
        routinesByNpc: { BAU_900_FARIM: 'RTN_START_FARIM' },
        // Empty rather than absent: this project has no routine variants, and
        // the State lens reads the same index whether or not it does.
        statesByNpc: {},
      });
    });

    it('disables the time control until the spawn layer is on', async () => {
      // It has nothing else to change, so a control for a layer nobody is
      // looking at is a control that does nothing visible — disabled rather
      // than absent, so the bar does not grow when the layer comes on (§17).
      await openWorld();

      expect(screen.getByTestId('world-time-toggle')).toBeDisabled();
    });

    it('draws the static spawns until a time is asked for', async () => {
      // Null is the slider off, not midnight. The static spawns are a fact on
      // their own and stay the default.
      await openWithSpawns();

      expect(vp.spawnTime).toBeNull();
      expect(screen.queryByTestId('world-time')).toBeNull();
    });

    it('opens on a populated hour rather than on midnight', async () => {
      await openWithSpawns();

      fireEvent.click(screen.getByTestId('world-time-toggle'));

      await waitFor(() => expect(vp.spawnTime).toBe(8 * 60));
      expect(screen.getByTestId('world-time-readout')).toHaveTextContent('08:00');
    });

    it('sends the minute the slider is moved to', async () => {
      await openWithSpawns();
      fireEvent.click(screen.getByTestId('world-time-toggle'));
      await waitFor(() => expect(vp.spawnTime).toBe(8 * 60));

      const slider = screen.getByTestId('world-time').querySelector('input')!;
      fireEvent.change(slider, { target: { value: String(13 * 60 + 30) } });

      await waitFor(() => expect(vp.spawnTime).toBe(13 * 60 + 30));
      expect(screen.getByTestId('world-time-readout')).toHaveTextContent('13:30');
    });

    it('goes back to the static spawns when the time is switched off', async () => {
      await openWithSpawns();
      fireEvent.click(screen.getByTestId('world-time-toggle'));
      await waitFor(() => expect(vp.spawnTime).toBe(8 * 60));

      fireEvent.click(screen.getByTestId('world-time-toggle'));

      await waitFor(() => expect(vp.spawnTime).toBeNull());
    });

    // §16.19 slice 13 — the State lens. The picker is a lens over the routine
    // variants quest state swaps in, never a claim the game reaches that state,
    // and the reach readout beside it is what keeps that distinction visible.
    describe('and seen through a quest state (slice 13)', () => {
      const STATES = {
        BAU_900_FARIM: { id: 900, states: { TOT: 'RTN_TOT_900' } },
      };

      async function openWithStates() {
        useProjectStore.setState({
          spawnSiteIndex: [{
            instance: 'BAU_900_FARIM', spawnPoint: 'WP_MIDDLE',
            filePath: 'C:/Story/Startup.d', functionName: 'STARTUP_NEWWORLD', line: 12,
          }],
          routineSiteIndex: [
            ...ROUTINES,
            {
              routine: 'RTN_TOT_900', startMinute: 0, endMinute: 0,
              waypoint: 'FP_CAMP', filePath: 'C:/Story/Rtn.d', line: 9,
            },
          ],
          routineNpcIndex: { BAU_900_FARIM: 'RTN_START_FARIM', GRD_200_X: 'RTN_START_X' },
          routineStateIndex: STATES,
        } as never);
        await openWorld();
        fireEvent.click(screen.getByTestId('world-spawns-toggle'));
        await waitFor(() => expect(vp.showSpawns).toBe(true));
      }

      it('offers no state picker until a time is chosen', async () => {
        // A state without a minute answers nothing the static layer does not.
        await openWithStates();

        expect(screen.queryByTestId('world-state')).toBeNull();
      });

      it('defaults to the declared routine, which is what it drew before', async () => {
        await openWithStates();

        fireEvent.click(screen.getByTestId('world-time-toggle'));

        await waitFor(() => expect(vp.spawnTime).toBe(8 * 60));
        expect(vp.spawnState).toBeNull();
      });

      it('sends the chosen state down to the viewport', async () => {
        await openWithStates();
        fireEvent.click(screen.getByTestId('world-time-toggle'));
        await waitFor(() => expect(vp.spawnTime).toBe(8 * 60));

        fireEvent.change(screen.getByTestId('world-state').querySelector('input')!, {
          target: { value: 'TOT' },
        });

        await waitFor(() => expect(vp.spawnState).toBe('TOT'));
      });

      it('hands down the state index so the schedule can resolve a variant', async () => {
        await openWithStates();

        expect(vp.routines.statesByNpc).toEqual(STATES);
      });

      // The readout that stops "State: TOT" reading as "the world is in TOT".
      // One of the two NPCs with a known day has a TOT variant; the other keeps
      // his declared routine, and the count is what says so.
      it('reports how far the chosen state actually reaches', async () => {
        await openWithStates();
        fireEvent.click(screen.getByTestId('world-time-toggle'));
        await waitFor(() => expect(vp.spawnTime).toBe(8 * 60));

        expect(screen.queryByTestId('world-state-reach')).toBeNull();

        fireEvent.change(screen.getByTestId('world-state').querySelector('input')!, {
          target: { value: 'TOT' },
        });

        await waitFor(() =>
          expect(screen.getByTestId('world-state-reach')).toHaveTextContent('1 of 2 NPCs')
        );
      });

      it('clears the state when the time is switched off', async () => {
        // The state is a lens on the day; with no day there is nothing to look
        // through, and a state surviving a hidden control is a filter nobody
        // can see.
        await openWithStates();
        fireEvent.click(screen.getByTestId('world-time-toggle'));
        await waitFor(() => expect(vp.spawnTime).toBe(8 * 60));
        fireEvent.change(screen.getByTestId('world-state').querySelector('input')!, {
          target: { value: 'TOT' },
        });
        await waitFor(() => expect(vp.spawnState).toBe('TOT'));

        fireEvent.click(screen.getByTestId('world-time-toggle'));

        await waitFor(() => expect(vp.spawnTime).toBeNull());
        expect(vp.spawnState).toBeNull();
      });

      // Slice 11's verdict on the list: shared names first by reach, then a
      // divider, then the singletons — each with its reach, because the
      // readout beside the select only speaks after a choice.
      it('lists shared states first by reach, singletons after a divider, each with its reach', async () => {
        useProjectStore.setState({
          spawnSiteIndex: [],
          routineSiteIndex: ROUTINES,
          routineNpcIndex: { BAU_900_FARIM: 'RTN_START_FARIM', GRD_200_X: 'RTN_START_X' },
          routineStateIndex: {
            BAU_900_FARIM: { id: 900, states: { TOT: 'R', ABMARSCH: 'R', SHIP: 'R' } },
            GRD_200_X: { id: 200, states: { TOT: 'R', SHIP: 'R' } },
            OTHER: { id: 1, states: { TOT: 'R' } },
          },
        } as never);
        await openWorld();
        fireEvent.click(screen.getByTestId('world-spawns-toggle'));
        await waitFor(() => expect(vp.showSpawns).toBe(true));
        fireEvent.click(screen.getByTestId('world-time-toggle'));
        await waitFor(() => expect(vp.spawnTime).toBe(8 * 60));

        fireEvent.mouseDown(screen.getByTestId('world-state').querySelector('[role="combobox"]')!);

        const listbox = await screen.findByRole('listbox');
        expect(
          Array.from(listbox.children).map((child) => child.textContent)
        ).toEqual(['Declared', 'TOT (3)', 'SHIP (2)', 'Only one NPC', 'ABMARSCH (1)']);
      });

      it('offers the picker with no options rather than hiding it', async () => {
        // The empty-index rule the Spawns button follows: a missing control
        // cannot tell anybody the difference between "no project open" and "no
        // states in this one".
        useProjectStore.setState({ routineStateIndex: {} } as never);
        await openWorld();
        fireEvent.click(screen.getByTestId('world-spawns-toggle'));
        await waitFor(() => expect(vp.showSpawns).toBe(true));
        fireEvent.click(screen.getByTestId('world-time-toggle'));

        await waitFor(() => expect(screen.getByTestId('world-state')).toBeTruthy());
      });
    });

    it('clears the time when the spawn layer itself is switched off', async () => {
      // Otherwise a time set behind a hidden layer comes back with the layer,
      // and whoever turns the spawns on gets a day-filtered set they did not
      // ask for and no visible control saying so.
      await openWithSpawns();
      fireEvent.click(screen.getByTestId('world-time-toggle'));
      await waitFor(() => expect(vp.spawnTime).toBe(8 * 60));

      fireEvent.click(screen.getByTestId('world-spawns-toggle'));
      await waitFor(() => expect(vp.showSpawns).toBe(false));

      expect(vp.spawnTime).toBeNull();
      fireEvent.click(screen.getByTestId('world-spawns-toggle'));
      await waitFor(() => expect(vp.showSpawns).toBe(true));
      expect(vp.spawnTime).toBeNull();
    });
  });

  describe('renamed in that panel', () => {
    // W1 (§16.7). The panel is the only UI a waypoint has, so it is where the
    // one waynet edit that is not a drag lives.
    const nameField = () => screen.getByTestId('world-waypoint-name-input') as HTMLInputElement;

    async function pickWaypoint(): Promise<WaynetPayload> {
      const payload = await openWithWaynet();
      fireEvent.click(screen.getByTestId('stub-pick-waypoint'));
      await screen.findByTestId('world-waypoint-panel');
      return payload;
    }

    const commitName = (value: string) => {
      fireEvent.change(nameField(), { target: { value } });
      fireEvent.blur(nameField());
    };

    it('names both of its fields, rather than leaving it to a placeholder', async () => {
      // §5.4 item 23 of `docs/plans/level-editor-review-2026-09-04.md`. The
      // rename box had no label at all — the word "Waypoint" sits under it as
      // free text, which nothing associates with the field — and the connect
      // box had a placeholder, which is gone the moment anything is typed.
      await pickWaypoint();

      expect(nameField()).toHaveAccessibleName('Waypoint name');
      expect(screen.getByTestId('world-waypoint-join-name')).toHaveAccessibleName(/connect/i);
    });

    it('becomes a RenameWaypoint carrying the name it replaces', async () => {
      // `from` is the guard as well as the origin: a bare index always resolves
      // to *some* waypoint, so the name it had is the only check the address
      // admits.
      await pickWaypoint();

      commitName('WP_RENAMED');

      await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalledWith([{
        op: 'RenameWaypoint', waypoint: 1, from: 'WP_MIDDLE', to: 'WP_RENAMED',
      }]));
    });

    it('writes the committed name into the payload the panel reads', async () => {
      // Nothing else does. The VOB projection has no row for a waypoint and
      // refuses the op by name, so without this the panel keeps showing the old
      // name until the world is re-opened.
      await pickWaypoint();

      commitName('WP_RENAMED');

      expect(await screen.findByDisplayValue('WP_RENAMED')).toBeInTheDocument();
    });

    it('commits nothing for a name that did not change, or an empty one', async () => {
      await pickWaypoint();

      commitName('WP_MIDDLE');
      commitName('');

      expect(api.applyWorldOps).not.toHaveBeenCalled();
    });

    it('puts the name back when the op is refused, and says so', async () => {
      // A rename the world refused — a duplicate, say — leaves the panel naming
      // a waypoint the file does not have.
      await pickWaypoint();
      api.applyWorldOps.mockRejectedValueOnce(new Error('waypoint 2 is already named WP_TAKEN'));

      commitName('WP_TAKEN');

      expect(await screen.findByTestId('world-edit-error')).toHaveTextContent('WP_TAKEN');
      await waitFor(() => expect(nameField().value).toBe('WP_MIDDLE'));
    });

    it('is undone through the same path a waypoint move is', async () => {
      await pickWaypoint();
      commitName('WP_RENAMED');
      await screen.findByDisplayValue('WP_RENAMED');

      api.undoWorldEdit.mockResolvedValueOnce([{
        op: 'RenameWaypoint', waypoint: 1, from: 'WP_RENAMED', to: 'WP_MIDDLE',
      }] as never);
      fireEvent.keyDown(window, { key: 'z', ctrlKey: true });

      expect(await screen.findByDisplayValue('WP_MIDDLE')).toBeInTheDocument();
    });
  });

  describe('added at the picked terrain point', () => {
    // W2 (§16.7). It appends, so it renumbers nothing and needs no addressing
    // scheme of its own — and it is offered only while the overlay is on,
    // because the overlay is the only thing that draws the result.
    async function addWaypoint(name?: string) {
      fireEvent.click(screen.getByTestId('stub-pick-terrain'));
      act(() => useWorldStore.getState().selectVob(null));
      fireEvent.click(await screen.findByTestId('world-add-waypoint'));

      if (name !== undefined) {
        fireEvent.change(screen.getByTestId('world-waypoint-add-name'), {
          target: { value: name },
        });
      }
      fireEvent.click(screen.getByTestId('world-waypoint-add-confirm'));
    }

    it('becomes an AddWaypoint one past the end, with a null origin', async () => {
      // The null side is what makes the inverse a removal with no op of its
      // own, exactly as it is for a placed VOB.
      await openWithWaynet();

      await addWaypoint('FP_ADDED');

      await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalledWith([{
        op: 'AddWaypoint', waypoint: 3, name: 'FP_ADDED', from: null, to: TERRAIN,
      }]));
    });

    it('suggests a free-point name, because a name is the only field it has', async () => {
      await openWithWaynet();

      await addWaypoint();

      await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalledWith([
        expect.objectContaining({ op: 'AddWaypoint', name: 'FP_NEW_3' }),
      ]));
    });

    it('closes on confirm and on cancel, and does not reopen itself', async () => {
      // The Name field is a controlled-`inputValue` Autocomplete and the
      // dialog is open on `addingWaypoint !== null`, so a reset event firing
      // `onInputChange('')` as it unmounts would put an empty string back
      // where the null was — and the dialog would stand straight back up.
      await openWithWaynet();

      await addWaypoint('FP_ADDED');
      await waitFor(() =>
        expect(screen.queryByTestId('world-waypoint-add-confirm')).not.toBeInTheDocument());

      fireEvent.click(await screen.findByTestId('world-add-waypoint'));
      fireEvent.click(screen.getByText('Cancel'));

      await waitFor(() =>
        expect(screen.queryByTestId('world-waypoint-add-confirm')).not.toBeInTheDocument());
    });

    it('refuses a name the payload already carries before the round trip', async () => {
      await openWithWaynet();
      fireEvent.click(screen.getByTestId('stub-pick-terrain'));
      act(() => useWorldStore.getState().selectVob(null));
      fireEvent.click(await screen.findByTestId('world-add-waypoint'));

      fireEvent.change(screen.getByTestId('world-waypoint-add-name'), {
        target: { value: 'WP_MIDDLE' },
      });

      expect(screen.getByTestId('world-waypoint-add-confirm')).toBeDisabled();
    });

    it('says why Add is dead for a name the world already has', async () => {
      // The autocomplete offers every waypoint a script names, and most of
      // those are in the world already — so the disabled button is now
      // reachable by *picking from the list*, not only by typing a duplicate.
      // Disabled with no reason given is the wart that makes it look broken.
      await openWithWaynet();
      fireEvent.click(screen.getByTestId('stub-pick-terrain'));
      act(() => useWorldStore.getState().selectVob(null));
      fireEvent.click(await screen.findByTestId('world-add-waypoint'));

      fireEvent.change(screen.getByTestId('world-waypoint-add-name'), {
        target: { value: 'WP_MIDDLE' },
      });

      expect(screen.getByTestId('world-waypoint-add-dialog'))
        .toHaveTextContent(/already in this world/i);
    });

    it('says nothing of the sort for a name the world has not got', async () => {
      await openWithWaynet();
      fireEvent.click(screen.getByTestId('stub-pick-terrain'));
      act(() => useWorldStore.getState().selectVob(null));
      fireEvent.click(await screen.findByTestId('world-add-waypoint'));

      fireEvent.change(screen.getByTestId('world-waypoint-add-name'), {
        target: { value: 'FP_ADDED' },
      });

      expect(screen.getByTestId('world-waypoint-add-dialog'))
        .not.toHaveTextContent(/already in this world/i);
    });

    it('re-reads the overlay payload, which is the only thing that can grow it', async () => {
      // The positions column is a typed array the point cloud draws through and
      // it cannot be appended to — and the VOB projection has no row for a
      // waypoint at all. Nothing but a fresh payload puts the new one on screen.
      await openWithWaynet();
      const grown = waynetPayload();
      api.getWorldWaynet.mockResolvedValueOnce(grown as never);

      await addWaypoint('FP_ADDED');

      await waitFor(() => expect(api.getWorldWaynet).toHaveBeenCalledTimes(2));
    });

    it('turns the waynet overlay on when used with it off', async () => {
      // Nothing else would draw the waypoint, and the gizmo could not reach
      // it — so the action switches the overlay on rather than hiding until
      // somebody does.
      await openWorld();
      fireEvent.click(screen.getByTestId('stub-pick-terrain'));
      act(() => useWorldStore.getState().selectVob(null));
      expect(vp.showWaynet).toBe(false);

      fireEvent.click(await screen.findByTestId('world-add-waypoint'));
      await screen.findByTestId('world-waypoint-add-dialog');

      expect(vp.showWaynet).toBe(true);
    });

    it('offers every waypoint name the project index knows as an autocomplete option', async () => {
      // The names a script already uses — `AddWaypoint`'s name field is the
      // one place a typo costs the most, since nothing else in the project
      // catches a name that does not match what a routine calls for.
      useProjectStore.setState({
        waypointSiteIndex: {
          OW_PATH_42: [{ filePath: 'Rtn.d', functionName: 'Rtn_Start_Diego' }],
          NW_CROSSROAD: [{ filePath: 'Rtn.d', functionName: 'Rtn_Start_Bosper' }],
        },
      } as never);
      await openWithWaynet();
      fireEvent.click(screen.getByTestId('stub-pick-terrain'));
      act(() => useWorldStore.getState().selectVob(null));
      fireEvent.click(await screen.findByTestId('world-add-waypoint'));

      fireEvent.change(screen.getByTestId('world-waypoint-add-name'), {
        target: { value: 'OW_' },
      });

      expect(await screen.findByText('OW_PATH_42')).toBeInTheDocument();
      expect(screen.queryByText('NW_CROSSROAD')).not.toBeInTheDocument();
    });

    it('re-reads the payload on undo too, and lets go of the waypoint', async () => {
      // Undo removes the tail. A gizmo left standing on it would be sitting on
      // an index the waynet no longer has.
      await openWithWaynet();
      api.getWorldWaynet.mockResolvedValueOnce(waynetPayload() as never);
      await addWaypoint('FP_ADDED');
      await waitFor(() => expect(api.getWorldWaynet).toHaveBeenCalledTimes(2));
      fireEvent.click(screen.getByTestId('stub-pick-waypoint'));
      await waitFor(() => expect(vp.selectedWaypoint).toBe(1));

      api.undoWorldEdit.mockResolvedValueOnce([{
        op: 'AddWaypoint', waypoint: 3, name: 'FP_ADDED', from: TERRAIN, to: null,
      }] as never);
      api.getWorldWaynet.mockResolvedValueOnce(waynetPayload() as never);
      fireEvent.keyDown(window, { key: 'z', ctrlKey: true });

      await waitFor(() => expect(api.getWorldWaynet).toHaveBeenCalledTimes(3));
      expect(vp.selectedWaypoint).toBeNull();
    });
  });

  describe('joined and unjoined in that panel', () => {
    // W3 (§16.7). An edge needs a *second* waypoint and the surface has one
    // selection, so the second end is named in the panel rather than picked in
    // the viewport. The fixture waynet is a chain: WP_START–WP_MIDDLE–WP_END.
    async function pickMiddle(): Promise<WaynetPayload> {
      const payload = await openWithWaynet();
      fireEvent.click(screen.getByTestId('stub-pick-waypoint'));
      await screen.findByTestId('world-waypoint-panel');
      return payload;
    }

    /** The panel with `WP_START` selected — the end of the chain, so `WP_END`
     *  is a waypoint it is *not* already joined to. */
    async function pickStart(): Promise<void> {
      await openWithWaynet();
      act(() => useWorldStore.getState().selectWaypoint(0));
      await screen.findByTestId('world-waypoint-panel');
    }

    const typeJoin = (value: string) => {
      fireEvent.change(screen.getByTestId('world-waypoint-join-name'), {
        target: { value },
      });
    };

    it('lists the far end of every edge the selected waypoint is in', async () => {
      // Read out of the same flat pair buffer the overlay draws its lines
      // through, in both orientations: the fixture stores 0–1 and 1–2, and the
      // middle waypoint is the far end of one and the near end of the other.
      await pickMiddle();

      const edges = await screen.findByTestId('world-waypoint-edges');
      expect(edges).toHaveTextContent('WP_START');
      expect(edges).toHaveTextContent('WP_END');
      expect(edges).not.toHaveTextContent('WP_MIDDLE');
    });

    it('becomes a SetWaypointEdge with both ends guarded, taking the edge away', async () => {
      await pickMiddle();

      fireEvent.click(screen.getByTestId('world-waypoint-disconnect-0'));

      await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalledWith([{
        op: 'SetWaypointEdge',
        a: 1, aName: 'WP_MIDDLE', b: 0, bName: 'WP_START',
        from: true, to: false,
      }]));
    });

    it('becomes the same op the other way round for a named waypoint', async () => {
      // Case-insensitively, like every other by-name lookup a waypoint has —
      // the routine index is keyed uppercase for the same reason.
      await pickStart();

      typeJoin('wp_end');
      fireEvent.click(screen.getByTestId('world-waypoint-connect'));

      await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalledWith([{
        op: 'SetWaypointEdge',
        a: 0, aName: 'WP_START', b: 2, bName: 'WP_END',
        from: false, to: true,
      }]));
    });

    it('offers no join for a name the waynet has not got, the waypoint itself, or a neighbour', async () => {
      // All three are refusals the binding makes too. Dead button rather than a
      // round trip: this side is holding the very list that decides.
      await pickStart();

      typeJoin('WP_NOWHERE');
      expect(screen.getByTestId('world-waypoint-connect')).toBeDisabled();
      typeJoin('WP_START');
      expect(screen.getByTestId('world-waypoint-connect')).toBeDisabled();
      typeJoin('WP_MIDDLE');
      expect(screen.getByTestId('world-waypoint-connect')).toBeDisabled();

      typeJoin('WP_END');
      expect(screen.getByTestId('world-waypoint-connect')).toBeEnabled();
      expect(api.applyWorldOps).not.toHaveBeenCalled();
    });

    it('re-reads the overlay payload, which is the only thing that draws the line', async () => {
      // The edge buffer is a typed array the lines are built from and it cannot
      // gain a pair in place — and a removal can promote an endpoint to a free
      // point, which is a flags column nothing else rewrites.
      await pickMiddle();
      api.getWorldWaynet.mockResolvedValueOnce(waynetPayload() as never);

      fireEvent.click(screen.getByTestId('world-waypoint-disconnect-2'));

      await waitFor(() => expect(api.getWorldWaynet).toHaveBeenCalledTimes(2));
    });

    it('re-reads it on undo too, which arrives as the same op swapped', async () => {
      await pickMiddle();
      api.getWorldWaynet.mockResolvedValueOnce(waynetPayload() as never);
      fireEvent.click(screen.getByTestId('world-waypoint-disconnect-2'));
      await waitFor(() => expect(api.getWorldWaynet).toHaveBeenCalledTimes(2));

      api.undoWorldEdit.mockResolvedValueOnce([{
        op: 'SetWaypointEdge',
        a: 1, aName: 'WP_MIDDLE', b: 2, bName: 'WP_END',
        from: false, to: true,
      }] as never);
      api.getWorldWaynet.mockResolvedValueOnce(waynetPayload() as never);
      fireEvent.keyDown(window, { key: 'z', ctrlKey: true });

      await waitFor(() => expect(api.getWorldWaynet).toHaveBeenCalledTimes(3));
      // The waypoint keeps its gizmo: an edge renumbers nothing, so the index
      // the selection stands on still names what it named before.
      expect(vp.selectedWaypoint).toBe(1);
    });
  });

  describe('deleted in that panel', () => {
    // W4 (§16.7) — the one waynet op that renumbers. §15 shipped it as a
    // barrier and §7 withdrew that: the op carries the whole waypoint now,
    // so the confirm is a destructive-action warning rather than a notice that
    // the history is about to go. It lives in the panel for W1's reason — that
    // is the only UI a waypoint has.
    async function pickMiddle(): Promise<WaynetPayload> {
      const payload = await openWithWaynet();
      fireEvent.click(screen.getByTestId('stub-pick-waypoint'));
      await screen.findByTestId('world-waypoint-panel');
      return payload;
    }

    /** Ask to delete the selected waypoint, without confirming. */
    async function askToDelete(): Promise<void> {
      fireEvent.click(await screen.findByTestId('world-waypoint-delete'));
    }

    it('carries the whole waypoint, once the warning is confirmed', async () => {
      // The op the surface actually sends, end to end: the fixture's middle
      // waypoint, its position, both its edges, and `to: null` for the direction
      // this side is allowed to ask for.
      await pickMiddle();
      api.getWorldWaynet.mockResolvedValueOnce(waynetPayload() as never);

      await askToDelete();
      fireEvent.click(screen.getByTestId('world-waypoint-delete-confirm'));

      await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalledWith([{
        op: 'DeleteWaypoint',
        waypoint: 1,
        name: 'WP_MIDDLE',
        from: {
          position: WAYPOINT_WAS,
          direction: [0, 0, 1],
          waterDepth: 0,
          underWater: false,
          freePoint: false,
          edges: [{ waypoint: 0, name: 'WP_START' }, { waypoint: 2, name: 'WP_END' }],
        },
        to: null,
      }]));
    });

    it('warns about the edges, and says the delete undoes', async () => {
      // What replaced §15's "this clears your history" (§7). The edges are
      // still the part a user cannot see coming from the point on screen, and
      // that is now the whole of what the dialog is for.
      await pickMiddle();

      await askToDelete();

      const warning = screen.getByTestId('world-waypoint-delete-warning');
      expect(warning).toHaveTextContent(/edge/i);
      expect(warning).toHaveTextContent(/ctrl\+z|undo/i);
      expect(warning).not.toHaveTextContent(/cannot be undone/i);
      expect(api.applyWorldOps).not.toHaveBeenCalled();
    });

    it('sends nothing when the warning is dismissed', async () => {
      await pickMiddle();

      await askToDelete();
      fireEvent.click(screen.getByTestId('world-waypoint-delete-cancel'));

      expect(api.applyWorldOps).not.toHaveBeenCalled();
      await waitFor(() => expect(screen.queryByTestId('world-waypoint-delete-warning'))
        .not.toBeInTheDocument());
    });

    it('re-reads the overlay payload and lets go of the waypoint, because it renumbers', async () => {
      // Every index after the deleted waypoint names a different one now, so a
      // gizmo left standing would be on somebody else — and the payload cannot
      // shrink in place any more than it can grow.
      await pickMiddle();
      api.getWorldWaynet.mockResolvedValueOnce(waynetPayload() as never);

      await askToDelete();
      fireEvent.click(screen.getByTestId('world-waypoint-delete-confirm'));

      await waitFor(() => expect(api.getWorldWaynet).toHaveBeenCalledTimes(2));
      expect(vp.selectedWaypoint).toBeNull();
      // The VOB enumeration is untouched — a waypoint has no row in it.
      expect(api.refreshWorldIndex).not.toHaveBeenCalled();
    });

    it('says so and changes nothing when the main process refuses it', async () => {
      await pickMiddle();
      api.applyWorldOps.mockRejectedValueOnce(new Error('waypoint 1 is WP_OTHER'));

      await askToDelete();
      fireEvent.click(screen.getByTestId('world-waypoint-delete-confirm'));

      expect(await screen.findByTestId('world-edit-error')).toHaveTextContent(/WP_OTHER/);
      // Not re-read: nothing was deleted, so the payload on screen is the
      // world's — and the selection is still a waypoint that exists.
      expect(api.getWorldWaynet).toHaveBeenCalledTimes(1);
      expect(vp.selectedWaypoint).toBe(1);
    });
  });
});
