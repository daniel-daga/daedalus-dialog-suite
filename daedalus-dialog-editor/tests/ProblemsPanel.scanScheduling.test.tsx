import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import ProblemsPanel from '../src/renderer/components/Problems/ProblemsPanel';
import { useProblemsStore } from '../src/renderer/store/problemsStore';
import { useProjectStore } from '../src/renderer/store/projectStore';

jest.mock('../src/renderer/hooks/useNavigation', () => ({
  useNavigation: () => ({ navigateToDialog: jest.fn(), navigateToSymbol: jest.fn() })
}));

describe('ProblemsPanel scan scheduling', () => {
  const originalActions = {
    runScan: useProblemsStore.getState().runScan,
    requestScan: useProblemsStore.getState().requestScan
  };
  const runScan = jest.fn();
  const requestScan = jest.fn();

  beforeEach(() => {
    runScan.mockClear();
    requestScan.mockClear();
    useProblemsStore.setState({ runScan, requestScan });
    useProjectStore.setState({ parseGeneration: 0, isIngesting: false });
  });

  afterEach(() => {
    act(() => {
      useProblemsStore.setState(originalActions);
      useProblemsStore.getState().clear();
    });
  });

  it('requests a scheduled scan on mount and on every parseGeneration bump, never a direct scan', () => {
    render(<ProblemsPanel />);
    expect(requestScan).toHaveBeenCalledTimes(1);

    act(() => {
      useProjectStore.setState((s) => ({ parseGeneration: s.parseGeneration + 1 }));
    });
    expect(requestScan).toHaveBeenCalledTimes(2);

    act(() => {
      useProjectStore.setState((s) => ({ parseGeneration: s.parseGeneration + 1 }));
    });
    expect(requestScan).toHaveBeenCalledTimes(3);

    // Generation bumps must go through the scheduler, not the immediate scan.
    expect(runScan).not.toHaveBeenCalled();
  });

  it('requests a scan when ingestion completes even without a parseGeneration bump', () => {
    render(<ProblemsPanel />);
    act(() => {
      useProjectStore.setState({ isIngesting: true });
    });
    const callsWhileIngesting = requestScan.mock.calls.length;

    act(() => {
      useProjectStore.setState({ isIngesting: false });
    });
    expect(requestScan.mock.calls.length).toBe(callsWhileIngesting + 1);
  });

  it('the manual Rescan button scans immediately', () => {
    render(<ProblemsPanel />);
    fireEvent.click(screen.getByTestId('problems-rescan'));

    expect(runScan).toHaveBeenCalledTimes(1);
  });
});
