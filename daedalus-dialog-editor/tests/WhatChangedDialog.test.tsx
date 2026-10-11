import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import WhatChangedDialog from '../src/renderer/components/WhatChangedDialog';

describe('WhatChangedDialog', () => {
  beforeEach(() => localStorage.clear());

  test('shows the changes and issue numbers once for each build', async () => {
    const user = userEvent.setup();
    const changes = [
      { issue: 123, description: 'Edit dialog routines faster' },
      { issue: 124, description: 'Fix world save feedback' },
    ];

    const { rerender } = render(<WhatChangedDialog version="0.1.0-build.21" changes={changes} />);

    expect(await screen.findByRole('dialog', { name: 'What changed' })).toBeVisible();
    expect(screen.getByText('Edit dialog routines faster')).toBeVisible();
    expect(screen.getByText('#123')).toBeVisible();
    expect(screen.getByText('Fix world save feedback')).toBeVisible();
    expect(screen.getByText('#124')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Got it' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'What changed' })).not.toBeInTheDocument());

    rerender(<WhatChangedDialog version="0.1.0-build.21" changes={changes} />);
    expect(screen.queryByRole('dialog', { name: 'What changed' })).not.toBeInTheDocument();

    rerender(<WhatChangedDialog version="0.1.0-build.22" changes={changes} />);
    expect(await screen.findByRole('dialog', { name: 'What changed' })).toBeVisible();
  });
});
