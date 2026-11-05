import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { useProjectStore } from '../src/renderer/store/projectStore';
import { resetMockFileSystem } from '../src/renderer/utils/mockAPI';
import CreateNpcDialog from '../src/renderer/components/CreateNpcDialog';

/**
 * #428: the guild is picked from the project's `GIL_` constants — the same
 * options the NPC editor's Guild control offers — rather than typed free-hand.
 */

const template = `INSTANCE BAU_900_Onar (C_NPC)
{
	name = "Onar";
	guild = GIL_BAU;
	id = 900;
};
`;

const constant = (name: string, value: number) => ({ name, type: 'int', value, sourceText: '', range: null });

beforeEach(() => {
  resetMockFileSystem();
  useProjectStore.setState({
    npcList: ['BAU_900_Onar'],
    npcFileIndex: { BAU_900_ONAR: 'npc/onar.d' },
    projectPath: 'C:/mod',
    parseGeneration: 1,
    parsedFiles: new Map([
      ['C:/mod/Constants.d', {
        filePath: 'C:/mod/Constants.d',
        lastParsed: new Date(),
        semanticModel: {
          dialogs: {},
          functions: {},
          constants: {
            GIL_BAU: constant('GIL_BAU', 1),
            GIL_NONE: constant('GIL_NONE', 0),
            GIL_VLK: constant('GIL_VLK', 2),
            NPC_FLAG_IMMORTAL: constant('NPC_FLAG_IMMORTAL', 2),
          },
        },
      }],
    ]),
    getSemanticModel: jest.fn().mockResolvedValue({
      dialogs: {},
      functions: {},
      instances: { BAU_900_ONAR: { name: 'BAU_900_Onar', parent: 'C_NPC', sourceText: template } },
    }),
  } as never);
});

const renderDialog = () => render(
  <CreateNpcDialog initialTemplate="BAU_900_Onar" onClose={jest.fn()} onCreated={jest.fn()} />,
);

it('offers the project guild constants and nothing else', async () => {
  renderDialog();

  const guild = await screen.findByLabelText('Guild');
  await waitFor(() => expect(guild).toHaveValue('GIL_BAU'));
  fireEvent.focus(guild);

  const offered = (await screen.findAllByRole('option')).map((option) => option.textContent);
  expect(offered).toEqual(['GIL_BAU', 'GIL_NONE', 'GIL_VLK']);
});

it('takes the guild chosen from the list', async () => {
  renderDialog();

  const guild = await screen.findByLabelText('Guild');
  await waitFor(() => expect(guild).toHaveValue('GIL_BAU'));
  fireEvent.focus(guild);
  fireEvent.click(await screen.findByRole('option', { name: 'GIL_VLK' }));

  expect(guild).toHaveValue('GIL_VLK');
});

it('still takes a guild typed by hand', async () => {
  renderDialog();

  const guild = await screen.findByLabelText('Guild');
  await waitFor(() => expect(guild).toHaveValue('GIL_BAU'));
  fireEvent.change(guild, { target: { value: 'GIL_OC' } });
  fireEvent.blur(guild);

  expect(guild).toHaveValue('GIL_OC');
});
