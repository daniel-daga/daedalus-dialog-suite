/// <reference types="vite/client" />
import React, { useMemo, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import App from './App';
import ErrorBoundary, { CrashProbe } from './components/ErrorBoundary';
import { themes, THEME_STORAGE_KEY, ThemeMode } from './theme';
import { ThemeModeContext } from './themeContext';

/**
 * Browser mode: the Playwright harness runs the renderer in plain Chromium with
 * no preload, so `window.editorAPI` has to come from the mock.
 *
 * The import is dynamic and gated on `import.meta.env.DEV` because the harness
 * runs the *dev* server (`vite`, see playwright.config.ts) — production never
 * takes this path, since the preload always installs the real bridge. Vite
 * substitutes the literal `false` for `import.meta.env.DEV` in `vite build`, so
 * Rollup drops the branch and mockAPI.ts is never emitted into the shipped
 * bundle at all (it used to ride along in the entry chunk).
 */
async function installBrowserMockAPI(): Promise<void> {
  if (!import.meta.env.DEV || window.editorAPI) {
    return;
  }
  const { mockEditorAPI } = await import('./utils/mockAPI');
  window.editorAPI = mockEditorAPI;
}

// Crash logging (fix-08 §5): forward uncaught renderer errors and unhandled
// rejections to the main-process log file. Guarded on the function existing so
// the browser harness (mock provides a no-op) is unaffected.
window.onerror = (message, source, lineno, colno, error) => {
  const where = source ? ` (${source}:${lineno ?? 0}:${colno ?? 0})` : '';
  window.editorAPI?.logRendererError?.({
    message: `${typeof message === 'string' ? message : 'Unknown error'}${where}`,
    stack: error?.stack,
  });
  return false;
};

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  const error = reason instanceof Error ? reason : undefined;
  window.editorAPI?.logRendererError?.({
    message: error ? error.message : `Unhandled rejection: ${String(reason)}`,
    stack: error?.stack,
  });
});

const getInitialTheme = (): ThemeMode => {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === 'light' || stored === 'dark' || stored === 'gothic') {
    return stored;
  }
  return 'dark';
};

const Root: React.FC = () => {
  const [mode, setMode] = useState<ThemeMode>(getInitialTheme);

  const handleSetMode = (nextMode: ThemeMode) => {
    setMode(nextMode);
    localStorage.setItem(THEME_STORAGE_KEY, nextMode);
  };

  const themeContextValue = useMemo(
    () => ({ mode, setMode: handleSetMode }),
    [mode],
  );

  return (
    <ThemeModeContext.Provider value={themeContextValue}>
      <ThemeProvider theme={themes[mode]}>
        <CssBaseline />
        <App />
      </ThemeProvider>
    </ThemeModeContext.Provider>
  );
};

void installBrowserMockAPI().then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      {/* Outermost boundary. The boundaries inside App cannot catch App's own
          render (its store selectors, its hooks), so without this one a throw
          there still blanks the window. */}
      <ErrorBoundary label="app-root">
        <CrashProbe id="app-root" />
        <Root />
      </ErrorBoundary>
    </React.StrictMode>,
  );
});
