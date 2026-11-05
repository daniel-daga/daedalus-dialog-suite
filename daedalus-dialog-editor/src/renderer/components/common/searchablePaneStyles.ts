import { alpha } from '@mui/material/styles';
import type { Theme } from '@mui/material/styles';

/**
 * Deliberate test anchor, read by nothing in `src/`: a searchable pane renders
 * it on its shell so `tests/searchablePaneDesign.test.tsx` can find that element
 * (and then assert `searchablePaneShellSx` on it) without depending on DOM
 * nesting. Removing it removes the tests' locator — see #513.
 */
export const SEARCHABLE_PANE_PATTERN = 'searchable-pane-v1';

export const searchablePaneShellSx = (theme: Theme) => ({
  backgroundColor: alpha(theme.palette.background.paper, 0.96),
  border: 1,
  borderColor: 'divider',
  borderRadius: 0,
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
});

export const searchablePaneHeaderSx = (theme: Theme) => ({
  px: 2,
  py: 1.5,
  borderBottom: 1,
  borderColor: 'divider',
  backgroundColor: alpha(theme.palette.background.default, 0.55),
});

export const searchablePaneFilterStripSx = (theme: Theme) => ({
  px: 1,
  py: 1,
  borderBottom: 1,
  borderColor: 'divider',
  backgroundColor: alpha(theme.palette.background.default, 0.28),
});

export const searchablePaneContentSx = (theme: Theme) => ({
  flexGrow: 1,
  overflow: 'hidden',
  backgroundColor: alpha(theme.palette.background.paper, 0.7),
});

export const searchablePaneRowButtonSx = (theme: Theme) => ({
  borderRadius: 0,
  transition: 'background-color 120ms ease',
  '&:hover': {
    backgroundColor: alpha(theme.palette.primary.main, 0.08),
  },
  '&.Mui-selected': {
    backgroundColor: alpha(theme.palette.primary.main, 0.16),
  },
  '&.Mui-selected:hover': {
    backgroundColor: alpha(theme.palette.primary.main, 0.22),
  },
});

export const searchablePaneTextFieldSx = (theme: Theme) => ({
  '& .MuiOutlinedInput-root': {
    backgroundColor: alpha(theme.palette.background.default, 0.35),
  },
});
