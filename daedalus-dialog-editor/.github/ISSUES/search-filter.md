# Feature: Search and filter dialogs

## Summary
Currently there is no way to search across dialogs in project mode. With many NPCs/dialogs, finding specific content is difficult.

## Problem
Gothic mod projects can have hundreds of NPCs and thousands of dialogs. Finding a specific dialog or text content requires manually browsing through the tree, which is time-consuming and error-prone.

## Proposed Solution
Implement a comprehensive search and filter system:

### Search Features
- **Global search**: Search across all dialogs in the project
- **Search scope options**:
  - Dialog names
  - Dialog text content
  - Function names
  - NPC names
- **Search results panel** showing matches with context
- **Click-to-navigate** from search results to dialog

### Filter Features
- Filter NPC list by name
- Filter dialog list by:
  - Name pattern
  - Has unsaved changes
  - Contains specific action types
  - Important/permanent flags

### UI Design
- Search bar in the toolbar or sidebar
- Real-time filtering as user types
- Highlight matching text in results
- Keyboard shortcut `Ctrl+F` to focus search

## Implementation Notes
- Use debouncing for search input to avoid excessive filtering
- Consider indexing dialog content for faster search in large projects
- Highlight search terms in the dialog tree
- Remember last search query per session

## Acceptance Criteria
- [ ] Users can search by dialog name
- [ ] Users can search within dialog text content
- [ ] Search results show file location and context
- [ ] Clicking a result navigates to that dialog
- [ ] NPC list can be filtered by typing
- [ ] Search is responsive even with many dialogs
- [ ] `Ctrl+F` focuses the search input
