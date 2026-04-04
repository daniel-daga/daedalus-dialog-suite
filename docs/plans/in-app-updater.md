# In-App Updater Mechanism

## Approach: Custom Lightweight Updater (no `electron-updater`)

### Why not `electron-updater`?

- Requires a `latest.yml` metadata file in the GitHub Release — the current workflow does not produce one (`"publish": null` in electron-builder config).
- Expects proper semver tags (e.g. `v0.1.0`), not a rolling `windows-latest` tag.
- The workflow renames the installer to a fixed name, breaking electron-updater's expected filename pattern.
- Retrofitting the workflow to satisfy electron-updater's requirements would mean overhauling the entire release strategy.

### Why a custom updater works well here

- The rolling `windows-latest` tag is already established and works.
- The GitHub Releases API is public and free (60 req/hr unauthenticated — more than enough).
- NSIS installers support silent `/S` mode for in-place upgrades.
- Total implementation is ~200-300 lines across a few files, with zero new dependencies.

---

## Phase 1: CI Workflow Changes

**File**: `.github/workflows/build-windows.yml`

Upload an `update-meta.json` alongside the installer so the app has a clean JSON endpoint for version checks.

### New step (before the publish step)

```yaml
- name: Generate update metadata
  shell: pwsh
  run: |
    @{
      version = "${{ steps.version.outputs.BUILD_VERSION }}"
      baseVersion = "${{ steps.version.outputs.BASE_VERSION }}"
      buildNumber = [int]${{ github.run_number }}
    } | ConvertTo-Json | Set-Content "daedalus-dialog-editor/dist/update-meta.json" -Encoding UTF8
```

### Modified publish step

```yaml
- name: Publish rolling release
  uses: softprops/action-gh-release@v2
  with:
    tag_name: windows-latest
    name: Latest Windows Build (${{ steps.version.outputs.BUILD_VERSION }})
    body: |
      Automated rolling Windows build from GitHub Actions.

      **Version:** `${{ steps.version.outputs.BUILD_VERSION }}`
      **Base version:** `${{ steps.version.outputs.BASE_VERSION }}`
      **Build number:** #${{ github.run_number }}

      Download `daedalus-dialog-editor-windows-latest.exe` from this release.
    prerelease: true
    files: |
      daedalus-dialog-editor/dist/daedalus-dialog-editor-windows-latest.exe
      daedalus-dialog-editor/dist/update-meta.json
    make_latest: false
```

---

## Phase 2: `UpdaterService` (Main Process)

**New file**: `src/main/services/UpdaterService.ts`

### Types

```typescript
interface UpdateMetadata {
  version: string;       // "0.1.0-build.42"
  baseVersion: string;   // "0.1.0"
  buildNumber: number;   // 42
}

interface UpdateCheckResult {
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion?: string;
  latestBuildNumber?: number;
  downloadUrl?: string;
  releaseUrl?: string;
}
```

### Responsibilities

| Method | Purpose |
|---|---|
| `checkForUpdate()` | Fetch `update-meta.json` from the `windows-latest` release via the GitHub API. Compare build numbers. Return `UpdateCheckResult`. |
| `downloadUpdate(url, onProgress)` | Stream the `.exe` to `app.getPath('temp')/daedalus-update-{version}.exe`. Report progress via callback. |
| `installUpdate(path)` | `spawn(path, ['/S'], { detached: true, stdio: 'ignore' })` then `app.quit()`. |

### Key design decisions

| Concern | Decision |
|---|---|
| API endpoint | `https://api.github.com/repos/daniel-daga/daedalus-dialog-suite/releases/tags/windows-latest` |
| Version comparison | Parse build number from `X.Y.Z-build.N`, compare `N` numerically. Higher = newer. Fallback to base-version comparison on bumps. |
| Download location | `app.getPath('temp')/daedalus-update-{version}.exe` |
| Install trigger | NSIS `/S` flag for silent install, then `app.quit()` |
| Rate limiting | Cache last-check timestamp in settings; skip if checked within the last hour |
| Dev mode | Skip check when version lacks `-build.` suffix |
| Error handling | Network errors logged silently (non-blocking). Download errors surface to UI. |

---

## Phase 3: IPC Channels

### New handlers in `main.ts`

| Channel | Direction | Returns |
|---|---|---|
| `updater:checkForUpdate` | renderer -> main | `UpdateCheckResult` |
| `updater:downloadUpdate` | renderer -> main | `string` (installer file path) |
| `updater:installUpdate` | renderer -> main | void (quits app) |
| `updater:downloadProgress` | main -> renderer | `number` (percent 0-100) |

### Preload bridge additions (`preload.ts`)

```typescript
checkForUpdate: () => ipcRenderer.invoke('updater:checkForUpdate'),
downloadUpdate: () => ipcRenderer.invoke('updater:downloadUpdate'),
installUpdate: (installerPath: string) => ipcRenderer.invoke('updater:installUpdate', installerPath),
onDownloadProgress: (callback: (percent: number) => void) => {
  const listener = (_event: Electron.IpcRendererEvent, percent: number) => callback(percent);
  ipcRenderer.on('updater:downloadProgress', listener);
  return () => { ipcRenderer.removeListener('updater:downloadProgress', listener); };
},
```

---

## Phase 4: Renderer UI

### 4a. Footer update indicator

The existing footer shows `v{appVersion}`. When an update is available, show a clickable MUI `Chip` next to the version text: **"Update available: v0.1.0-build.45"**.

### 4b. Update dialog

Clicking the indicator opens a MUI `Dialog` with:
- Current version vs. available version
- "Download & Install" button
- Download progress bar (`LinearProgress`)
- Link to the GitHub release page
- "Remind Me Later" dismiss button

### 4c. Automatic startup check

In `App.tsx`, add a `useEffect` that calls `checkForUpdate()` ~5 seconds after mount (if auto-check is enabled). Delay avoids slowing perceived startup.

### 4d. New component

`src/renderer/components/UpdateNotification.tsx` — encapsulates the chip + dialog. Local React state is sufficient for update flow:

```
idle -> checking -> update-available -> downloading(%) -> ready-to-install -> installing
                 -> up-to-date
                 -> error(message)
```

---

## Phase 5: Version Comparison

Given `0.1.0-build.N`:

```typescript
function parseBuildNumber(version: string): number | null {
  const match = version.match(/-build\.(\d+)$/);
  return match ? parseInt(match[1], 10) : null;
}

function isNewerVersion(remote: string, local: string): boolean {
  const remoteBuild = parseBuildNumber(remote);
  const localBuild = parseBuildNumber(local);

  if (remoteBuild !== null && localBuild !== null) {
    return remoteBuild > localBuild;
  }

  // Fallback: base version comparison (handles 0.2.0 > 0.1.0)
  const r = remote.split('-')[0].split('.').map(Number);
  const l = local.split('-')[0].split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((r[i] || 0) > (l[i] || 0)) return true;
    if ((r[i] || 0) < (l[i] || 0)) return false;
  }
  return false;
}
```

---

## Phase 6: Settings Persistence

Extend `SettingsService` to store update preferences:

```json
{
  "recentProjects": [],
  "updater": {
    "autoCheckOnStartup": true,
    "lastCheckTimestamp": 1712246400000,
    "dismissedVersion": null
  }
}
```

`dismissedVersion` prevents re-showing a dismissed notification until a newer build appears.

---

## Phase 7: Security Considerations

- GitHub API and downloads use HTTPS — same trust chain as original download.
- Validate that `installerPath` passed to `installUpdate` points to a file within `app.getPath('temp')` (reuse `PathValidationService` pattern).
- Future enhancement: add SHA256 checksum to `update-meta.json` and verify the download.

---

## Testing Strategy

| Layer | Approach |
|---|---|
| Version parsing/comparison | Pure function unit tests: edge cases for build numbers, missing suffix, base bumps |
| `UpdaterService` | Mock HTTPS responses. Test check, download progress, error paths. |
| IPC round-trip | Jest with mocked `ipcMain`/`ipcRenderer` |
| UI component | React Testing Library: state transitions (idle -> checking -> available -> downloading -> ready) |
| E2E | Optional: Playwright with mock HTTP server serving fake release payload |
| Manual | Build with low build number, create test release with higher number, verify full flow |

---

## Implementation Sequence

1. **Workflow change** — add `update-meta.json` to the release, run one build so metadata exists.
2. **`UpdaterService.ts`** — core logic, testable in isolation.
3. **Unit tests** for `UpdaterService`.
4. **IPC wiring** — handlers in `main.ts`, bridge in `preload.ts`, types in `global.d.ts`.
5. **`UpdateNotification.tsx`** — renderer component.
6. **Integrate into `App.tsx`** — footer area + startup check.
7. **E2E manual testing** with a real build.

---

## Files to Create/Modify

| File | Action |
|---|---|
| `.github/workflows/build-windows.yml` | Add `update-meta.json` generation + upload |
| `src/main/services/UpdaterService.ts` | **New** — core update logic |
| `src/main/main.ts` | Add `UpdaterService` instantiation + IPC handlers |
| `src/main/preload.ts` | Add updater API to `editorAPI` bridge |
| `src/renderer/types/global.d.ts` | Extend `EditorAPI` interface |
| `src/shared/updater-types.ts` | **New** — shared type definitions |
| `src/renderer/components/UpdateNotification.tsx` | **New** — update UI component |
| `src/renderer/App.tsx` | Add `UpdateNotification` to layout + startup check |
| `tests/services/UpdaterService.test.ts` | **New** — unit tests |
