import { alpha, createTheme, Theme } from '@mui/material/styles';

export type ThemeMode = 'dark' | 'light' | 'gothic';

const sharedShape = {
  borderRadius: 12,
};

const sharedComponents = {
  MuiCssBaseline: {
    styleOverrides: {
      html: {
        fontSize: '80%',
      },
    },
  },
  MuiPaper: {
    defaultProps: {
      elevation: 0,
    },
    styleOverrides: {
      root: {
        backgroundImage: 'none',
        border: '1px solid',
      },
    },
  },
  MuiButton: {
    defaultProps: {
      disableElevation: true,
    },
    styleOverrides: {
      root: {
        borderRadius: 999,
        textTransform: 'none' as const,
        fontWeight: 600,
        paddingInline: 16,
      },
    },
  },
  MuiChip: {
    styleOverrides: {
      root: {
        borderRadius: 999,
      },
    },
  },
};

const gothicTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#c04c63',
      light: '#e47d91',
      dark: '#842b42',
      contrastText: '#fff6f7',
    },
    secondary: {
      main: '#aa91b6',
      light: '#cbb9d3',
      dark: '#70577d',
    },
    background: {
      default: '#0b080d',
      paper: '#171118',
    },
    text: {
      primary: '#f2eaf0',
      secondary: '#bbaebb',
    },
    divider: 'rgba(192, 55, 79, 0.26)',
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
    ...sharedComponents,
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundImage: 'linear-gradient(180deg, #21121d 0%, #100b12 100%)',
          borderBottom: '1px solid rgba(192, 55, 79, 0.52)',
          boxShadow: '0 12px 32px rgba(0, 0, 0, 0.5)',
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          borderColor: 'rgba(192, 55, 79, 0.22)',
          backgroundImage: 'linear-gradient(145deg, rgba(115, 72, 111, 0.07) 0%, rgba(0, 0, 0, 0.24) 100%)',
          boxShadow: '0 12px 30px rgba(0, 0, 0, 0.3)',
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          border: '1px solid rgba(192, 55, 79, 0.4)',
        },
      },
    },
  },
});

const darkTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#7dd3fc',
      light: '#bae6fd',
      dark: '#0ea5e9',
      contrastText: '#031621',
    },
    secondary: {
      main: '#c4b5fd',
    },
    background: {
      default: '#090b10',
      paper: '#111521',
    },
    divider: alpha('#94a3b8', 0.18),
    text: {
      primary: '#e5ecff',
      secondary: '#9aa8c5',
    },
  },
  shape: sharedShape,
  typography: {
    fontFamily: '"Inter", "Segoe UI", "Roboto", sans-serif',
    h6: {
      fontWeight: 700,
      letterSpacing: '-0.01em',
    },
  },
  components: {
    ...sharedComponents,
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundImage: 'linear-gradient(110deg, #111827 0%, #0f172a 45%, #111827 100%)',
          borderBottom: `1px solid ${alpha('#7dd3fc', 0.22)}`,
          boxShadow: '0 14px 35px rgba(2, 6, 23, 0.45)',
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          borderColor: alpha('#94a3b8', 0.18),
          boxShadow: '0 12px 30px rgba(2, 6, 23, 0.2)',
        },
      },
    },
  },
});

const lightTheme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#2563eb',
      light: '#60a5fa',
      dark: '#1d4ed8',
    },
    secondary: {
      main: '#7c3aed',
    },
    background: {
      default: '#f3f6ff',
      paper: '#ffffff',
    },
    divider: alpha('#475569', 0.16),
  },
  shape: sharedShape,
  typography: {
    fontFamily: '"Inter", "Segoe UI", "Roboto", sans-serif',
    h6: {
      fontWeight: 700,
      letterSpacing: '-0.01em',
    },
  },
  components: {
    ...sharedComponents,
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundImage: 'linear-gradient(110deg, #2563eb 0%, #1d4ed8 60%, #312e81 100%)',
          borderBottom: `1px solid ${alpha('#ffffff', 0.26)}`,
          boxShadow: '0 12px 30px rgba(37, 99, 235, 0.28)',
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          borderColor: alpha('#94a3b8', 0.22),
          boxShadow: '0 12px 28px rgba(15, 23, 42, 0.08)',
        },
      },
    },
  },
});

export const themes: Record<ThemeMode, Theme> = {
  dark: darkTheme,
  light: lightTheme,
  gothic: gothicTheme,
};

export const THEME_STORAGE_KEY = 'dandelion-theme';
