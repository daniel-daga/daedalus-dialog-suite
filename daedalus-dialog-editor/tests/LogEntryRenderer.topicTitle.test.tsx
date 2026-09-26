/**
 * #278: the diary shows a topic by its title, not its constant name — the
 * "Lehrer" a user files a note under is `TOPIC_CityTeacher = "Lehrer in der
 * Stadt"`. The Log Entry card names the title so the user can see where the
 * entry lands.
 */
import React from 'react';
import { render, screen, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import LogEntryRenderer from '../src/renderer/components/actionRenderers/LogEntryRenderer';
import { useProjectStore } from '../src/renderer/store/projectStore';

const modelWith = (constants: Record<string, unknown>) => ({
  dialogs: {}, functions: {}, constants, variables: {},
  instances: {}, items: {}, npcs: {}, animations: {},
  hasErrors: false, errors: []
});

const renderEntry = (topic: string) =>
  render(
    <LogEntryRenderer
      {...({
        action: { type: 'LogEntry', topic, text: 'Harad lehrt mich Schmieden.' },
        index: 0,
        totalActions: 1,
        npcName: 'Harad',
        handleUpdate: jest.fn(),
        handleDelete: jest.fn(),
        flushUpdate: jest.fn(),
        handleKeyDown: jest.fn(),
        mainFieldRef: { current: null }
      } as any)}
    />
  );

describe('LogEntryRenderer topic title', () => {
  beforeEach(() => {
    useProjectStore.setState({
      mergedSemanticModel: modelWith({
        TOPIC_CityTeacher: { name: 'TOPIC_CityTeacher', type: 'string', value: '"Lehrer in der Stadt"' }
      }) as any
    });
  });

  test('shows the diary title of a known topic', () => {
    renderEntry('TOPIC_CityTeacher');
    expect(screen.getByText('In the diary under "Lehrer in der Stadt"')).toBeInTheDocument();
  });

  test('shows nothing for a topic the project does not declare', () => {
    renderEntry('TOPIC_Unknown');
    expect(screen.queryByText(/In the diary under/)).not.toBeInTheDocument();
  });

  test('follows the project when the title changes', () => {
    renderEntry('TOPIC_CityTeacher');
    act(() => {
      useProjectStore.setState({
        mergedSemanticModel: modelWith({
          TOPIC_CityTeacher: { name: 'TOPIC_CityTeacher', type: 'string', value: '"Lehrer in Khorinis"' }
        }) as any
      });
    });
    expect(screen.getByText('In the diary under "Lehrer in Khorinis"')).toBeInTheDocument();
  });
});
