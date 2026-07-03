import React from 'react';
import { describe, it, expect, beforeEach } from '@jest/globals';
import { render, act } from '@testing-library/react';
import { useNpcDialogErrors } from '../src/renderer/components/hooks/useNpcDialogErrors';
import { useProjectStore } from '../src/renderer/store/projectStore';
import type { DialogMetadata } from '../src/renderer/types/global';

/**
 * §2.5 item C: useNpcDialogErrors owns its own narrow `parsedFiles`
 * subscription (only the selected NPC's file entries, compared with shallow),
 * so an ingestion flush that only replaces an unrelated NPC's parsed entry
 * must not re-render its consumers — while a change to the selected NPC's own
 * file must. Fails pre-fix (the hook took parsedFiles as a prop and held no
 * store subscription of its own).
 */
describe('useNpcDialogErrors narrow subscription', () => {
  const dialogIndex = new Map<string, DialogMetadata[]>([
    ['NPC_A', [{ dialogName: 'DIA_A', filePath: '/a.d' } as DialogMetadata]],
    ['NPC_B', [{ dialogName: 'DIA_B', filePath: '/b.d' } as DialogMetadata]],
  ]);

  beforeEach(() => {
    useProjectStore.setState({ parsedFiles: new Map(), dialogIndex });
  });

  const renderProbe = () => {
    let commits = 0;
    let lastHasErrors = false;
    const Probe: React.FC = () => {
      const { hasNpcDialogErrors } = useNpcDialogErrors({
        isProjectMode: true,
        selectedNPC: 'NPC_A',
        dialogIndex,
      });
      commits += 1;
      lastHasErrors = hasNpcDialogErrors;
      return null;
    };
    render(<Probe />);
    return { getCommits: () => commits, getHasErrors: () => lastHasErrors };
  };

  it('ignores parsedFiles changes for other NPCs but reacts to its own NPC', () => {
    const probe = renderProbe();
    const afterMount = probe.getCommits();

    // Unrelated NPC (NPC_B) file arrives — must not re-render NPC_A's consumer.
    act(() => {
      useProjectStore.setState({
        parsedFiles: new Map([['/b.d', { semanticModel: { hasErrors: false, errors: [] } } as never]]),
      });
    });
    expect(probe.getCommits()).toBe(afterMount);

    // The selected NPC's own file arrives with a parse error — must re-render.
    act(() => {
      useProjectStore.setState({
        parsedFiles: new Map([
          ['/b.d', { semanticModel: { hasErrors: false, errors: [] } } as never],
          ['/a.d', { semanticModel: { hasErrors: true, errors: [{ message: 'boom' }] } } as never],
        ]),
      });
    });
    expect(probe.getCommits()).toBeGreaterThan(afterMount);
    expect(probe.getHasErrors()).toBe(true);
  });
});
