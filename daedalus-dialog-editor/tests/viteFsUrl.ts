/**
 * The URL Vite serves an arbitrary file from, for a spec that dynamic-imports
 * a fixture into the page. Vite wants forward slashes and exactly one of them
 * after `/@fs`, so a Windows resolve (`C:\...`) becomes `/@fs/C:/...` while a
 * POSIX one stays `/@fs/home/...` (#523).
 */
export function viteFsUrl(absPath: string): string {
  return `/@fs/${absPath.replace(/\\/g, '/').replace(/^\/+/, '')}`;
}
