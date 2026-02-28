import React, { useMemo, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import NodeEditorPlayground from './NodeEditorPlayground';
import { themes, THEME_STORAGE_KEY, ThemeMode } from './theme';
import { ThemeModeContext } from './themeContext';

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
