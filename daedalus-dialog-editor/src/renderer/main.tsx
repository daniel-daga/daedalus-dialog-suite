import React, { useMemo, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import App from './App';
import { themes, THEME_STORAGE_KEY, ThemeMode } from './theme';
import { ThemeModeContext } from './themeContext';

// Browser mode: outside Electron there is no preload, so the dev shim stands in
// for the main process (the Playwright harness runs against the Vite dev
// server). Gated on DEV so the production build drops the shim — Vite replaces
// `import.meta.env.DEV` with a constant and Rollup removes the dead branch,
// dynamic import and all (§3 P3; pinned by tests/bundleContents.test.ts).
async function installBrowserMockApi(): Promise<void> {
  // Two plain guards, not one `||`: Rollup only proves the tail unreachable
  // when the constant stands alone in its own `if`.
  if (!import.meta.env.DEV) return;
  if (window.editorAPI) return;
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

void installBrowserMockApi().then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <Root />
    </React.StrictMode>,
  );
});
