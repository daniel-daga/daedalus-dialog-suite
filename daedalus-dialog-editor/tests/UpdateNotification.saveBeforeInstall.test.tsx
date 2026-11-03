import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import UpdateNotification from '../src/renderer/components/UpdateNotification';
import { useFileStore } from '../src/renderer/store/fileStore';
import { useWorldStore } from '../src/renderer/store/worldStore';

/**
 * The install exits the process without going through the close guard, so a
 * dirty file has to be written first — otherwise "Install & Restart" quietly
 * discards it (#475). The open world owns its own save flow and is lost the
 * same way (#517).
 */
describe('UpdateNotification save before install', () => {
  const installUpdate = jest.fn().mockResolvedValue(undefined);
  const saveWorld = jest.fn().mockResolvedValue(undefined);

  const seedFile = (overrides: Record<string, unknown> = {}) => {
    useFileStore.setState({
      openFiles: new Map([['C:/mod/DIA_Test.d', { isDirty: true, externalConflict: false, ...overrides }]]),
      saveFile: jest.fn().mockResolvedValue({ success: true }),
    } as any);
  };

  const reachInstallButton = async () => {
    const user = userEvent.setup();
    render(<UpdateNotification triggerCheck />);
    await user.click(await screen.findByText('Update available: 0.1.0-build.20'));
    await user.click(await screen.findByRole('button', { name: 'Download & Install' }));
    return user;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    seedFile();
    saveWorld.mockReset().mockResolvedValue(undefined);
    useWorldStore.setState({ hasUnsavedEdits: false } as any);
    (window as any).editorAPI = {
      checkForUpdate: jest.fn().mockResolvedValue({
        updateAvailable: true,
        currentVersion: '0.1.0-build.10',
        latestVersion: '0.1.0-build.20',
        latestBuildNumber: 20,
        downloadUrl: 'https://example.com/installer.exe',
      }),
      onDownloadProgress: jest.fn().mockReturnValue(() => {}),
      downloadUpdate: jest.fn().mockResolvedValue('C:/tmp/installer.exe'),
      installUpdate,
      saveWorld,
    };
  });

  test('a dirty file is saved before the installer runs', async () => {
    const user = await reachInstallButton();
    await user.click(await screen.findByRole('button', { name: 'Install & Restart' }));

    const saveFile = useFileStore.getState().saveFile as jest.Mock;
    await waitFor(() => expect(installUpdate).toHaveBeenCalledWith('C:/tmp/installer.exe'));
    expect(saveFile).toHaveBeenCalledWith('C:/mod/DIA_Test.d');
    expect(saveFile.mock.invocationCallOrder[0]).toBeLessThan(installUpdate.mock.invocationCallOrder[0]);
  });

  test('a failed save stops the install and says so', async () => {
    seedFile();
    (useFileStore.getState().saveFile as jest.Mock).mockResolvedValue({ success: false });

    const user = await reachInstallButton();
    await user.click(await screen.findByRole('button', { name: 'Install & Restart' }));

    await screen.findByText(/Could not save C:\/mod\/DIA_Test\.d/);
    expect(installUpdate).not.toHaveBeenCalled();
  });

  test('a clean file is not saved', async () => {
    seedFile({ isDirty: false });

    const user = await reachInstallButton();
    await user.click(await screen.findByRole('button', { name: 'Install & Restart' }));

    const saveFile = useFileStore.getState().saveFile as jest.Mock;
    await waitFor(() => expect(installUpdate).toHaveBeenCalled());
    expect(saveFile).not.toHaveBeenCalled();
  });

  test('the unsaved world is saved before the installer runs', async () => {
    seedFile({ isDirty: false });
    useWorldStore.setState({ hasUnsavedEdits: true } as any);

    const user = await reachInstallButton();
    await user.click(await screen.findByRole('button', { name: 'Install & Restart' }));

    await waitFor(() => expect(installUpdate).toHaveBeenCalledWith('C:/tmp/installer.exe'));
    expect(saveWorld).toHaveBeenCalledTimes(1);
    expect(saveWorld.mock.invocationCallOrder[0]).toBeLessThan(installUpdate.mock.invocationCallOrder[0]);
    expect(useWorldStore.getState().hasUnsavedEdits).toBe(false);
  });

  test('a failed world save stops the install and says why', async () => {
    seedFile({ isDirty: false });
    useWorldStore.setState({ hasUnsavedEdits: true } as any);
    saveWorld.mockRejectedValue(new Error('world writer failed'));

    const user = await reachInstallButton();
    await user.click(await screen.findByRole('button', { name: 'Install & Restart' }));

    await screen.findByText(/Could not save the world.*world writer failed/);
    expect(installUpdate).not.toHaveBeenCalled();
    expect(useWorldStore.getState().hasUnsavedEdits).toBe(true);
  });

  test('a clean world is not saved', async () => {
    seedFile({ isDirty: false });

    const user = await reachInstallButton();
    await user.click(await screen.findByRole('button', { name: 'Install & Restart' }));

    await waitFor(() => expect(installUpdate).toHaveBeenCalled());
    expect(saveWorld).not.toHaveBeenCalled();
  });
});
