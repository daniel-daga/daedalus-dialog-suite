import React, { useMemo, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import NodeEditorPlayground from './NodeEditorPlayground';
import { themes, THEME_STORAGE_KEY, ThemeMode } from './theme';
import { ThemeModeContext } from './themeContext';

// Match main.tsx: expose the quest-graph debug surface in the dev/test node-editor
// playground so the manual smoke pass can inspect viewport/render counters.
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
        <NodeEditorPlayground />
      </ThemeProvider>
    </ThemeModeContext.Provider>
  );
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
