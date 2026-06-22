import type React from 'react';

/**
 * Builds one keydown handler per field of a multi-field action row so that Tab
 * and Shift+Tab move between the fields in the row (native browser focus order)
 * and only fall back to the card-level handler at the row boundaries:
 *
 *  - Tab on the last field advances to the next action card,
 *  - Shift+Tab on the first field returns to the previous action card.
 *
 * Every non-Tab key always delegates to the card-level handler, so Enter /
 * Escape / Ctrl+Enter behaviour is preserved on each field.
 *
 * Fixes issue #183 (item 3): inside "Give Inventory Item" pressing Tab jumped
 * straight to the next action card instead of moving Giver -> Receiver -> Item.
 */
export function createRowTabHandlers(
  cardKeyDown: (e: React.KeyboardEvent) => void,
  fieldCount: number
): Array<(e: React.KeyboardEvent) => void> {
  return Array.from({ length: fieldCount }, (_unused, index) => (e: React.KeyboardEvent) => {
    if (e.key === 'Tab') {
      const movingForward = !e.shiftKey;
      const atRowEdge = movingForward ? index === fieldCount - 1 : index === 0;
      if (!atRowEdge) {
        // Let the browser move focus to the adjacent field in the same row.
        return;
      }
    }
    cardKeyDown(e);
  });
}
