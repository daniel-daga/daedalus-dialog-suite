import React from 'react';
import { render, screen } from '@testing-library/react';
import CodeDiffView from '../src/renderer/components/common/CodeDiffView';

describe('CodeDiffView', () => {
  it('renders unchanged, removed and added lines with diff markers', () => {
    render(
      <CodeDiffView
        beforeCode={'same\nold line\nend'}
        afterCode={'same\nnew line\nend'}
      />
    );

    const body = screen.getByTestId('code-diff-view');
    expect(body.textContent).toBe(' same\n-old line\n+new line\n end');
  });

  it('renders lines only present in the after side as additions', () => {
    render(<CodeDiffView beforeCode={'a'} afterCode={'a\nb'} />);

    expect(screen.getByTestId('code-diff-view').textContent).toBe(' a\n+b');
  });

  it('renders lines only present in the before side as removals', () => {
    render(<CodeDiffView beforeCode={'a\nb'} afterCode={'a'} />);

    expect(screen.getByTestId('code-diff-view').textContent).toBe(' a\n-b');
  });

  it('keeps trailing lines aligned across a deletion instead of marking them all changed', () => {
    render(
      <CodeDiffView
        beforeCode={'a\nb\nc\nd\ne'}
        afterCode={'a\nc\nd\ne'}
      />
    );

    expect(screen.getByTestId('code-diff-view').textContent).toBe(' a\n-b\n c\n d\n e');
  });

  it('keeps trailing lines aligned across an insertion instead of marking them all changed', () => {
    render(
      <CodeDiffView
        beforeCode={'a\nc\nd\ne'}
        afterCode={'a\nb\nc\nd\ne'}
      />
    );

    expect(screen.getByTestId('code-diff-view').textContent).toBe(' a\n+b\n c\n d\n e');
  });

  it('supports a custom data-testid', () => {
    render(<CodeDiffView beforeCode={'x'} afterCode={'x'} data-testid="my-diff" />);

    expect(screen.getByTestId('my-diff')).toBeInTheDocument();
  });
});
