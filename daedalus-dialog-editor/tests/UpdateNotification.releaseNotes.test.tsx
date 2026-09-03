import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import UpdateNotification from '../src/renderer/components/UpdateNotification';

/**
 * "View release notes" was `href="#"` with an empty click handler — a dead
 * link, because there was no channel to the system browser (production
 * review §2, "Updater loose ends"). It opens the release URL through
 * `editorAPI.openExternal` now.
 */
describe('UpdateNotification release notes', () => {
  const RELEASE_URL = 'https://github.com/example/dde/releases/tag/v0.1.0-build.20';
  const openExternal = jest.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    jest.clearAllMocks();
    (window as any).editorAPI = {
      checkForUpdate: jest.fn().mockResolvedValue({
        updateAvailable: true,
        currentVersion: '0.1.0-build.10',
        latestVersion: '0.1.0-build.20',
        latestBuildNumber: 20,
        downloadUrl: 'https://example.com/installer.exe',
        releaseUrl: RELEASE_URL,
      }),
      onDownloadProgress: jest.fn().mockReturnValue(() => {}),
      dismissUpdateVersion: jest.fn().mockResolvedValue(undefined),
      openExternal,
    };
  });

  test('the link opens the release URL', async () => {
    const user = userEvent.setup();
    render(<UpdateNotification triggerCheck />);

    await user.click(await screen.findByText('Update available: 0.1.0-build.20'));
    const link = await screen.findByRole('link', { name: 'View release notes' });
    expect(link).toHaveAttribute('href', RELEASE_URL);

    await user.click(link);
    await waitFor(() => expect(openExternal).toHaveBeenCalledWith(RELEASE_URL));
  });
});
