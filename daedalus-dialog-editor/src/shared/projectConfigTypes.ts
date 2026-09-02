export type GothicTarget = 'g1' | 'g2' | 'g2-notr';

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
