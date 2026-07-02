import React, { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Stack,
  Alert,
  Autocomplete,
  Typography
} from '@mui/material';
import { useProjectStore } from '../store/projectStore';
import {
  suggestCloseTopicsFiles,
  suggestTopicConstantFiles,
  topicBaseName
} from '../utils/questLogFiles';

interface RegisterTopicDialogProps {
  open: boolean;
  onClose: () => void;
  /** The TOPIC_… name from the Create Topic action */
  topicName: string;
}

/**
 * Issue #114: register a "Create Topic" quest in the project's log files —
 * appends the TOPIC_/MIS_ declarations to the LOG constants file and inserts
 * a B_CloseTopic call (gated on chapter start/end) into the B_CloseTopics
 * function.
 */
const RegisterTopicDialog: React.FC<RegisterTopicDialogProps> = ({ open, onClose, topicName }) => {
  const { mergedSemanticModel, parsedFiles, registerTopicInLogFiles, isLoading } = useProjectStore();

  const [title, setTitle] = useState('');
  const [chapterStart, setChapterStart] = useState('0');
  const [chapterEnd, setChapterEnd] = useState('2');
  const [constantsFile, setConstantsFile] = useState('');
  const [closeTopicsFile, setCloseTopicsFile] = useState('');
  const [error, setError] = useState<string | null>(null);

  const constantsSuggestions = useMemo(
    () => suggestTopicConstantFiles(mergedSemanticModel),
    [mergedSemanticModel]
  );
  const closeTopicsSuggestions = useMemo(
    () => suggestCloseTopicsFiles(parsedFiles),
    [parsedFiles]
  );

  useEffect(() => {
    if (open) {
      // "TOPIC_DalvinsSpitzhacken" → "Dalvins Spitzhacken" is not derivable;
      // default to the base name with underscores as spaces and let the user
      // adjust the display title.
      setTitle(topicBaseName(topicName).replace(/_/g, ' '));
      setChapterStart('0');
      setChapterEnd('2');
      setConstantsFile(constantsSuggestions[0] || '');
      setCloseTopicsFile(closeTopicsSuggestions[0] || '');
      setError(null);
    }
    // Initialize only when the dialog opens: the suggestion lists keep
    // updating while background ingestion parses files, and re-running this
    // effect on those updates would clobber the user's input mid-form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, topicName]);

  const handleSubmit = async () => {
    const base = topicBaseName(topicName);
    const start = parseInt(chapterStart, 10);
    const end = parseInt(chapterEnd, 10);

    if (!title.trim() || !constantsFile.trim() || !closeTopicsFile.trim()) {
      setError('Quest title and both target files are required.');
      return;
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < 0) {
      setError('Chapter numbers must be non-negative integers.');
      return;
    }
    if (mergedSemanticModel.constants?.[`TOPIC_${base}`]) {
      setError(`TOPIC_${base} already exists in the project.`);
      return;
    }

    try {
      await registerTopicInLogFiles({
        topicName,
        title: title.trim(),
        chapterStart: start,
        chapterEnd: end,
        constantsFilePath: constantsFile.trim(),
        closeTopicsFilePath: closeTopicsFile.trim()
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to register the quest.');
    }
  };

  return (
    <Dialog open={open} onClose={() => !isLoading && onClose()} fullWidth maxWidth='sm'>
      <DialogTitle>Register Quest in Log Files</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity='error'>{error}</Alert>}

          <Typography variant='body2' color='text.secondary'>
            Adds <code>const string {`TOPIC_${topicBaseName(topicName)}`}</code> and{' '}
            <code>var int {`MIS_${topicBaseName(topicName)}`}</code> to the quest definition
            file, and a <code>B_CloseTopic</code> call to the close-topics function.
          </Typography>

          <TextField
            autoFocus
            fullWidth
            label='Quest Title'
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={isLoading}
            helperText='Shown in the in-game quest log'
          />

          <Stack direction='row' spacing={2}>
            <TextField
              label='Chapter Start'
              type='number'
              value={chapterStart}
              onChange={(e) => setChapterStart(e.target.value)}
              disabled={isLoading}
              helperText='0 = always'
            />
            <TextField
              label='Chapter End'
              type='number'
              value={chapterEnd}
              onChange={(e) => setChapterEnd(e.target.value)}
              disabled={isLoading}
              helperText='Must be finished by'
            />
          </Stack>

          <Autocomplete
            freeSolo
            options={constantsSuggestions}
            inputValue={constantsFile}
            onInputChange={(_e, value) => setConstantsFile(value)}
            disabled={isLoading}
            renderInput={(params) => (
              <TextField {...params} label='Quest Definition File (TOPIC_)' fullWidth />
            )}
          />

          <Autocomplete
            freeSolo
            options={closeTopicsSuggestions}
            inputValue={closeTopicsFile}
            onInputChange={(_e, value) => setCloseTopicsFile(value)}
            disabled={isLoading}
            renderInput={(params) => (
              <TextField {...params} label='Close Topics File (B_CloseTopics)' fullWidth />
            )}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={isLoading}>Cancel</Button>
        <Button onClick={() => void handleSubmit()} variant='contained' disabled={isLoading}>
          {isLoading ? 'Registering…' : 'Register'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default RegisterTopicDialog;
