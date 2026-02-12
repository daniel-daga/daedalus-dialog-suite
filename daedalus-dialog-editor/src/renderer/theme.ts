import { createTheme, Theme } from '@mui/material/styles';

export type ThemeMode = 'dark' | 'light' | 'gothic';

const sharedShape = {
  borderRadius: 8,
};

const gothicTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#c8a25a',
      light: '#dfc087',
      dark: '#8b6a2a',
      contrastText: '#1b1310',
    },
    secondary: {
      main: '#8f3f3f',
      light: '#ba6969',
      dark: '#662a2a',
    },
    background: {
      default: '#131010',
      paper: '#1f1918',
    },
    text: {
      primary: '#f4e6cc',
      secondary: '#c4b297',
    },
    divider: 'rgba(200, 162, 90, 0.24)',
  },
  shape: sharedShape,
  typography: {
    fontFamily: '"Cinzel", "Bookman Old Style", "Times New Roman", serif',
    h6: {
      letterSpacing: '0.08em',
      fontWeight: 600,
      textTransform: 'uppercase',
    },
    button: {
      letterSpacing: '0.06em',
      fontWeight: 700,
    },
  },
  components: {
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundImage: 'linear-gradient(180deg, #3a2a20 0%, #201613 100%)',
          borderBottom: '1px solid rgba(200, 162, 90, 0.45)',
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'linear-gradient(180deg, rgba(255,255,255,0.02) 0%, rgba(0,0,0,0.18) 100%)',
          border: '1px solid rgba(200, 162, 90, 0.14)',
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          border: '1px solid rgba(200, 162, 90, 0.35)',
        },
      },
    },
  },
});

const darkTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#90caf9',
    },
    secondary: {
      main: '#f48fb1',
    },
  },
  shape: sharedShape,
});

const lightTheme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#1565c0',
    },
    secondary: {
      main: '#8e24aa',
    },
    background: {
      default: '#f4f6fb',
      paper: '#ffffff',
    },
  },
  shape: sharedShape,
});

export const themes: Record<ThemeMode, Theme> = {
  dark: darkTheme,
  light: lightTheme,
  gothic: gothicTheme,
};

export const THEME_STORAGE_KEY = 'dandelion-theme';
