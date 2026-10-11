export interface UpdateMetadata {
  version: string;       // "0.1.0-build.42"
  baseVersion: string;   // "0.1.0"
  buildNumber: number;   // 42
  sha256?: string;       // lowercase hex digest of the installer; required from build N+1 on (see fix-06 §4)
  size?: number;         // installer size in bytes
}

export interface UpdateCheckResult {
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion?: string;
  latestBuildNumber?: number;
  downloadUrl?: string;
  releaseUrl?: string;
}

export interface UpdaterSettings {
  autoCheckOnStartup: boolean;
  lastCheckTimestamp: number | null;
  dismissedVersion: string | null;
}
