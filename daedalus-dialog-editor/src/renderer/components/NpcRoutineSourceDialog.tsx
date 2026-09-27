import React, { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material';

export interface NpcRoutineSourceTarget {
  routine: string;
  filePath: string;
  line: number;
}

interface NpcRoutineSourceDialogProps {
  target: NpcRoutineSourceTarget;
  onClose: () => void;
}

/** Read-only view of the routine's source file, scrolled to its indexed TA call. */
const NpcRoutineSourceDialog: React.FC<NpcRoutineSourceDialogProps> = ({ target, onClose }) => {
  const [source, setSource] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const targetLine = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let current = true;
    setSource(null);
    setError(null);
    void window.editorAPI.readFile(target.filePath).then((text) => {
      if (current) setSource(text);
    }).catch((failure: unknown) => {
      if (current) setError(failure instanceof Error ? failure.message : String(failure));
    });
    return () => { current = false; };
  }, [target.filePath]);

  useEffect(() => {
    targetLine.current?.scrollIntoView({ block: 'center' });
  }, [source, target.line]);

  const lines = source?.split(/\r?\n/) ?? [];

  return (
    <Dialog open onClose={onClose} maxWidth="lg" fullWidth aria-labelledby="npc-routine-source-title">
      <DialogTitle id="npc-routine-source-title">{`Routine source: ${target.routine}`}</DialogTitle>
      <DialogContent dividers sx={{ p: 0, height: '65vh', overflow: 'auto' }}>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 2, py: 1 }}>
          {`${target.filePath} · line ${target.line}`}
        </Typography>
        {error && <Alert severity="error" sx={{ m: 2 }}>{`Could not read ${target.filePath}: ${error}`}</Alert>}
        {source === null && !error && (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}><CircularProgress size={24} /></Box>
        )}
        {source !== null && (
          <Box role="region" aria-label={`Source file ${target.filePath}`} sx={{ minWidth: 'max-content', py: 1 }}>
            {lines.map((text, index) => {
              const line = index + 1;
              const isTarget = line === target.line;
              return (
                <Box
                  key={line}
                  ref={isTarget ? targetLine : undefined}
                  data-testid={isTarget ? 'npc-routine-source-target' : undefined}
                  data-line={line}
                  aria-current={isTarget ? 'location' : undefined}
                  sx={{
                    display: 'grid', gridTemplateColumns: '4.5rem max-content', gap: 1,
                    px: 1, bgcolor: isTarget ? 'action.selected' : 'transparent',
                  }}
                >
                  <Typography component="span" variant="caption" color="text.secondary" sx={{ textAlign: 'right', userSelect: 'none' }}>
                    {line}
                  </Typography>
                  <Box component="span" sx={{ fontFamily: 'monospace', whiteSpace: 'pre' }}>{text || ' '}</Box>
                </Box>
              );
            })}
          </Box>
        )}
      </DialogContent>
      <DialogActions><Button onClick={onClose}>Close</Button></DialogActions>
    </Dialog>
  );
};

export default NpcRoutineSourceDialog;
