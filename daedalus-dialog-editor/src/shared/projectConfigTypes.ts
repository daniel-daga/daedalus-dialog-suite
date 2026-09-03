export type GothicTarget = 'g1' | 'g2' | 'g2-notr';

/** IPC/disk bounds keep project files cheap to validate and path strings OS-realistic. */
export const PROJECT_ASSET_SOURCE_LIMITS = {
  maxCount: 128,
  maxLength: 4096,
} as const;

export interface GothicProjectFileV1 {
  version: 1;
  target: GothicTarget;
  scriptsRoot: string;
  worlds: Array<{
    name: string;
    parts: Array<{ path: string; role: 'main' | 'part' }>;
  }>;
  assetSources: string[];
  /** A GMBT project folder — the one holding the `.gmbt.yml` a `gmbt test`
   *  run reads from its working directory (level-editor.md §16.29). Absent
   *  means no quick test is configured; it is not an asset source, so it is a
   *  field of its own rather than an entry in the list above. */
  gmbtProjectDir?: string;
}

export interface ProjectConfigWarning {
  code: 'asset-source-unavailable' | 'gmbt-project-dir-unavailable' | 'gothic-install-unavailable';
  source: string;
  resolvedPath: string;
  message: string;
}

export interface OpenedProjectConfig {
  projectFilePath: string;
  projectRoot: string;
  scriptsRoot: string;
  config: GothicProjectFileV1;
  resolvedAssetSources: string[];
  /** The configured sources as folders, before an install-shaped one is
   *  expanded into its archives — which is what world discovery scans
   *  (level-editor.md §16.31). */
  resolvedAssetRoots: string[];
  /** Asset folders the detected GMBT project declares that the list above does
   *  not have yet, as project-file paths. The Asset sources dialog offers
   *  these; nothing adds them behind the user's back (§16.31). */
  gmbtAssetSources: string[];
  /** The resolved `gmbtProjectDir`, or null when it is unset, missing, or not
   *  a GMBT project — which is also what disables the quick-test button. */
  gmbtProjectDir: string | null;
  /** The machine-local Gothic installation mounted under every project
   *  (level-editor.md §9), or null when none is set or the one set is not an
   *  install. It is not in the project file: an install path is a fact about
   *  this machine, and a committed one would not resolve on anybody else's. */
  gothicInstallPath: string | null;
  warnings: ProjectConfigWarning[];
}
