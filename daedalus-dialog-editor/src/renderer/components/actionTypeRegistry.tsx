/**
 * Action type registry: the one place that names an action type and gives it
 * an icon. The add-action menu, the card tooltip and the card icon all read
 * it (docs/architecture/dialog-editor.md), so a label cannot drift between
 * them.
 */
import type { SvgIconComponent } from '@mui/icons-material';
import {
  Chat as ChatIcon,
  CallSplit as CallSplitIcon,
  Description as DescriptionIcon,
  LibraryBooks as LibraryBooksIcon,
  Inventory as InventoryIcon,
  CardGiftcard as CardGiftcardIcon,
  Gavel as GavelIcon,
  EmojiPeople as EmojiPeopleIcon,
  Navigation as NavigationIcon,
  SwapHoriz as SwapHorizIcon,
  Code as CodeIcon,
  Edit as EditIcon,
  Stop as StopIcon,
  Block as BlockIcon,
  PlaylistRemove as PlaylistRemoveIcon,
  PlayArrow as PlayArrowIcon,
  Star as StarIcon,
  School as SchoolIcon,
  PersonAdd as PersonAddIcon,
  RemoveShoppingCart as RemoveShoppingCartIcon,
  Inventory2 as Inventory2Icon,
  DirectionsWalk as DirectionsWalkIcon,
  Comment as CommentIcon
} from '@mui/icons-material';
import type { ActionTypeId } from './actionTypes';

export interface ActionTypeEntry {
  label: string;
  icon: SvgIconComponent;
  /** Offered in the add-action menu. Defaults to true. */
  addable?: boolean;
}

export const ACTION_TYPE_REGISTRY: Record<ActionTypeId, ActionTypeEntry> = {
  dialogLine: { label: 'Dialog Line', icon: ChatIcon },
  choice: { label: 'Choice', icon: CallSplitIcon },
  logEntry: { label: 'Log Entry', icon: DescriptionIcon },
  createTopic: { label: 'Create Topic', icon: LibraryBooksIcon },
  logSetTopicStatus: { label: 'Log Set Status', icon: DescriptionIcon },
  createInventoryItems: { label: 'Create Inventory Items', icon: InventoryIcon },
  giveInventoryItems: { label: 'Give Inventory Items', icon: CardGiftcardIcon },
  attackAction: { label: 'Attack Action', icon: GavelIcon },
  setAttitudeAction: { label: 'Set Attitude', icon: EmojiPeopleIcon },
  chapterTransition: { label: 'Chapter Transition', icon: NavigationIcon },
  exchangeRoutine: { label: 'Exchange Routine', icon: SwapHorizIcon },
  setVariableAction: { label: 'Set Variable', icon: EditIcon },
  stopProcessInfosAction: { label: 'End Dialog', icon: StopIcon },
  setRefuseTalkAction: { label: 'Refuse Talk', icon: BlockIcon },
  clearChoicesAction: { label: 'Clear Choices', icon: PlaylistRemoveIcon },
  playAniAction: { label: 'Play Animation', icon: PlayArrowIcon },
  givePlayerXPAction: { label: 'Give XP', icon: StarIcon },
  pickpocketAction: { label: 'Pickpocket', icon: GavelIcon },
  startOtherRoutineAction: { label: 'Start Other Routine', icon: SwapHorizIcon },
  teachAction: { label: 'Teach', icon: SchoolIcon },
  giveTradeInventoryAction: { label: 'Give Trade Inventory', icon: Inventory2Icon },
  removeInventoryItemsAction: { label: 'Remove Inventory Items', icon: RemoveShoppingCartIcon },
  insertNpcAction: { label: 'Insert NPC', icon: PersonAddIcon },
  heroFollowsAction: { label: 'Hero Follows NPC', icon: DirectionsWalkIcon },
  conditionalAction: { label: 'If / Else Block', icon: CallSplitIcon },
  // Parser-preserved only: never offered in the add-action menu.
  commentAction: { label: 'Comment', icon: CommentIcon, addable: false },
  customAction: { label: 'Custom Action', icon: CodeIcon }
};

/** Action types the add-action menu offers, in registry order. */
export const ADDABLE_ACTION_TYPES: ActionTypeId[] = (Object.keys(ACTION_TYPE_REGISTRY) as ActionTypeId[])
  .filter((id) => ACTION_TYPE_REGISTRY[id].addable !== false);
