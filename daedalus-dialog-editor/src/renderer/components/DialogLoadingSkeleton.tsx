import React from 'react';
import { Box, Paper, Skeleton, Stack } from '@mui/material';

/**
 * Loading skeleton shown during dialog transitions
 * Provides visual feedback and prevents flickering
 */
const DialogLoadingSkeleton: React.FC = () => {
  return (
    <Box>
      {/* Header skeleton */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Skeleton variant="text" width={200} height={40} />
        <Stack direction="row" spacing={1}>
          <Skeleton variant="rectangular" width={80} height={36} sx={{ borderRadius: 1 }} />
          <Skeleton variant="rectangular" width={80} height={36} sx={{ borderRadius: 1 }} />
          <Skeleton variant="rectangular" width={100} height={36} sx={{ borderRadius: 1 }} />
        </Stack>
      </Box>

      {/* Properties skeleton */}
      <Paper sx={{ p: 2, mb: 2 }}>
        <Skeleton variant="text" width={120} height={32} sx={{ mb: 2 }} />
        <Stack spacing={2}>
          <Skeleton variant="rectangular" height={40} sx={{ borderRadius: 1 }} />
          <Skeleton variant="rectangular" height={40} sx={{ borderRadius: 1 }} />
          <Skeleton variant="rectangular" height={40} sx={{ borderRadius: 1 }} />
          <Skeleton variant="rectangular" height={40} sx={{ borderRadius: 1 }} />
        </Stack>
      </Paper>

      {/* Actions skeleton */}
      <Paper sx={{ p: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Box>
            <Skeleton variant="text" width={150} height={32} />
            <Skeleton variant="text" width={80} height={20} />
          </Box>
          <Stack direction="row" spacing={1}>
            <Skeleton variant="rectangular" width={100} height={32} sx={{ borderRadius: 1 }} />
            <Skeleton variant="rectangular" width={120} height={32} sx={{ borderRadius: 1 }} />
            <Skeleton variant="circular" width={32} height={32} />
          </Stack>
        </Box>

        {/* Action items skeleton */}
        <Stack spacing={2}>
          {[1, 2, 3, 4, 5].map((i) => (
            <Box key={i} sx={{ pb: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                <Skeleton variant="circular" width={24} height={24} />
                <Skeleton variant="rectangular" height={56} sx={{ flex: 1, borderRadius: 1 }} />
              </Box>
            </Box>
          ))}
        </Stack>
      </Paper>
    </Box>
  );
};

export default DialogLoadingSkeleton;
