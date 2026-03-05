import React from 'react';
import {
  Backdrop,
  Box,
  CircularProgress,
  LinearProgress,
  Paper,
  Stack,
  Typography
} from '@mui/material';

interface ProjectOpeningOverlayProps {
  open: boolean;
  totalFiles: number;
  parsedFiles: number;
  projectName?: string | null;
}

export const ProjectOpeningOverlay: React.FC<ProjectOpeningOverlayProps> = ({
  open,
  totalFiles,
  parsedFiles,
  projectName
}) => {
  const hasKnownTotal = totalFiles > 0;
  const progress = hasKnownTotal
    ? Math.min(100, Math.max(0, (parsedFiles / totalFiles) * 100))
    : 0;

  return (
    <Backdrop
      open={open}
      data-testid="project-opening-overlay"
      sx={{
        zIndex: (theme) => theme.zIndex.modal + 10,
        bgcolor: 'rgba(7, 7, 8, 0.78)'
      }}
    >
      <Paper
        elevation={10}
        sx={{
          minWidth: { xs: 280, sm: 420 },
          maxWidth: 'min(560px, 92vw)',
          px: 3,
          py: 3,
          borderRadius: 2
        }}
      >
        <Stack spacing={2}>
          <Box>
            <Typography variant="h6">Opening project...</Typography>
            {projectName && (
              <Typography variant="body2" color="text.secondary">
                {projectName}
              </Typography>
            )}
          </Box>

          {hasKnownTotal ? (
            <Stack spacing={1}>
              <LinearProgress variant="determinate" value={progress} />
              <Stack direction="row" justifyContent="space-between">
                <Typography variant="body2" color="text.secondary">
                  {parsedFiles} / {totalFiles} files
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {Math.round(progress)}%
                </Typography>
              </Stack>
            </Stack>
          ) : (
            <Stack direction="row" spacing={1.5} alignItems="center">
              <CircularProgress size={20} />
              <Typography variant="body2" color="text.secondary">
                Building project index...
              </Typography>
            </Stack>
          )}
        </Stack>
      </Paper>
    </Backdrop>
  );
};

export default ProjectOpeningOverlay;
