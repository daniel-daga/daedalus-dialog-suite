import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import ErrorBoundary from '../src/renderer/components/ErrorBoundary';

const Boom: React.FC = () => {
  throw new Error('render exploded');
};

/**
 * A render error caught by a boundary never reaches `window.onerror`, so
 * without this the crash is absent from the log file the "Show log file"
 * button opens (production review §2, error-boundary gap).
 */
describe('ErrorBoundary crash logging', () => {
  const logRendererError = jest.fn().mockResolvedValue(undefined);
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    (window as any).editorAPI = { logRendererError };
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  test('forwards the caught error and its component stack to the main log', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(logRendererError).toHaveBeenCalledTimes(1);
    const payload = logRendererError.mock.calls[0][0];
    expect(payload.message).toContain('render exploded');
    expect(payload.stack).toContain('Boom');
  });
});
