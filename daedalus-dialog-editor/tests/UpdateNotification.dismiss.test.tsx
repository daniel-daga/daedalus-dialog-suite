import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import UpdateNotification from '../src/renderer/components/UpdateNotification';

/**
 * The persisted `dismissedVersion` is only useful if the renderer writes it:
 * without this the dialog re-prompts for the same build on every launch
 * (production review §2, "Updater loose ends").
 */
describe('UpdateNotification dismissal', () => {
  const dismissUpdateVersion = jest.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    jest.clearAllMocks();
    (window as any).editorAPI = {
      checkForUpdate: jest.fn().mockResolvedValue({
        updateAvailable: true,
        currentVersion: '0.1.0-build.10',
        latestVersion: '0.1.0-build.20',
        latestBuildNumber: 20,
        downloadUrl: 'https://example.com/installer.exe',
      }),
      onDownloadProgress: jest.fn().mockReturnValue(() => {}),
      dismissUpdateVersion,
    };
  });

  test('skipping the offered version persists it', async () => {
    const user = userEvent.setup();
    render(<UpdateNotification triggerCheck />);

    await user.click(await screen.findByText('Update available: 0.1.0-build.20'));
    await user.click(await screen.findByRole('button', { name: 'Skip This Version' }));

    await waitFor(() => {
      expect(dismissUpdateVersion).toHaveBeenCalledWith('0.1.0-build.20');
    });
  });
});
