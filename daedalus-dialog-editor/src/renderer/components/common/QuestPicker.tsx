import React, { useEffect, useMemo, useState } from 'react';
import { Autocomplete, Box, IconButton, TextField, Tooltip, Typography, createFilterOptions } from '@mui/material';
import { Add as AddIcon, MenuBook as MenuBookIcon } from '@mui/icons-material';
import { useProjectStore } from '../../store/projectStore';
import { getCanonicalQuestKey } from '../../utils/questIdentity';
import { questNameFromTitle } from '../../utils/questLogFiles';
import RegisterTopicDialog from '../RegisterTopicDialog';

interface QuestOption {
  topic: string;
  title: string;
  /** "New quest …" entry for a title no quest has yet. */
  isNew?: boolean;
}

export interface QuestPickerProps {
  /** The step's `TOPIC_` name. */
  value: string;
  onChange: (topic: string) => void;
  /** A note is created as a LOG_NOTE; everything else as a mission. */
  kind: 'quest' | 'note';
  label: string;
  onFlush?: () => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  mainFieldRef?: React.RefObject<HTMLInputElement>;
  sx?: object;
}

const TOPIC_PREFIX = /^topic_/i;
const PLACEHOLDER_TOPIC = /^topic_?$/i;

const filter = createFilterOptions<QuestOption>({ stringify: (option) => `${option.title} ${option.topic}` });

/**
 * #322: picks a quest by its diary title. A title no quest has yet becomes a
 * new quest: in a project it is declared in the log files (TOPIC_, MIS_,
 * B_CloseTopic) through RegisterTopicDialog's create mode; without one the
 * step just takes the name the title gives.
 */
const QuestPicker: React.FC<QuestPickerProps> = ({
  value,
  onChange,
  kind,
  label,
  onFlush,
  onKeyDown,
  mainFieldRef,
  sx
}) => {
  // Constants only: the merge keeps this identity stable across function edits.
  const constants = useProjectStore((s) => s.mergedSemanticModel.constants);
  const isProjectMode = useProjectStore((s) => !!s.projectPath);
  const [newTitle, setNewTitle] = useState<string | null>(null);
  const [isRegisterOpen, setIsRegisterOpen] = useState(false);
  const [isListOpen, setIsListOpen] = useState(false);

  const options = useMemo<QuestOption[]>(
    () => Object.values(constants || {})
      .filter((c) => TOPIC_PREFIX.test(c.name))
      .map((c) => ({ topic: c.name, title: (typeof c.value === 'string' && c.value) || c.name }))
      .sort((a, b) => a.title.localeCompare(b.title)),
    [constants]
  );
  const selected = useMemo(
    () => options.find((o) => getCanonicalQuestKey(o.topic) === getCanonicalQuestKey(value)) ?? null,
    [options, value]
  );
  // An undeclared name still shows, so nothing on the card is hidden.
  const displayed = selected ? selected.title : (PLACEHOLDER_TOPIC.test(value) ? '' : value);
  const [inputValue, setInputValue] = useState(displayed);
  useEffect(() => setInputValue(displayed), [displayed]);

  const create = (title: string) => {
    if (isProjectMode) {
      setNewTitle(title);
    } else {
      const name = questNameFromTitle(title);
      if (name) onChange(`TOPIC_${name}`);
    }
  };

  const noun = kind === 'note' ? 'note' : 'quest';
  // A name no constant declares (typed by hand, or from a file with no log
  // declarations yet) can still be registered in the log files (#114).
  const isUndeclared = !selected && !!value && !PLACEHOLDER_TOPIC.test(value);
  const registerLabel = `Register ${noun} in log files`;

  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5, ...sx }}>
      <Autocomplete<QuestOption, false, false, false>
        value={selected}
        options={options}
        openOnFocus
        // Closed while one of this picker's dialogs is up: the list would
        // otherwise stay open over the dialog (focus goes there and back).
        open={isListOpen && newTitle === null && !isRegisterOpen}
        onOpen={() => setIsListOpen(true)}
        onClose={() => setIsListOpen(false)}
        inputValue={inputValue}
        onInputChange={(_event, next) => setInputValue(next)}
        isOptionEqualToValue={(a, b) => a.topic === b.topic && !!a.isNew === !!b.isNew}
        getOptionLabel={(option) => option.title}
        filterOptions={(all, params) => {
          const found = filter(all, params);
          const typed = params.inputValue.trim();
          if (typed && !all.some((o) => o.title.toLowerCase() === typed.toLowerCase())) {
            found.push({ topic: '', title: typed, isNew: true });
          }
          return found;
        }}
        onChange={(_event, option) => {
          if (!option) return;
          if (option.isNew) create(option.title);
          else onChange(option.topic);
        }}
        onBlur={() => {
          setInputValue(displayed);
          onFlush?.();
        }}
        renderOption={(props, option) => {
          const { key, ...rest } = props as React.HTMLAttributes<HTMLLIElement> & { key: string };
          return (
            <li key={key} {...rest}>
              {option.isNew ? (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <AddIcon fontSize="small" color="success" />
                  <Typography variant="body2">New {noun} &quot;{option.title}&quot;</Typography>
                </Box>
              ) : (
                <Box>
                  <Typography variant="body2">{option.title}</Typography>
                  <Typography variant="caption" color="text.secondary">{option.topic}</Typography>
                </Box>
              )}
            </li>
          );
        }}
        noOptionsText={`Type a title to create a ${noun}`}
        renderInput={(params) => (
          <TextField
            {...params}
            label={label}
            placeholder={`Choose or create a ${noun}`}
            size="small"
            inputRef={mainFieldRef}
            onKeyDown={onKeyDown}
            helperText={!selected && value && !PLACEHOLDER_TOPIC.test(value) ? 'Not declared in the project' : undefined}
          />
        )}
        sx={{ flex: 1 }}
      />
      {isUndeclared && isProjectMode && (
        <Tooltip title={registerLabel}>
          <IconButton size="small" aria-label={registerLabel} tabIndex={-1} onClick={() => setIsRegisterOpen(true)}>
            <MenuBookIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      )}
      {isRegisterOpen && (
        <RegisterTopicDialog
          open
          onClose={() => setIsRegisterOpen(false)}
          topicName={value}
          topicType={kind === 'note' ? 'LOG_NOTE' : 'LOG_MISSION'}
        />
      )}
      {newTitle !== null && (
        <RegisterTopicDialog
          open
          onClose={() => setNewTitle(null)}
          topicType={kind === 'note' ? 'LOG_NOTE' : 'LOG_MISSION'}
          initialTitle={newTitle}
          onRegistered={onChange}
        />
      )}
    </Box>
  );
};

export default QuestPicker;
