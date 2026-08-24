/**
 * `ErrorBoundary` crash reporting (§2 blocker 6).
 *
 * `window.onerror` / `unhandledrejection` in main.tsx never see an error a
 * boundary catches — React swallows it into `componentDidCatch`. So a caught
 * crash left no trace at all in the log file, which is the worst case: the app
 * looks half-alive to the user and the log says nothing happened.
 *
 * The reporting lives in the boundary itself rather than in an `onError` prop
 * at each call site, so a boundary cannot be added without it; the `label`
 * identifies which part of the window failed.
 */

import * as fs from 'fs';
import * as path from 'path';
import React from 'react';
import { render, screen } from '@testing-library/react';
import ErrorBoundary, { CrashProbe } from '../src/renderer/components/ErrorBoundary';

const Boom: React.FC = () => {
  throw new Error('kaboom');
};

describe('ErrorBoundary crash reporting', () => {
  let logRendererError: jest.Mock;
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    logRendererError = jest.fn().mockResolvedValue(undefined);
    (window as unknown as { editorAPI: unknown }).editorAPI = { logRendererError };
    // React prints the caught error; silence it so the suite output stays readable.
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
    delete (window as unknown as { editorAPI?: unknown }).editorAPI;
  });

  it('reports a caught crash through the renderer-error log channel', () => {
    render(
      <ErrorBoundary label="workspace">
        <Boom />
      </ErrorBoundary>
    );

    expect(logRendererError).toHaveBeenCalledTimes(1);
    const payload = logRendererError.mock.calls[0][0] as { message: string; stack?: string };
    expect(payload.message).toContain('[workspace]');
    expect(payload.message).toContain('kaboom');
    // The component stack is what makes a caught crash diagnosable at all.
    expect(payload.stack).toContain('Boom');
  });

  it('still renders the fallback and calls onError', () => {
    const onError = jest.fn();
    render(
      <ErrorBoundary label="overlays" fallback={<div>fallback shown</div>} onError={onError}>
        <Boom />
      </ErrorBoundary>
    );

    expect(screen.getByText('fallback shown')).toBeInTheDocument();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(logRendererError).toHaveBeenCalledTimes(1);
  });

  it('renders children untouched when nothing throws, and logs nothing', () => {
    render(
      <ErrorBoundary label="chrome">
        <div>all good</div>
      </ErrorBoundary>
    );

    expect(screen.getByText('all good')).toBeInTheDocument();
    expect(logRendererError).not.toHaveBeenCalled();
  });
});

describe('CrashProbe', () => {
  const setSearch = (search: string): void => {
    window.history.replaceState({}, '', search || window.location.pathname);
  };

  afterEach(() => setSearch(''));

  it('is inert unless armed for its own id', () => {
    setSearch('?crash=chrome');
    const { container } = render(<CrashProbe id="workspace" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('throws when armed for its id, so a boundary test crashes for real', () => {
    setSearch('?crash=workspace');
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<CrashProbe id="workspace" />)).toThrow(/forced render crash in "workspace"/);
    consoleError.mockRestore();
  });

  it('folds away in production builds', () => {
    // Vite replaces `process.env.NODE_ENV` with the literal "production" in the
    // renderer build, so this guard is what makes the probe dead code there.
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'renderer', 'components', 'ErrorBoundary.tsx'),
      'utf8'
    );
    const probeIndex = source.indexOf('export const CrashProbe');
    const bodyIndex = source.indexOf('=> {', probeIndex);
    expect(source.slice(bodyIndex, source.indexOf('crash', bodyIndex))).toContain(
      "process.env.NODE_ENV === 'production'"
    );
  });
});
