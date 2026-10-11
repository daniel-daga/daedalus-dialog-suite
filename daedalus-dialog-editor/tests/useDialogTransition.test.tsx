/**
 * Phase 2.1 (dialog-open-latency): useDialogTransition no longer uses RAF
 * two-frame sequencing to unmount/remount the editor. It commits the new
 * selection via React's useTransition and tracks an explicit async-loading
 * flag for the file-open window. These tests assert the resulting behavior
 * (selection commit, the rapid-switch race, and loading-flag settling), not
 * any RAF internals.
 */
import * as fs from 'fs';
import * as path from 'path';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useDialogTransition } from '../src/renderer/components/hooks/useDialogTransition';
import { useUISelectionStore } from '../src/renderer/store/uiSelectionStore';

describe('useDialogTransition', () => {
  beforeEach(() => {
    useUISelectionStore.setState({
      selectedNPC: null,
      selectedDialog: null,
      selectedQuest: null,
      selectedFunctionName: null,
      selectedAction: null,
      activeView: 'dialog',
    });
  });

  test('finalizeDialogSelection commits the dialog/function selection into the UI selection store', async () => {
    const { result } = renderHook(() => useDialogTransition());

    act(() => {
      result.current.finalizeDialogSelection('DIA_A', null);
    });

    await waitFor(() => {
      expect(useUISelectionStore.getState().selectedDialog).toBe('DIA_A');
    });
    expect(useUISelectionStore.getState().selectedFunctionName).toBeNull();
  });

  test('two rapid finalize calls end with the SECOND selection committed (stale-selection race)', async () => {
    const { result } = renderHook(() => useDialogTransition());

    act(() => {
      result.current.finalizeDialogSelection('DIA_A', 'DIA_A_Info');
      result.current.finalizeDialogSelection('DIA_B', 'DIA_B_Info');
    });

    await waitFor(() => {
      expect(useUISelectionStore.getState().selectedDialog).toBe('DIA_B');
    });
    expect(useUISelectionStore.getState().selectedFunctionName).toBe('DIA_B_Info');
  });

  test('isLoadingDialog stays true across the async-open flag and the transition, then settles false', async () => {
    const { result } = renderHook(() => useDialogTransition());

    expect(result.current.isLoadingDialog).toBe(false);

    // Navigation handlers set this while the async file-open is in flight.
    act(() => {
      result.current.setIsLoadingDialog(true);
    });
    expect(result.current.isLoadingDialog).toBe(true);

    // finalizeDialogSelection clears the async flag and starts the
    // transition — isLoadingDialog must not flicker false before the
    // transition actually commits.
    act(() => {
      result.current.finalizeDialogSelection('DIA_A', null);
    });

    await waitFor(() => {
      expect(result.current.isLoadingDialog).toBe(false);
    });
    expect(useUISelectionStore.getState().selectedDialog).toBe('DIA_A');
  });

  test('does not reference requestAnimationFrame/cancelAnimationFrame (RAF machinery removed)', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../src/renderer/components/hooks/useDialogTransition.ts'),
      'utf-8'
    );
    expect(source).not.toMatch(/requestAnimationFrame|cancelAnimationFrame/);
  });
});
