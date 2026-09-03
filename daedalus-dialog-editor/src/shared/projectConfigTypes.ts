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
  code: 'asset-source-unavailable' | 'gmbt-project-dir-unavailable';
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
  /** The resolved `gmbtProjectDir`, or null when it is unset, missing, or not
   *  a GMBT project — which is also what disables the quick-test button. */
  gmbtProjectDir: string | null;
  warnings: ProjectConfigWarning[];
}
