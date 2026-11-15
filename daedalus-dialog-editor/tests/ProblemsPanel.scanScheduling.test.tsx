import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import ProblemsPanel from '../src/renderer/components/Problems/ProblemsPanel';
import { useProblemsStore } from '../src/renderer/store/problemsStore';
import { useProjectStore } from '../src/renderer/store/projectStore';

jest.mock('../src/renderer/hooks/useNavigation', () => ({
  useNavigation: () => ({ navigateToDialog: jest.fn(), navigateToSymbol: jest.fn() })
}));

// Scheduling belongs to storeSync, not to the panel's mount: see
// problemsStore.scanScheduling.test.ts (#563).
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
    useProblemsStore.setState({ runScan, requestScan, hasScanned: true, isScanning: false });
    useProjectStore.setState({ parseGeneration: 0, isIngesting: false, projectPath: 'C:/mod' });
  });

  afterEach(() => {
    act(() => {
      useProblemsStore.setState(originalActions);
      useProblemsStore.getState().clear();
    });
  });

  it('the manual Rescan button scans immediately', () => {
    render(<ProblemsPanel />);
    fireEvent.click(screen.getByTestId('problems-rescan'));

    expect(runScan).toHaveBeenCalledTimes(1);
  });
});
