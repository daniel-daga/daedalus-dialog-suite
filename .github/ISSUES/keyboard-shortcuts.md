# Feature: Keyboard shortcuts for common actions

## Summary
Currently there is limited keyboard navigation. Power users would benefit from shortcuts for common actions.

## Problem
Users must use the mouse for most operations, which slows down workflow for experienced users who prefer keyboard-driven interfaces.

## Proposed Solution
Implement comprehensive keyboard shortcuts:

### Global Shortcuts
| Shortcut | Action |
|----------|--------|
| `Ctrl+O` | Open file |
| `Ctrl+Shift+O` | Open project |
| `Ctrl+S` | Save file |
| `Ctrl+Z` | Undo |
| `Ctrl+Shift+Z` | Redo |
| `Ctrl+F` | Focus search (when implemented) |
| `Escape` | Close dialogs/deselect |

### Navigation Shortcuts
| Shortcut | Action |
|----------|--------|
| `↑/↓` | Navigate NPC/dialog list |
| `Enter` | Select item |
| `←/→` | Collapse/expand tree nodes |
| `Tab` | Move between panels |

### Editor Shortcuts
| Shortcut | Action |
|----------|--------|
| `Ctrl+Enter` | Add new dialog line after current |
| `Ctrl+Delete` | Delete current action |
| `Alt+↑/↓` | Move action up/down |
| `Ctrl+D` | Duplicate action |

## Implementation Notes
- Use a centralized keyboard shortcut manager
- Make shortcuts customizable (future enhancement)
- Show shortcuts in tooltips and menus
- Ensure shortcuts don't conflict with system/browser defaults
- Consider using a library like `react-hotkeys-hook`

## Acceptance Criteria
- [ ] All listed shortcuts are implemented
- [ ] Shortcuts are shown in tooltips
- [ ] Shortcuts work regardless of focus (where applicable)
- [ ] No conflicts with system shortcuts
- [ ] Shortcuts are documented in help/about
