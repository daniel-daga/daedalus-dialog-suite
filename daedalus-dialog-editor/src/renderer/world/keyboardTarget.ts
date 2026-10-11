/**
 * Whether a keystroke belongs to something *over* the World surface rather than
 * to the surface itself — the guard every window-level shortcut here shares.
 *
 * Two cases, and the second is the one a tagName check alone misses: MUI
 * renders a `Select`'s options as `li[role="option"]` inside a popover and a
 * `Dialog`'s buttons as plain `button`s, so arrowing through the Snap step
 * dropdown or pressing Delete inside the save confirm would otherwise reach the
 * surface's own handler — nudging a VOB (and recording an undo entry) while the
 * user believes they are only picking a menu item.
 *
 * Down here rather than beside the surface's shortcuts because the camera's
 * keys are window listeners too, and `NavController` cannot import a component
 * (`src/renderer/world/` has no React in it, by rule). It had only the tagName
 * half, so Home inside an open Select framed the world behind it — §5.4 item 20
 * of the 2026-09-04 review.
 */
export function isTypingOrInPopover(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (element?.isContentEditable) return true;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(element?.tagName ?? '')) return true;
  // `event.target` is the bare `Window` for a shortcut fired with nothing
  // focused, which has no `closest` — only an in-page element can be inside
  // a popover.
  return element instanceof Element
    && element.closest('[role="listbox"], [role="menu"], [role="dialog"]') !== null;
}
