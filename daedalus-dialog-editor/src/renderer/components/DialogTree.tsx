import React, { useMemo, memo } from 'react';
import {
  Paper,
  Box,
  Typography,
  TextField,
  InputAdornment,
  IconButton,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  MenuItem,
  ListSubheader
} from '@mui/material';
import {
  FilterList as FilterListIcon,
  Clear as ClearIcon,
  Add as AddIcon,
  School as SchoolIcon,
  Storefront as StorefrontIcon
} from '@mui/icons-material';
import { FixedSizeList as List, ListChildComponentProps } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import { DialogTreeProps } from './dialogTypes';
import { useSearchStore } from '../store/searchStore';
import {
  TEACHER_SKILL_GROUPS,
  getTeacherSkill,
  skillHasMaxLevel,
  type TeacherSkillId
} from '../utils/teacherDialogTemplate';
import { TRADER_DEFAULT_DESCRIPTION } from '../utils/traderDialogTemplate';
import DialogTreeItem from './DialogTreeItem';
import ChoiceTreeItem from './ChoiceTreeItem';
import { flattenDialogs } from './dialogTreeUtils';
import {
  SEARCHABLE_PANE_PATTERN,
  searchablePaneContentSx,
  searchablePaneFilterStripSx,
  searchablePaneHeaderSx,
  searchablePaneShellSx,
  searchablePaneTextFieldSx
} from './common/searchablePaneStyles';

interface ItemData {
  flatItems: any[];
  selectedDialog: string | null;
  selectedFunctionName: string | null;
  onSelectDialog: (dialogName: string, functionName: string | null) => void;
  onToggleDialogExpand: (dialogName: string) => void;
  onToggleChoiceExpand: (choiceKey: string) => void;
}

const Row = memo(({ index, style, data }: ListChildComponentProps<ItemData>) => {
  const {
    flatItems,
    selectedDialog,
    selectedFunctionName,
    onSelectDialog,
    onToggleDialogExpand,
    onToggleChoiceExpand,
  } = data;

  const item = flatItems[index];

  if (item.type === 'dialog') {
    return (
      <DialogTreeItem
        dialogName={item.dialogName}
        description={item.description}
        infoFuncName={item.infoFuncName}
        isSelected={selectedDialog === item.dialogName && selectedFunctionName === item.infoFuncName}
        isExpanded={item.isExpanded}
        onSelectDialog={onSelectDialog}
        onToggleDialogExpand={onToggleDialogExpand}
        hasChildren={item.hasChildren}
        style={style}
      />
    );
  }

  return (
    <ChoiceTreeItem
      choice={item.choice}
      depth={item.depth}
      choiceKey={item.id}
      isExpanded={item.isExpanded}
      hasChildren={item.hasChildren}
      selectedFunctionName={selectedFunctionName}
      dialogName={item.dialogName}
      onSelectDialog={onSelectDialog}
      onToggleChoiceExpand={onToggleChoiceExpand}
      style={style}
    />
  );
});

Row.displayName = 'DialogTreeRow';

const DialogTree: React.FC<DialogTreeProps> = ({
  selectedNPC,
  dialogsForNPC,
  semanticModel,
  selectedDialog,
  selectedFunctionName,
  expandedDialogs,
  expandedChoices,
  onSelectDialog,
  onToggleDialogExpand,
  onToggleChoiceExpand,
  buildFunctionTree,
  onAddDialog,
  onCreateTeacherDialog,
  onCreateTraderDialog,
}) => {
  const dialogFilter = useSearchStore((s) => s.dialogFilter);
  const setDialogFilter = useSearchStore((s) => s.setDialogFilter);
  const filterDialogs = useSearchStore((s) => s.filterDialogs);
  const [isCreateOpen, setIsCreateOpen] = React.useState(false);
  const [newDialogName, setNewDialogName] = React.useState('');
  const [isCreating, setIsCreating] = React.useState(false);
  const [createError, setCreateError] = React.useState<string | null>(null);

  // Teacher dialog form state (issue #147)
  const [isTeacherOpen, setIsTeacherOpen] = React.useState(false);
  const [teacherSkillId, setTeacherSkillId] = React.useState<TeacherSkillId>('1H');
  const [teacherMaxLevel, setTeacherMaxLevel] = React.useState('30');
  const [teacherDescription, setTeacherDescription] = React.useState('');
  const [isTeacherDescriptionEdited, setIsTeacherDescriptionEdited] = React.useState(false);
  const [isTeacherMaxLevelEdited, setIsTeacherMaxLevelEdited] = React.useState(false);
  const [isCreatingTeacher, setIsCreatingTeacher] = React.useState(false);
  const [teacherError, setTeacherError] = React.useState<string | null>(null);

  // Trader dialog form state (feature-suggestions item 5)
  const [isTraderOpen, setIsTraderOpen] = React.useState(false);
  const [traderDescription, setTraderDescription] = React.useState('');
  const [isCreatingTrader, setIsCreatingTrader] = React.useState(false);
  const [traderError, setTraderError] = React.useState<string | null>(null);

  const sortedDialogs = useMemo(() => {
    return [...dialogsForNPC].sort((a, b) => {
      const dialogA = semanticModel.dialogs?.[a];
      const dialogB = semanticModel.dialogs?.[b];

      if (!dialogA || !dialogB) return 0;

      const priorityA = typeof dialogA.properties?.nr === 'number' ? dialogA.properties.nr : 999999;
      const priorityB = typeof dialogB.properties?.nr === 'number' ? dialogB.properties.nr : 999999;
      return priorityA - priorityB;
    });
  }, [dialogsForNPC, semanticModel.dialogs]);

  const filteredDialogs = useMemo(() => {
    return filterDialogs(sortedDialogs);
  }, [sortedDialogs, filterDialogs, dialogFilter]);

  const flatItems = useMemo(() => {
    if (!selectedNPC) return [];
    return flattenDialogs(
      filteredDialogs,
      semanticModel.dialogs,
      semanticModel.functions,
      expandedDialogs,
      expandedChoices,
      buildFunctionTree
    );
  }, [selectedNPC, filteredDialogs, semanticModel.dialogs, semanticModel.functions, expandedDialogs, expandedChoices, buildFunctionTree]);

  const itemData = useMemo(() => ({
    flatItems,
    selectedDialog,
    selectedFunctionName,
    onSelectDialog,
    onToggleDialogExpand,
    onToggleChoiceExpand,
  }), [
    flatItems,
    selectedDialog,
    selectedFunctionName,
    onSelectDialog,
    onToggleDialogExpand,
    onToggleChoiceExpand,
  ]);

  const handleOpenCreateDialog = () => {
    const defaultName = selectedNPC ? `DIA_${selectedNPC}_Start` : '';
    setNewDialogName(defaultName);
    setCreateError(null);
    setIsCreateOpen(true);
  };

  const handleCreateDialog = async () => {
    const dialogName = newDialogName.trim();
    if (!dialogName || !onAddDialog) {
      return;
    }

    setIsCreating(true);
    setCreateError(null);
    try {
      await onAddDialog(dialogName);
      setIsCreateOpen(false);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'Failed to create dialog.');
    } finally {
      setIsCreating(false);
    }
  };

  const handleOpenTeacherDialog = () => {
    setTeacherSkillId('1H');
    setTeacherMaxLevel('30');
    setTeacherDescription(getTeacherSkill('1H').defaultDescription);
    setIsTeacherDescriptionEdited(false);
    setIsTeacherMaxLevelEdited(false);
    setTeacherError(null);
    setIsTeacherOpen(true);
  };

  const handleTeacherSkillChange = (skillId: TeacherSkillId) => {
    const skill = getTeacherSkill(skillId);
    setTeacherSkillId(skillId);
    if (!isTeacherDescriptionEdited) {
      setTeacherDescription(skill.defaultDescription);
    }
    if (!isTeacherMaxLevelEdited) {
      setTeacherMaxLevel(skill.defaultMaxLevel != null ? String(skill.defaultMaxLevel) : '');
    }
  };

  const teacherSkill = getTeacherSkill(teacherSkillId);
  const teacherNeedsMaxLevel = skillHasMaxLevel(teacherSkill);

  const handleCreateTeacherDialog = async () => {
    // One-shot talent teachers (hunting/alchemy/thief) have no level cap.
    const maxLevel = teacherNeedsMaxLevel ? parseInt(teacherMaxLevel, 10) : 0;
    if (
      !onCreateTeacherDialog ||
      (teacherNeedsMaxLevel && (!Number.isFinite(maxLevel) || maxLevel <= 0)) ||
      !teacherDescription.trim()
    ) {
      return;
    }

    setIsCreatingTeacher(true);
    setTeacherError(null);
    try {
      await onCreateTeacherDialog({
        skillId: teacherSkillId,
        maxLevel,
        description: teacherDescription.trim()
      });
      setIsTeacherOpen(false);
    } catch (error) {
      setTeacherError(error instanceof Error ? error.message : 'Failed to create teacher dialog.');
    } finally {
      setIsCreatingTeacher(false);
    }
  };

  const handleOpenTraderDialog = () => {
    setTraderDescription(TRADER_DEFAULT_DESCRIPTION);
    setTraderError(null);
    setIsTraderOpen(true);
  };

  const handleCreateTraderDialog = async () => {
    if (!onCreateTraderDialog || !traderDescription.trim()) {
      return;
    }

    setIsCreatingTrader(true);
    setTraderError(null);
    try {
      await onCreateTraderDialog({ description: traderDescription.trim() });
      setIsTraderOpen(false);
    } catch (error) {
      setTraderError(error instanceof Error ? error.message : 'Failed to create trader dialog.');
    } finally {
      setIsCreatingTrader(false);
    }
  };

  return (
    <Paper
      data-ui-pattern={SEARCHABLE_PANE_PATTERN}
      sx={(theme) => ({ ...searchablePaneShellSx(theme), width: 350, flexShrink: 0, height: '100%', borderLeft: 1, borderRight: 1, borderColor: 'divider' })}
      elevation={1}
    >
      <Box sx={searchablePaneHeaderSx}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant='h6'>Dialogs</Typography>
          <Box>
            <Tooltip title={selectedNPC ? 'Create Teacher Dialog' : 'Select an NPC first'}>
              <span>
                <IconButton
                  size='small'
                  aria-label='Create Teacher Dialog'
                  onClick={handleOpenTeacherDialog}
                  disabled={!selectedNPC || !onCreateTeacherDialog}
                >
                  <SchoolIcon fontSize='small' />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title={selectedNPC ? 'Create Trader Dialog' : 'Select an NPC first'}>
              <span>
                <IconButton
                  size='small'
                  aria-label='Create Trader Dialog'
                  onClick={handleOpenTraderDialog}
                  disabled={!selectedNPC || !onCreateTraderDialog}
                >
                  <StorefrontIcon fontSize='small' />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title={selectedNPC ? 'Add Dialog' : 'Select an NPC first'}>
              <span>
                <IconButton
                  size='small'
                  aria-label='Add Dialog'
                  onClick={handleOpenCreateDialog}
                  disabled={!selectedNPC || !onAddDialog}
                >
                  <AddIcon fontSize='small' />
                </IconButton>
              </span>
            </Tooltip>
          </Box>
        </Box>
        {selectedNPC && (
          <Typography variant='caption' color='text.secondary'>
            {selectedNPC} - {filteredDialogs.length} of {dialogsForNPC.length} shown
          </Typography>
        )}
      </Box>

      {selectedNPC && (
        <Box sx={searchablePaneFilterStripSx}>
          <TextField
            size='small'
            fullWidth
            placeholder='Filter dialogs...'
            value={dialogFilter}
            onChange={(e) => setDialogFilter(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position='start'>
                  <FilterListIcon fontSize='small' color='action' />
                </InputAdornment>
              ),
              endAdornment: dialogFilter ? (
                <InputAdornment position='end'>
                  <IconButton
                    size='small'
                    onClick={() => setDialogFilter('')}
                    aria-label='Clear filter'
                  >
                    <ClearIcon fontSize='small' />
                  </IconButton>
                </InputAdornment>
              ) : null
            }}
            sx={searchablePaneTextFieldSx}
          />
        </Box>
      )}

      <Dialog open={isCreateOpen} onClose={() => !isCreating && setIsCreateOpen(false)} fullWidth maxWidth='sm'>
        <DialogTitle>Create Dialog</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin='dense'
            fullWidth
            label='Dialog Name'
            placeholder='DIA_MyNpc_NewDialog'
            value={newDialogName}
            onChange={(e) => setNewDialogName(e.target.value)}
            disabled={isCreating}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void handleCreateDialog();
              }
            }}
          />
          {createError && (
            <Typography variant='caption' color='error' sx={{ mt: 1, display: 'block' }}>
              {createError}
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setIsCreateOpen(false)} disabled={isCreating}>Cancel</Button>
          <Button
            onClick={() => void handleCreateDialog()}
            variant='contained'
            disabled={!newDialogName.trim() || isCreating}
          >
            Create
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={isTeacherOpen} onClose={() => !isCreatingTeacher && setIsTeacherOpen(false)} fullWidth maxWidth='sm'>
        <DialogTitle>Create Teacher Dialog</DialogTitle>
        <DialogContent>
          <TextField
            select
            autoFocus
            margin='dense'
            fullWidth
            label='Skill'
            value={teacherSkillId}
            onChange={(e) => handleTeacherSkillChange(e.target.value as TeacherSkillId)}
            disabled={isCreatingTeacher}
          >
            {TEACHER_SKILL_GROUPS.flatMap((group) => [
              <ListSubheader key={group.label}>{group.label}</ListSubheader>,
              ...group.skills.map((skill) => (
                <MenuItem key={skill.id} value={skill.id}>{skill.label}</MenuItem>
              ))
            ])}
          </TextField>
          {teacherNeedsMaxLevel && (
            <TextField
              margin='dense'
              fullWidth
              label='Max Level'
              type='number'
              value={teacherMaxLevel}
              onChange={(e) => {
                setTeacherMaxLevel(e.target.value);
                setIsTeacherMaxLevelEdited(true);
              }}
              disabled={isCreatingTeacher}
              helperText={
                teacherSkill.category === 'attribute'
                  ? 'Highest attribute value this teacher can train to'
                  : 'Highest skill value this teacher can train to'
              }
            />
          )}
          <TextField
            margin='dense'
            fullWidth
            label='Description'
            value={teacherDescription}
            onChange={(e) => {
              setTeacherDescription(e.target.value);
              setIsTeacherDescriptionEdited(true);
            }}
            disabled={isCreatingTeacher}
            helperText='Shown in the dialog menu and spoken by the hero'
          />
          {teacherError && (
            <Typography variant='caption' color='error' sx={{ mt: 1, display: 'block' }}>
              {teacherError}
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setIsTeacherOpen(false)} disabled={isCreatingTeacher}>Cancel</Button>
          <Button
            onClick={() => void handleCreateTeacherDialog()}
            variant='contained'
            disabled={
              isCreatingTeacher ||
              !teacherDescription.trim() ||
              (teacherNeedsMaxLevel && !(parseInt(teacherMaxLevel, 10) > 0))
            }
          >
            Create
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={isTraderOpen} onClose={() => !isCreatingTrader && setIsTraderOpen(false)} fullWidth maxWidth='sm'>
        <DialogTitle>Create Trader Dialog</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin='dense'
            fullWidth
            label='Description'
            value={traderDescription}
            onChange={(e) => setTraderDescription(e.target.value)}
            disabled={isCreatingTrader}
            helperText='Shown in the dialog menu; opens the trade screen'
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void handleCreateTraderDialog();
              }
            }}
          />
          {traderError && (
            <Typography variant='caption' color='error' sx={{ mt: 1, display: 'block' }}>
              {traderError}
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setIsTraderOpen(false)} disabled={isCreatingTrader}>Cancel</Button>
          <Button
            onClick={() => void handleCreateTraderDialog()}
            variant='contained'
            disabled={isCreatingTrader || !traderDescription.trim()}
          >
            Create
          </Button>
        </DialogActions>
      </Dialog>

      <Box sx={searchablePaneContentSx}>
        {selectedNPC ? (
          flatItems.length > 0 ? (
            <AutoSizer>
              {({ height, width }: { height: number; width: number }) => (
                <List
                  height={height}
                  itemCount={flatItems.length}
                  itemSize={60}
                  itemData={itemData}
                  width={width}
                  overscanCount={5}
                >
                  {Row}
                </List>
              )}
            </AutoSizer>
          ) : (
            <Box sx={{ p: 2, textAlign: 'center' }}>
              <Typography variant='body2' color='text.secondary'>
                {dialogFilter ? `No dialogs match "${dialogFilter}"` : 'No dialogs available'}
              </Typography>
            </Box>
          )
        ) : (
          <Box sx={{ p: 2 }}>
            <Typography variant='body2' color='text.secondary'>
              Select an NPC to view dialogs
            </Typography>
          </Box>
        )}
      </Box>
    </Paper>
  );
};

export default DialogTree;

