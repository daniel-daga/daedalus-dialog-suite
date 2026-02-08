import React, { memo } from 'react';
import {
  ListItem,
  ListItemButton,
  ListItemText,
  IconButton,
  Tooltip
} from '@mui/material';
import { OpenInNew as OpenInNewIcon } from '@mui/icons-material';
import { ListChildComponentProps, areEqual } from 'react-window';

interface QuestItemData {
  quests: any[];
  selectedQuest: string | null;
  onSelectQuest: (questName: string) => void;
  navigateToSymbol: (name: string, options?: any) => void;
}

const QuestItem = memo(({ index, style, data }: ListChildComponentProps<QuestItemData>) => {
  const { quests, selectedQuest, onSelectQuest, navigateToSymbol } = data;
  const quest = quests[index];

  if (!quest) return null;

  return (
    <ListItem
      style={style}
      component="div"
      disablePadding
      secondaryAction={
        <Tooltip title="Follow reference" arrow>
          <IconButton
            edge="end"
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              navigateToSymbol(quest.name, { preferSource: true });
            }}
          >
            <OpenInNewIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      }
    >
      <ListItemButton
        selected={selectedQuest === quest.name}
        onClick={() => onSelectQuest(quest.name)}
      >
        <ListItemText
          primary={String(quest.value).replace(/^"|"$/g, '')} // Strip quotes for display
          secondary={quest.name}
          primaryTypographyProps={{ noWrap: true }}
          secondaryTypographyProps={{ noWrap: true }}
        />
      </ListItemButton>
    </ListItem>
  );
}, areEqual); // Use react-window's default comparator which handles basic props check

QuestItem.displayName = 'QuestItem';

export default QuestItem;
