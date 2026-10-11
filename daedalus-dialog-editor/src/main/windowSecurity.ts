import type { WebContents } from 'electron';

/**
 * Deny-by-default window security for a BrowserWindow's webContents:
 * - Block every `window.open` / target=_blank (nothing legitimate opens
 *   external windows).
 * - Allow navigation only to the dev server (development) or the window's own
 *   current URL (a `file:` reload); prevent everything else.
 */
export function applyWindowSecurity(webContents: WebContents): void {
  webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  webContents.on('will-navigate', (event, url) => {
    const allowed =
      process.env.NODE_ENV === 'development'
        ? url.startsWith('http://localhost:5173')
        : url === webContents.getURL();
    if (!allowed) {
      event.preventDefault();
    }
  });
}
