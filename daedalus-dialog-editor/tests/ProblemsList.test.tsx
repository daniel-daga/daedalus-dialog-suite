import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import ProblemsList from '../src/renderer/components/Problems/ProblemsList';
import type { Problem } from '../src/renderer/problems/domain/types';

const problems: Problem[] = [
  {
    id: 'npc-not-found:a.d:DIA_X',
    rule: 'npc-not-found',
    severity: 'error',
    message: 'Dialog "DIA_X" references NPC "Nobody", which is not defined in the project.',
    locus: { kind: 'script', filePath: 'Story/Dialoge/a.d', dialogName: 'DIA_X', npc: 'Nobody' }
  },
  {
    id: 'orphaned-function:b.d:Helper',
    rule: 'orphaned-function',
    severity: 'warning',
    message: 'Function "Helper" is not referenced by any dialog, choice, or function call.',
    locus: { kind: 'script', filePath: 'Story/Dialoge/b.d', functionName: 'Helper' }
  }
];

describe('ProblemsList', () => {
  it('renders one navigable row per problem with severity and rule chips', () => {
    render(<ProblemsList problems={problems} onSelect={() => {}} />);

    expect(screen.getByTestId('problem-row-0')).toHaveTextContent('references NPC "Nobody"');
    expect(screen.getByTestId('problem-row-0')).toHaveTextContent('Error');
    expect(screen.getByTestId('problem-row-0')).toHaveTextContent('Missing NPC');
    expect(screen.getByTestId('problem-row-0')).toHaveTextContent('a.d · DIA_X');

    expect(screen.getByTestId('problem-row-1')).toHaveTextContent('Warning');
    expect(screen.getByTestId('problem-row-1')).toHaveTextContent('Orphaned function');
    expect(screen.getByTestId('problem-row-1')).toHaveTextContent('b.d · Helper');
  });

  it('invokes onSelect with the clicked problem', () => {
    const onSelect = jest.fn();
    render(<ProblemsList problems={problems} onSelect={onSelect} />);

    fireEvent.click(screen.getByTestId('problem-row-1'));

    expect(onSelect).toHaveBeenCalledWith(problems[1]);
  });

  it('shows an empty state when there are no problems', () => {
    render(<ProblemsList problems={[]} onSelect={() => {}} />);

    expect(screen.getByTestId('problems-empty')).toBeInTheDocument();
  });
});
