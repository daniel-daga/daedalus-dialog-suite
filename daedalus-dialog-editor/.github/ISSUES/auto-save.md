# Feature: Auto-save and crash recovery

## Summary
Currently there is no periodic auto-save or recovery drafts. If the app crashes or is closed unexpectedly, unsaved work is lost.

## Problem
Users can lose significant work if:
- The application crashes
- The system loses power
- They accidentally close the app without saving
- The app is terminated by the OS

## Proposed Solution
Implement an auto-save system with crash recovery:

### Auto-save
- Periodically save drafts to a temporary location (e.g., every 30-60 seconds when changes are detected)
- Store drafts in app data directory (not alongside original files)
- Clean up drafts when file is properly saved

### Crash Recovery
- On startup, check for orphaned draft files
- Prompt user to recover unsaved changes if drafts exist
- Show comparison between draft and original file
- Allow user to accept recovery or discard draft

## Implementation Notes
- Use Electron's `app.getPath('userData')` for draft storage
- Store metadata (original file path, timestamp) with each draft
- Consider using a debounced save to avoid excessive I/O
- Handle the case where original file was modified externally

## Acceptance Criteria
- [ ] Changes are auto-saved to drafts every 60 seconds
- [ ] Auto-save only triggers when there are unsaved changes
- [ ] On startup, orphaned drafts are detected and recovery is offered
- [ ] User can choose to recover or discard drafts
- [ ] Drafts are cleaned up after successful save
- [ ] Visual indicator shows auto-save status
