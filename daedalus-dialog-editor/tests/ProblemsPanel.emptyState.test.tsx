/**
 * The Problems panel scans `projectStore.parsedFiles`, so in single-file mode
 * it has nothing to scan — and used to say "0 errors, 0 warnings" as if the
 * file were clean (production-readiness F18). It now says why it is empty,
 * and renders the store's `isScanning` while a scan runs.
 */

import React from 'react';
import { render, screen, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import ProblemsPanel from '../src/renderer/components/Problems/ProblemsPanel';
import { useProblemsStore } from '../src/renderer/store/problemsStore';
import { useProjectStore } from '../src/renderer/store/projectStore';

jest.mock('../src/renderer/hooks/useNavigation', () => ({
  useNavigation: () => ({ navigateToDialog: jest.fn(), navigateToSymbol: jest.fn() })
}));

describe('ProblemsPanel empty states', () => {
  beforeEach(() => {
    act(() => {
      useProjectStore.setState({ parseGeneration: 0, isIngesting: false, projectPath: null });
      useProblemsStore.setState({
        problems: [], hasScanned: true, isScanning: false,
        scannedFileCount: 0, totalFileCount: 0, requestScan: jest.fn()
      });
    });
  });

  it('explains the single-file empty state instead of claiming a clean scan', () => {
    render(<ProblemsPanel />);
    const summary = screen.getByTestId('problems-summary');
    expect(summary).toHaveTextContent(/open a project/i);
    expect(summary).not.toHaveTextContent(/0 errors/);
  });

  it('reports counts once a project is open', () => {
    act(() => { useProjectStore.setState({ projectPath: 'C:/mod' }); });
    render(<ProblemsPanel />);
    expect(screen.getByTestId('problems-summary')).toHaveTextContent('0 errors, 0 warnings');
  });

  it('renders the store\'s isScanning while a rescan runs', () => {
    act(() => {
      useProjectStore.setState({ projectPath: 'C:/mod' });
      useProblemsStore.setState({ isScanning: true });
    });
    render(<ProblemsPanel />);
    expect(screen.getByTestId('problems-summary')).toHaveTextContent('Scanning');
  });
});
