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
}

export interface ProjectConfigWarning {
  code: 'asset-source-unavailable';
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
  warnings: ProjectConfigWarning[];
}
