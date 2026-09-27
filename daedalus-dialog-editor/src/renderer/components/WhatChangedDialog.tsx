import React, { useEffect, useState } from 'react';
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, List, ListItem, ListItemText, Typography } from '@mui/material';

export interface BuildChange {
  issue: number;
  description: string;
}

export function parseBuildChanges(value: string | undefined): BuildChange[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is BuildChange =>
      item !== null
      && typeof item === 'object'
      && Number.isInteger((item as BuildChange).issue)
      && (item as BuildChange).issue > 0
      && typeof (item as BuildChange).description === 'string'
      && (item as BuildChange).description.trim().length > 0,
    );
  } catch {
    return [];
  }
}

function shouldShow(version: string, changes: BuildChange[]): boolean {
  if (changes.length === 0) return false;
  try {
    return localStorage.getItem(`what-changed-dismissed:${version}`) !== 'true';
  } catch {
    return true;
  }
}

interface WhatChangedDialogProps {
  version: string;
  changes: BuildChange[];
}

/** Shows this build's notes once, then remembers the dismissal for that version. */
const WhatChangedDialog: React.FC<WhatChangedDialogProps> = ({ version, changes }) => {
  const [open, setOpen] = useState(() => shouldShow(version, changes));
  const [activeVersion, setActiveVersion] = useState(version);

  useEffect(() => {
    if (activeVersion !== version) {
      setActiveVersion(version);
      setOpen(shouldShow(version, changes));
    }
  }, [activeVersion, changes, version]);

  const dismiss = () => {
    try {
      localStorage.setItem(`what-changed-dismissed:${version}`, 'true');
    } catch {
      // The dialog still closes for this session when storage is unavailable.
    }
    setOpen(false);
  };

  return (
    <Dialog open={open} onClose={dismiss} aria-labelledby="what-changed-title" maxWidth="sm" fullWidth>
      <DialogTitle id="what-changed-title">What changed</DialogTitle>
      <DialogContent>
        <Typography color="text.secondary" sx={{ mb: 1 }}>
          Dandelion {version}
        </Typography>
        <List dense disablePadding>
          {changes.map(({ issue, description }) => (
            <ListItem key={issue} disableGutters>
              <ListItemText primary={description} />
              <Typography variant="body2" color="text.secondary" sx={{ ml: 2, whiteSpace: 'nowrap' }}>
                #{issue}
              </Typography>
            </ListItem>
          ))}
        </List>
      </DialogContent>
      <DialogActions>
        <Button variant="contained" onClick={dismiss}>Got it</Button>
      </DialogActions>
    </Dialog>
  );
};

export default WhatChangedDialog;
