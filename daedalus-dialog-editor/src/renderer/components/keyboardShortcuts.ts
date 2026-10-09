/**
 * Every keyboard shortcut the app has, as the keyboard-shortcuts sheet shows
 * it (#275) — the app's one piece of in-app help.
 *
 * The listeners themselves stay where they are, spread over a dozen files;
 * this is a description of them, not their source. What keeps it honest is
 * `probe`: the keystrokes a row stands for, which `keyboardShortcuts.test.ts`
 * replays against the real dispatch. A row without one (the dialog editor's
 * keys live in `ActionCard`'s `onKeyDown`, out of reach of a hook test) is
 * kept true by hand.
 */

export type ShortcutGroup = 'Everywhere' | 'Dialog editor' | 'World editor';

export interface ShortcutProbe {
  /** Which dispatch owns the keystrokes: `useWorldShortcuts`, `cameraSlotFor`
   *  or `flyMoveFor`. */
  listener: 'world' | 'cameraSlot' | 'fly';
  events: KeyboardEventInit[];
}

export interface KeyboardShortcut {
  group: ShortcutGroup;
  keys: string;
  action: string;
  probe?: ShortcutProbe;
}

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = ['Everywhere', 'Dialog editor', 'World editor'];

export const KEYBOARD_SHORTCUTS: readonly KeyboardShortcut[] = [
  { group: 'Everywhere', keys: 'F1', action: 'Show this sheet' },
  {
    group: 'Everywhere', keys: 'Ctrl+S', action: 'Save (in the World editor, asks first)',
    probe: { listener: 'world', events: [{ key: 's', ctrlKey: true }] },
  },
  {
    group: 'Everywhere', keys: 'Ctrl+Z', action: 'Undo',
    probe: { listener: 'world', events: [{ key: 'z', ctrlKey: true }] },
  },
  {
    group: 'Everywhere', keys: 'Ctrl+Y or Ctrl+Shift+Z', action: 'Redo',
    probe: { listener: 'world', events: [{ key: 'y', ctrlKey: true }, { key: 'Z', ctrlKey: true, shiftKey: true }] },
  },

  { group: 'Dialog editor', keys: 'Ctrl+F', action: 'Search the project; Esc closes it' },
  { group: 'Dialog editor', keys: 'Enter', action: 'New dialog line after this one, other speaker' },
  { group: 'Dialog editor', keys: 'Shift+Enter', action: 'New dialog line after this one, same speaker' },
  { group: 'Dialog editor', keys: 'Ctrl+Enter', action: 'Add an action after this one, picking its type' },
  { group: 'Dialog editor', keys: 'Tab / Shift+Tab', action: 'Next / previous action' },
  { group: 'Dialog editor', keys: 'Alt+↑ / Alt+↓', action: 'Move the action up / down' },
  { group: 'Dialog editor', keys: 'Backspace', action: 'Delete an empty dialog line' },
  { group: 'Dialog editor', keys: 'Esc', action: 'Delete the action (asks first)' },

  {
    group: 'World editor', keys: 'W / E', action: 'Move / turn gizmo',
    probe: { listener: 'world', events: [{ key: 'w' }, { key: 'e' }] },
  },
  {
    group: 'World editor', keys: 'Ctrl+C / Ctrl+V', action: 'Copy / paste the selection',
    probe: { listener: 'world', events: [{ key: 'c', ctrlKey: true }, { key: 'v', ctrlKey: true }] },
  },
  {
    group: 'World editor', keys: 'Ctrl+D', action: 'Duplicate the selection',
    probe: { listener: 'world', events: [{ key: 'd', ctrlKey: true }] },
  },
  {
    group: 'World editor', keys: 'Del', action: 'Delete the selection (asks first only when children would go too)',
    probe: { listener: 'world', events: [{ key: 'Delete' }] },
  },
  {
    group: 'World editor', keys: 'G / Shift+G', action: 'Rest the selection on the ground / sink its pivot into it',
    probe: { listener: 'world', events: [{ key: 'g' }, { key: 'G', shiftKey: true }] },
  },
  { group: 'World editor', keys: 'Space', action: 'Place the selected asset (Assets panel); a double-click does too' },
  {
    group: 'World editor', keys: 'Esc', action: 'Cancel a placement, else clear the selection',
    probe: { listener: 'world', events: [{ key: 'Escape' }] },
  },
  {
    group: 'World editor', keys: 'WASD / arrows; PageUp / PageDown',
    action: 'Nudge in the camera plane, hold to keep moving; PageUp/Down vertically; Shift ×10',
    probe: {
      listener: 'world',
      events: ['w', 'a', 's', 'd', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown']
        .map((key) => ({ key })),
    },
  },
  { group: 'World editor', keys: '.', action: 'Frame the selection' },
  { group: 'World editor', keys: 'Home', action: 'Frame the world' },
  { group: 'World editor', keys: 'F3', action: 'Walk with WASD; F3 again to stop' },
  {
    group: 'World editor', keys: 'Right-drag + WASD, Space, X', action: 'Fly; Shift for faster, Ctrl for slower',
    probe: { listener: 'fly', events: ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'KeyX'].map((code) => ({ code })) },
  },
  {
    group: 'World editor', keys: 'Ctrl+1 … 4', action: 'Recall a stored camera',
    probe: { listener: 'cameraSlot', events: [1, 2, 3, 4].map((n) => ({ code: `Digit${n}`, ctrlKey: true })) },
  },
  {
    group: 'World editor', keys: 'Ctrl+Shift+1 … 4', action: 'Store the camera',
    probe: {
      listener: 'cameraSlot',
      events: [1, 2, 3, 4].map((n) => ({ code: `Digit${n}`, ctrlKey: true, shiftKey: true })),
    },
  },
];
