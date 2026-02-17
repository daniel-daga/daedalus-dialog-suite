import React from 'react';
import { render, screen } from '@testing-library/react';
import QuestDiffPreviewDialog from '../src/renderer/components/QuestEditor/Inspector/QuestDiffPreviewDialog';

describe('QuestDiffPreviewDialog', () => {
  it('renders guardrail warnings when provided', () => {
    render(
      <QuestDiffPreviewDialog
        open
        beforeCode={'func old();'}
        afterCode={'func new();'}
        warnings={[{ message: 'Shared MIS dependency introduced' }]}
        onClose={jest.fn()}
        onApply={jest.fn()}
        isApplying={false}
      />
    );

    expect(screen.getByText('Shared MIS dependency introduced')).toBeInTheDocument();
  });

  it('renders per-file previews when fileDiffs are provided', () => {
    render(
      <QuestDiffPreviewDialog
        open
        beforeCode={'combined-before'}
        afterCode={'combined-after'}
        fileDiffs={[
          {
            filePath: 'C:/tmp/source.d',
            beforeCode: 'func old_source();',
            afterCode: 'func new_source();'
          },
          {
            filePath: 'C:/tmp/target.d',
            beforeCode: 'func old_target();',
            afterCode: 'func new_target();'
          }
        ]}
        onClose={jest.fn()}
        onApply={jest.fn()}
        isApplying={false}
      />
    );

    expect(screen.getByText('C:/tmp/source.d')).toBeInTheDocument();
    expect(screen.getByText('C:/tmp/target.d')).toBeInTheDocument();
  });

  it('disables apply when a blocking warning is present', () => {
    render(
      <QuestDiffPreviewDialog
        open
        beforeCode={'func old();'}
        afterCode={'func new();'}
        warnings={[{ message: 'Blocking warning', blocking: true }]}
        onClose={jest.fn()}
        onApply={jest.fn()}
        isApplying={false}
      />
    );

    expect(screen.getByText('Apply')).toBeDisabled();
  });
});
