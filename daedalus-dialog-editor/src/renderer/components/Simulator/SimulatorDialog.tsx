import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  Stack,
  Switch,
  Typography
} from '@mui/material';
import type { SemanticModel } from '../../../shared/types';
import { SimulatorSession } from '../../simulator/application/SimulatorSession';
import { createSimulatorModel } from '../../simulator/domain/model';
import type { UnknownValue } from '../../simulator/domain/types';

interface SimulatorDialogProps {
  open: boolean;
  semanticModel: SemanticModel;
  dialogName: string;
  npcName: string;
  onClose: () => void;
}

const formatValue = (value: number | UnknownValue): string =>
  typeof value === 'number' ? String(value) : `unknown (${value.expression})`;

const SimulatorDialog: React.FC<SimulatorDialogProps> = ({
  open,
  semanticModel,
  dialogName,
  npcName,
  onClose
}) => {
  const model = useMemo(() => createSimulatorModel(semanticModel), [semanticModel]);
  const [session, setSession] = useState<SimulatorSession | null>(null);
  const [, setRevision] = useState(0);

  useEffect(() => {
    if (!open) {
      setSession(null);
      return;
    }

    const nextSession = new SimulatorSession(model);
    nextSession.startDialog(dialogName);
    setSession(nextSession);
  }, [dialogName, model, open]);

  const refresh = () => setRevision((revision) => revision + 1);
  const state = session?.getState();
  const availability = session?.getAvailableDialogs(npcName) || [];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="md"
      aria-labelledby="dialog-simulator-title"
    >
      <DialogTitle id="dialog-simulator-title">Dialog simulator</DialogTitle>
      <DialogContent dividers>
        {!session || !state ? (
          <Typography color="text.secondary">Preparing simulation…</Typography>
        ) : (
          <Stack spacing={2}>
            <Box>
              <Typography variant="subtitle2" gutterBottom>Transcript</Typography>
              <Stack spacing={0.75}>
                {state.transcript.length === 0 && (
                  <Typography variant="body2" color="text.secondary">No dialog lines yet.</Typography>
                )}
                {state.transcript.map((entry, index) => {
                  if (entry.kind === 'line') {
                    return (
                      <Typography
                        key={`${entry.id}-${index}`}
                        data-testid="simulator-transcript-line"
                        align={entry.speaker === 'self' ? 'right' : 'left'}
                      >
                        <strong>{entry.speaker === 'self' ? 'Hero' : npcName}:</strong> {entry.text}
                      </Typography>
                    );
                  }
                  if (entry.kind === 'condition-note') {
                    return (
                      <Alert key={`condition-${index}`} severity="warning">
                        Condition unknown ({entry.assumed ? 'assumed true' : 'assumed false'})
                        {entry.reason ? `: ${entry.reason}` : ''}
                      </Alert>
                    );
                  }
                  return (
                    <Typography key={`${entry.kind}-${index}`} variant="caption" color="text.secondary">
                      {entry.kind === 'choice' ? `Selected: ${entry.text}` : entry.text}
                    </Typography>
                  );
                })}
              </Stack>
            </Box>

            <Box>
              <Typography variant="subtitle2" gutterBottom>Choices</Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {state.status === 'awaiting-choice' && state.pendingChoices.map((choice, index) => (
                  <Button
                    key={`${choice.targetFunction}-${index}`}
                    data-testid={`simulator-choice-${index}`}
                    variant="contained"
                    onClick={() => {
                      session.selectChoice(index);
                      refresh();
                    }}
                  >
                    {choice.text}
                  </Button>
                ))}
              </Stack>
              {state.status === 'ended' && (
                <Typography sx={{ mt: 1 }} color="text.secondary">End of dialog</Typography>
              )}
            </Box>

            <Divider />

            <Box>
              <Typography variant="subtitle2" gutterBottom>Available dialogs</Typography>
              <Stack data-testid="simulator-available-dialogs" spacing={0.75}>
                {availability.filter((item) => item.visible).map((item) => {
                  const selectable = item.value === 'true' || item.assumedAvailable;
                  return (
                    <Stack key={item.entry.name} direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                      <Button
                        size="small"
                        disabled={!selectable}
                        onClick={() => {
                          if (session.startDialog(item.entry.name)) refresh();
                        }}
                      >
                        {item.entry.name}
                      </Button>
                      {item.entry.important && <Chip size="small" label="Important" />}
                      {item.value === 'unknown' && (
                        <Typography variant="caption" color="warning.main">
                          Condition unknown (assumed {item.assumedAvailable ? 'true' : 'false'})
                          {item.reason ? `: ${item.reason}` : ''}
                        </Typography>
                      )}
                    </Stack>
                  );
                })}
              </Stack>
            </Box>

            <FormControlLabel
              control={
                <Switch
                  checked={session.getAssumeUnknown()}
                  onChange={(event) => {
                    session.setAssumeUnknown(event.target.checked);
                    refresh();
                  }}
                />
              }
              label="Assume unknown conditions are true"
            />

            <Box>
              <Typography variant="subtitle2" gutterBottom>Scratch state</Typography>
              <Typography variant="body2">Active function: {session.getActiveFunctionName() || 'none'}</Typography>
              <Typography variant="body2">
                MIS values: {Array.from(state.misVars, ([name, value]) => `${name} = ${formatValue(value)}${state.assumedMisVars.has(name) ? ' (assumed)' : ''}`).join(', ') || 'none'}
              </Typography>
              <Typography variant="body2">
                Known infos: {Array.from(state.knownInfos).join(', ') || 'none'}
              </Typography>
            </Box>
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={() => { session?.back(); refresh(); }} disabled={!session?.canBack()} aria-label="Back one step">
          Back one step
        </Button>
        <Button onClick={() => { session?.restart(); refresh(); }} disabled={!session} data-testid="simulator-restart">
          Restart
        </Button>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
};

export default SimulatorDialog;
