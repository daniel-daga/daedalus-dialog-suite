import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import ProblemsPanel from '../src/renderer/components/Problems/ProblemsPanel';
import { useProblemsStore } from '../src/renderer/store/problemsStore';
import { useProjectStore } from '../src/renderer/store/projectStore';
import type { Problem } from '../src/renderer/problems/domain/types';

jest.mock('../src/renderer/hooks/useNavigation', () => ({
  useNavigation: () => ({ navigateToDialog: jest.fn(), navigateToSymbol: jest.fn() })
}));

const problems: Problem[] = [
  { id: 'a', severity: 'error', rule: 'parse-error', message: 'Broken syntax',
    locus: { kind: 'script', filePath: 'C:/mod/dialog/a.d', functionName: 'DIA_Test' } },
  { id: 'b', severity: 'warning', rule: 'npc-not-found', message: 'Unknown NPC',
    locus: { kind: 'script', filePath: 'C:/mod/npc/a.d' } },
  { id: 'c', severity: 'hint', rule: 'routine-mob-missing', message: 'Missing bed',
    locus: { kind: 'script', filePath: 'C:/mod/dialog/a.d' } },
  { id: 'd', severity: 'warning', rule: 'portal-unpaired', message: 'Unpaired portal',
    locus: { kind: 'world', polygon: 42 } }
];

const select = (label: string, option: string): void => {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: new RegExp(`^${label}`) }));
  fireEvent.click(screen.getByRole('option', { name: option }));
};
const rows = (): HTMLElement[] => within(screen.getByTestId('problems-list')).queryAllByRole('listitem');

describe('ProblemsPanel filters', () => {
  beforeEach(() => {
    useProjectStore.setState({ projectPath: 'C:/mod', isIngesting: false });
    useProblemsStore.setState({ problems, hasScanned: true, isScanning: false, requestScan: jest.fn() });
  });

  it('filters each severity, rule and location without confusing equal basenames', () => {
    render(<ProblemsPanel />);
    select('Type', 'Hint');
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toHaveTextContent('Missing bed');
    select('Type', 'All types');
    select('Kind', 'Missing NPC');
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toHaveTextContent('Unknown NPC');
    select('Kind', 'All kinds');
    select('Location', 'C:/mod/dialog/a.d');
    expect(rows()).toHaveLength(2);
    select('Location', 'C:/mod/npc/a.d');
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toHaveTextContent('Unknown NPC');
    select('Location', 'World');
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toHaveTextContent('Unpaired portal');
    select('Location', 'Scripts');
    expect(rows()).toHaveLength(3);
  });

  it.each(['broken SYNTAX', 'DIA_test', 'MOD/dialog', 'Syntax error', 'polygon 42'])('searches messages, declarations, paths, rule labels and world addresses: %s', (query) => {
    render(<ProblemsPanel />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Search problems' }), { target: { value: ` ${query} ` } });
    expect(rows()).toHaveLength(query === 'MOD/dialog' ? 2 : 1);
  });

  it('keeps previous results while scanning and reports scanning rather than no filter matches', () => {
    render(<ProblemsPanel />);
    act(() => { useProblemsStore.setState({ isScanning: true }); });
    expect(rows()).toHaveLength(4);
    expect(screen.getByRole('status')).toHaveTextContent('Showing previous results');
    expect(screen.getByRole('progressbar', { name: 'Scanning project' })).toBeInTheDocument();
    select('Location', 'World');
    select('Type', 'Error');
    expect(screen.getByTestId('problems-empty')).toHaveTextContent('Scanning');
    act(() => { useProblemsStore.setState({ isScanning: false }); });
    expect(screen.getByTestId('problems-empty')).toHaveTextContent('No problems match your filters.');
    fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
    expect(rows()).toHaveLength(4);
  });

  it('retains a file selection across rescans without hiding a clean scan', () => {
    render(<ProblemsPanel />);
    select('Location', 'C:/mod/npc/a.d');
    act(() => { useProblemsStore.setState({ problems: [problems[0]] }); });
    expect(screen.getByTestId('problems-empty')).toHaveTextContent('No problems match your filters.');
    expect(screen.getByRole('combobox', { name: /^Location/ })).toHaveTextContent('C:/mod/npc/a.d');
    act(() => { useProblemsStore.setState({ problems: [] }); });
    expect(screen.getByTestId('problems-empty')).toHaveTextContent('No problems found.');
  });
});
