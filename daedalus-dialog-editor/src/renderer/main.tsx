import React, { useMemo, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import App from './App';
import { mockEditorAPI } from './utils/mockAPI';
import { themes, THEME_STORAGE_KEY, ThemeMode } from './theme';
import { ThemeModeContext } from './themeContext';

// Browser mode detection: inject mock API if running outside Electron
if (!window.editorAPI) {
  window.editorAPI = mockEditorAPI;
}

// Expose the quest-graph debug surface only in dev/test builds (Vite dev server,
// including the Playwright `dev:browser` harness). `import.meta.env.DEV` is false
// for production `vite build` output, so the hook never ships. Set here — the only
// place `import.meta` is safe (this Vite entry is never imported by ts-jest).
const viteEnv = (import.meta as unknown as { env?: { DEV?: boolean; MODE?: string } }).env;
if (viteEnv?.DEV || viteEnv?.MODE === 'test') {
  (window as unknown as { __questGraphDebugEnabled?: boolean }).__questGraphDebugEnabled = true;
}

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

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
