import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import ConditionCard from '../src/renderer/components/ConditionCard';
import DialogPropertiesSection from '../src/renderer/components/DialogPropertiesSection';
import CreateTopicRenderer from '../src/renderer/components/actionRenderers/CreateTopicRenderer';
import PlayAniActionRenderer from '../src/renderer/components/actionRenderers/PlayAniActionRenderer';
import StopProcessInfosActionRenderer from '../src/renderer/components/actionRenderers/StopProcessInfosActionRenderer';

const capturedAutocompleteProps: any[] = [];

jest.mock('../src/renderer/components/common/VariableAutocomplete', () => {
  return function MockVariableAutocomplete(props: any) {
    capturedAutocompleteProps.push(props);
    return <div data-testid={`autocomplete-${props.label}`}>{props.label}</div>;
  };
});

describe('Autocomplete policy wiring', () => {
  beforeEach(() => {
    capturedAutocompleteProps.length = 0;
  });

  test('ConditionCard NpcKnowsInfoCondition uses NPC and dialog policies', () => {
    render(
      <ConditionCard
        condition={{
          type: 'NpcKnowsInfoCondition',
          npc: 'Diego',
          dialogRef: 'DIA_Diego_Hello'
        } as any}
        index={0}
        totalConditions={1}
        updateCondition={jest.fn()}
        deleteCondition={jest.fn()}
        focusCondition={jest.fn()}
      />
    );

    expect(screen.getByTestId('autocomplete-NPC')).toBeInTheDocument();
    expect(screen.getByTestId('autocomplete-Dialog')).toBeInTheDocument();

    const npcProps = capturedAutocompleteProps.find((p) => p.label === 'NPC');
    const dialogProps = capturedAutocompleteProps.find((p) => p.label === 'Dialog');

    expect(npcProps.showInstances).toBe(true);
    expect(npcProps.typeFilter).toBe('C_NPC');
    expect(dialogProps.showInstances).toBe(true);
    expect(dialogProps.showDialogs).toBe(true);
    expect(dialogProps.typeFilter).toBe('C_INFO');
    expect(dialogProps.namePrefix).toBe('DIA_');
  });

  test('ConditionCard NpcHasItemsCondition item field uses item instance policy', () => {
    render(
      <ConditionCard
        condition={{
          type: 'NpcHasItemsCondition',
          npc: 'Diego',
          item: 'ITFO_APPLE',
          operator: '>=',
          value: 1
        } as any}
        index={0}
        totalConditions={1}
        updateCondition={jest.fn()}
        deleteCondition={jest.fn()}
        focusCondition={jest.fn()}
      />
    );

    const itemProps = capturedAutocompleteProps.find((p) => p.label === 'Item');
    expect(itemProps.showInstances).toBe(true);
    expect(itemProps.typeFilter).toBe('C_ITEM');
  });

  test('DialogPropertiesSection uses expected NPC and description policies', () => {
    render(
      <DialogPropertiesSection
        dialog={{
          properties: {
            npc: '',
            description: ''
          }
        } as any}
        propertiesExpanded
        onToggleExpanded={jest.fn()}
        onDialogPropertyChange={jest.fn()}
      />
    );

    const npcProps = capturedAutocompleteProps.find((p) => p.label === 'NPC');
    const descriptionProps = capturedAutocompleteProps.find((p) => p.label === 'Description');

    expect(npcProps.showInstances).toBe(true);
    expect(npcProps.typeFilter).toBe('C_NPC');
    expect(descriptionProps.typeFilter).toBe('string');
    expect(descriptionProps.namePrefix).toBe('DIALOG_');
  });

  test('CreateTopicRenderer uses TOPIC_ string policy', () => {
    render(
      <CreateTopicRenderer
        action={{ topic: 'TOPIC_TEST' } as any}
        handleUpdate={jest.fn()}
        handleDelete={jest.fn()}
        flushUpdate={jest.fn()}
        handleKeyDown={jest.fn()}
        mainFieldRef={{ current: null }}
      />
    );

    const topicProps = capturedAutocompleteProps.find((p) => p.label === 'Topic');
    expect(topicProps.typeFilter).toBe('string');
    expect(topicProps.namePrefix).toBe('TOPIC_');
  });

  test('PlayAni and StopProcessInfos intentionally do not include instance suggestions', () => {
    render(
      <PlayAniActionRenderer
        action={{ target: 'self' } as any}
        handleUpdate={jest.fn()}
        handleDelete={jest.fn()}
        flushUpdate={jest.fn()}
        handleKeyDown={jest.fn()}
        mainFieldRef={{ current: null }}
      />
    );

    render(
      <StopProcessInfosActionRenderer
        action={{ target: 'self' } as any}
        handleUpdate={jest.fn()}
        handleDelete={jest.fn()}
        flushUpdate={jest.fn()}
        handleKeyDown={jest.fn()}
        mainFieldRef={{ current: null }}
      />
    );

    const targetProps = capturedAutocompleteProps.filter((p) => p.label === 'Target' && p.value === 'self');
    const playAniTargetProps = targetProps[0];
    expect(playAniTargetProps.typeFilter).toBe('C_NPC');
    expect(playAniTargetProps.showInstances).not.toBe(true);

    const stopTargetProps = targetProps[targetProps.length - 1];
    expect(stopTargetProps.typeFilter).toBe('C_NPC');
    expect(stopTargetProps.showInstances).not.toBe(true);
  });
});
