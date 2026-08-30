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

/**
 * `waypoint-not-in-world` is the one rule whose finding names a place the open
 * world could actually gain — `AddWaypoint` takes a name and a point, and the
 * name is right here in the locus. The row's own click still goes to the
 * script (the name may belong to another world, §16.8), so this is a second,
 * explicit action rather than a change to what the row's click does.
 */
describe('the "Add to world" action on a waypoint-not-in-world row', () => {
  const waypointProblem: Problem = {
    id: 'waypoint-not-in-world:Rtn.d:Rtn_Start_Diego:OW_PATH_42',
    rule: 'waypoint-not-in-world',
    severity: 'warning',
    message: 'Waypoint "OW_PATH_42" is not in the open world. It may belong to another world.',
    locus: {
      kind: 'script', filePath: 'Story/Routines/Rtn.d', functionName: 'Rtn_Start_Diego', waypoint: 'OW_PATH_42',
    },
  };

  it('is offered while a world is open', () => {
    render(
      <ProblemsList
        problems={[waypointProblem]}
        onSelect={() => {}}
        worldOpen
        onAddToWorld={() => {}}
      />,
    );

    expect(screen.getByTestId('problem-row-0-add-to-world')).toBeInTheDocument();
  });

  it('calls onAddToWorld with the waypoint name, not onSelect', () => {
    const onSelect = jest.fn();
    const onAddToWorld = jest.fn();
    render(
      <ProblemsList
        problems={[waypointProblem]}
        onSelect={onSelect}
        worldOpen
        onAddToWorld={onAddToWorld}
      />,
    );

    fireEvent.click(screen.getByTestId('problem-row-0-add-to-world'));

    expect(onAddToWorld).toHaveBeenCalledWith('OW_PATH_42');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('is withheld while no world is open — there is nothing to add it to', () => {
    render(
      <ProblemsList
        problems={[waypointProblem]}
        onSelect={() => {}}
        onAddToWorld={() => {}}
      />,
    );

    expect(screen.queryByTestId('problem-row-0-add-to-world')).not.toBeInTheDocument();
  });

  it('is withheld from every other rule, which names no addable place', () => {
    render(
      <ProblemsList
        problems={problems}
        onSelect={() => {}}
        worldOpen
        onAddToWorld={() => {}}
      />,
    );

    expect(screen.queryByTestId('problem-row-0-add-to-world')).not.toBeInTheDocument();
    expect(screen.queryByTestId('problem-row-1-add-to-world')).not.toBeInTheDocument();
  });
});
