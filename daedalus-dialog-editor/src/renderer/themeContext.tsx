import React, { createContext, useContext } from 'react';
import { ThemeMode } from './theme';

interface ThemeContextValue {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
}

export const ThemeModeContext = createContext<ThemeContextValue | null>(null);

export const useThemeMode = (): ThemeContextValue => {
  const context = useContext(ThemeModeContext);
  if (!context) {
    throw new Error('useThemeMode must be used within ThemeModeContext provider');
  }
  return context;
};
