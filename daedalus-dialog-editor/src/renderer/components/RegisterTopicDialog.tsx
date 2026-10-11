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
  Typography,
  Collapse
} from '@mui/material';
import { useProjectStore } from '../store/projectStore';
import {
  suggestCloseTopicsFiles,
  suggestTopicConstantFiles,
  topicBaseName,
  questNameFromTitle
} from '../utils/questLogFiles';

interface RegisterTopicDialogProps {
  open: boolean;
  onClose: () => void;
  /**
   * The TOPIC_… name to register. Absent: create mode (#322) — a new quest
   * named from its title, with everything but the title prefilled and folded
   * under Details.
   */
  topicName?: string;
  /** #278: a LOG_NOTE is registered as its TOPIC_ constant alone */
  topicType?: string;
  /** Create mode: the title typed into the quest picker. */
  initialTitle?: string;
  /** Called with the registered TOPIC_ name once the files are written. */
  onRegistered?: (topicName: string) => void;
}

/**
 * Issue #114: register a "Create Topic" quest in the project's log files —
 * appends the TOPIC_/MIS_ declarations to the LOG constants file and inserts
 * a B_CloseTopic call (gated on chapter start/end) into the B_CloseTopics
 * function.
 */
const RegisterTopicDialog: React.FC<RegisterTopicDialogProps> = ({
  open,
  onClose,
  topicName: givenTopicName,
  topicType,
  initialTitle,
  onRegistered
}) => {
  const isNote = topicType === 'LOG_NOTE';
  const kind = isNote ? 'Note' : 'Quest';
  const isCreate = givenTopicName === undefined;
  // Granular selectors: the merged model is large and recreated frequently,
  // and one instance of this dialog is hosted per Create Topic action card, so
  // gate the whole-model subscription on `open` — a closed instance then no
  // longer re-renders on every merge (precedent: IngestedFilesDialog).
  const mergedSemanticModel = useProjectStore((s) => (open ? s.mergedSemanticModel : null));
  const parsedFiles = useProjectStore((s) => s.parsedFiles);
  const registerTopicInLogFiles = useProjectStore((s) => s.registerTopicInLogFiles);
  const registerNoteInLogFiles = useProjectStore((s) => s.registerNoteInLogFiles);
  const isLoading = useProjectStore((s) => s.isLoading);

  const [title, setTitle] = useState('');
  const [chapterStart, setChapterStart] = useState('0');
  const [chapterEnd, setChapterEnd] = useState('2');
  const [constantsFile, setConstantsFile] = useState('');
  const [closeTopicsFile, setCloseTopicsFile] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Create mode: the identifier follows the title until edited by hand.
  const [internalName, setInternalName] = useState('');
  const [isInternalNameTouched, setIsInternalNameTouched] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const topicName = isCreate ? `TOPIC_${internalName}` : givenTopicName;

  const constantsSuggestions = useMemo(
    () => (mergedSemanticModel ? suggestTopicConstantFiles(mergedSemanticModel, topicType) : []),
    [mergedSemanticModel, topicType]
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
      const startTitle = isCreate ? (initialTitle ?? '') : topicBaseName(topicName).replace(/_/g, ' ');
      setTitle(startTitle);
      setInternalName(questNameFromTitle(startTitle));
      setIsInternalNameTouched(false);
      setChapterStart('0');
      setChapterEnd('2');
      setConstantsFile(constantsSuggestions[0] || '');
      setCloseTopicsFile(closeTopicsSuggestions[0] || '');
      // Details start folded unless the definition file has to be chosen by
      // hand (the close-topics file is optional when creating).
      setShowDetails(!constantsSuggestions[0]);
      setError(null);
    }
    // Initialize only when the dialog opens: the suggestion lists keep
    // updating while background ingestion parses files, and re-running this
    // effect on those updates would clobber the user's input mid-form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, givenTopicName]);

  const handleTitleChange = (value: string) => {
    setTitle(value);
    if (isCreate && !isInternalNameTouched) setInternalName(questNameFromTitle(value));
  };

  const handleSubmit = async () => {
    const base = topicBaseName(topicName);
    const start = parseInt(chapterStart, 10);
    const end = parseInt(chapterEnd, 10);

    if (isCreate && !internalName) {
      setError('The title needs at least one letter to name the quest.');
      setShowDetails(true);
      return;
    }
    if (isNote) {
      if (!title.trim() || !constantsFile.trim()) {
        setError('Note title and target file are required.');
        return;
      }
    } else if (!title.trim() || !constantsFile.trim() || (!isCreate && !closeTopicsFile.trim())) {
      setError(isCreate ? 'Quest title and definition file are required.' : 'Quest title and both target files are required.');
      return;
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < 0) {
      setError('Chapter numbers must be non-negative integers.');
      return;
    }
    if (mergedSemanticModel?.constants?.[`TOPIC_${base}`]) {
      setError(isCreate
        ? `A ${kind.toLowerCase()} named TOPIC_${base} already exists; pick it in the list, or change the name under Details.`
        : `TOPIC_${base} already exists in the project.`);
      return;
    }

    try {
      if (isNote) {
        await registerNoteInLogFiles({
          topicName,
          title: title.trim(),
          constantsFilePath: constantsFile.trim()
        });
        onRegistered?.(topicName);
        onClose();
        return;
      }
      await registerTopicInLogFiles({
        topicName,
        title: title.trim(),
        chapterStart: start,
        chapterEnd: end,
        constantsFilePath: constantsFile.trim(),
        closeTopicsFilePath: closeTopicsFile.trim()
      });
      onRegistered?.(topicName);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : `Failed to register the ${kind.toLowerCase()}.`);
    }
  };

  return (
    <Dialog open={open} onClose={() => !isLoading && onClose()} fullWidth maxWidth='sm'>
      <DialogTitle>{isCreate ? `New ${kind}` : `Register ${kind} in Log Files`}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity='error'>{error}</Alert>}

          {isCreate && !showDetails ? (
            <Typography variant='body2' color='text.secondary'>
              The editor declares the {kind.toLowerCase()} in the project&apos;s log files for you.
            </Typography>
          ) : isNote ? (
            <Typography variant='body2' color='text.secondary'>
              Adds <code>const string {`TOPIC_${topicBaseName(topicName)}`}</code> to the note
              definition file.
            </Typography>
          ) : (
            <Typography variant='body2' color='text.secondary'>
              Adds <code>const string {`TOPIC_${topicBaseName(topicName)}`}</code> and{' '}
              <code>var int {`MIS_${topicBaseName(topicName)}`}</code> to the quest definition
              file, and a <code>B_CloseTopic</code> call to the close-topics function.
            </Typography>
          )}

          <TextField
            autoFocus
            fullWidth
            label={`${kind} Title`}
            value={title}
            onChange={(e) => handleTitleChange(e.target.value)}
            disabled={isLoading}
            helperText='Shown in the in-game log'
          />

          {isCreate && (
            <Button
              size='small'
              sx={{ alignSelf: 'flex-start' }}
              onClick={() => setShowDetails((shown) => !shown)}
              aria-expanded={showDetails}
            >
              {showDetails ? 'Hide details' : 'Details'}
            </Button>
          )}

          <Collapse in={!isCreate || showDetails} unmountOnExit>
          <Stack spacing={2} sx={{ pt: 1 }}>
          {isCreate && (
            <TextField
              label='Internal Name'
              value={internalName}
              onChange={(e) => {
                setInternalName(e.target.value.replace(/[^A-Za-z0-9_]/g, ''));
                setIsInternalNameTouched(true);
              }}
              disabled={isLoading}
              helperText={`Script name: TOPIC_${internalName || '…'}`}
            />
          )}

          {!isNote && (
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
          )}

          <Autocomplete
            freeSolo
            options={constantsSuggestions}
            inputValue={constantsFile}
            onInputChange={(_e, value) => setConstantsFile(value)}
            disabled={isLoading}
            renderInput={(params) => (
              <TextField {...params} label={`${kind} Definition File (TOPIC_)`} fullWidth />
            )}
          />

          {!isNote && (
            <Autocomplete
              freeSolo
              options={closeTopicsSuggestions}
              inputValue={closeTopicsFile}
              onInputChange={(_e, value) => setCloseTopicsFile(value)}
              disabled={isLoading}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label='Close Topics File (B_CloseTopics)'
                  fullWidth
                  helperText={isCreate ? 'Optional: leave empty if the project has no B_CloseTopics function' : undefined}
                />
              )}
            />
          )}
          </Stack>
          </Collapse>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={isLoading}>Cancel</Button>
        <Button onClick={() => void handleSubmit()} variant='contained' disabled={isLoading}>
          {isLoading ? (isCreate ? 'Creating…' : 'Registering…') : (isCreate ? 'Create' : 'Register')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default RegisterTopicDialog;
