import { constants, promises as fs, statSync } from 'node:fs';
import path from 'node:path';
import { gothicAssetSources } from 'zen-world';

import type {
  GothicProjectFileV1,
  GothicTarget,
  OpenedProjectConfig,
  ProjectConfigWarning,
} from '../../shared/projectConfigTypes';

const PROJECT_FILE_SUFFIX = '.gothicproject.json';
const TARGETS = new Set<GothicTarget>(['g1', 'g2', 'g2-notr']);
const ARCHIVES = ['Textures.vdf', 'Textures_Addon.vdf', 'Meshes.vdf', 'Meshes_Addon.vdf', 'Anims.vdf', 'Anims_Addon.vdf'];
const COMPILED_FOLDERS = ['Meshes', 'Textures', 'Anims'];
const RENAME_RETRIES = 4;
const RENAME_RETRY_DELAY_MS = 10;
const MIGRATION_CLAIM_WAIT_MS = 10;
const MIGRATION_CLAIM_TIMEOUT_MS = 5_000;
let tmpWriteCounter = 0;
const projectFileQueues = new Map<string, Promise<unknown>>();

function isPortableAbsolute(candidate: string): boolean {
  return path.win32.isAbsolute(candidate) || path.posix.isAbsolute(candidate);
}

function recordAt(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function stringAt(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`${field} must be a string`);
  return value;
}

export async function discoverProjectFile(projectRoot: string): Promise<string | null> {
  const entries = await fs.readdir(projectRoot, { withFileTypes: true });
  const projectFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(PROJECT_FILE_SUFFIX))
    .map((entry) => path.join(projectRoot, entry.name));
  if (projectFiles.length > 1) {
    throw new Error(`Multiple ${PROJECT_FILE_SUFFIX} files found in project folder`);
  }
  return projectFiles[0] ?? null;
}

export function parseProjectFile(value: unknown): GothicProjectFileV1 {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch (error) {
      throw new Error(`Invalid project JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const root = recordAt(parsed, 'project');
  if (root.version !== 1) throw new Error('version must be 1');
  if (typeof root.target !== 'string' || !TARGETS.has(root.target as GothicTarget)) {
    throw new Error('target must be one of g1, g2, or g2-notr');
  }
  const scriptsRoot = stringAt(root.scriptsRoot, 'scriptsRoot');
  if (scriptsRoot.length === 0 || isPortableAbsolute(scriptsRoot)) {
    throw new Error('scriptsRoot must be a non-empty relative path');
  }
  if (!Array.isArray(root.worlds)) throw new Error('worlds must be an array');
  const worlds = root.worlds.map((worldValue, worldIndex) => {
    const field = `worlds[${worldIndex}]`;
    const world = recordAt(worldValue, field);
    const name = stringAt(world.name, `${field}.name`);
    if (!Array.isArray(world.parts)) throw new Error(`${field}.parts must be an array`);
    const parts = world.parts.map((partValue, partIndex) => {
      const partField = `${field}.parts[${partIndex}]`;
      const part = recordAt(partValue, partField);
      const partPath = stringAt(part.path, `${partField}.path`);
      if (part.role !== 'main' && part.role !== 'part') {
        throw new Error(`${partField}.role must be main or part`);
      }
      return { path: partPath, role: part.role as 'main' | 'part' };
    });
    return { name, parts };
  });
  if (!Array.isArray(root.assetSources) || root.assetSources.length === 0) {
    throw new Error('assetSources must be a non-empty array');
  }
  const assetSources = root.assetSources.map((source, index) => stringAt(source, `assetSources[${index}]`));
  if (!assetSources.includes('.')) throw new Error('assetSources must include "."');

  return {
    version: 1,
    target: root.target as GothicTarget,
    scriptsRoot,
    worlds,
    assetSources,
  };
}

async function isAvailableDirectory(candidate: string): Promise<boolean> {
  try {
    const details = await fs.stat(candidate);
    if (!details.isDirectory()) return false;
    await fs.access(candidate, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function isInstallShaped(candidate: string): Promise<boolean> {
  const probes: Array<{ filePath: string; kind: 'file' | 'directory' }> = [
    ...ARCHIVES.flatMap((archive) => [
      { filePath: path.join(candidate, 'Data', archive), kind: 'file' as const },
      { filePath: path.join(candidate, 'Data', `${archive}.disabled`), kind: 'file' as const },
    ]),
    ...COMPILED_FOLDERS.map((folder) => ({
      filePath: path.join(candidate, '_work', 'Data', folder, '_compiled'),
      kind: 'directory' as const,
    })),
  ];
  for (const probe of probes) {
    try {
      const details = await fs.stat(probe.filePath);
      if (probe.kind === 'file' ? details.isFile() : details.isDirectory()) return true;
    } catch {
      // Continue probing known install markers.
    }
  }
  return false;
}

export interface OpenOrMigrateResult {
  project: OpenedProjectConfig;
  migrationCommitted: boolean;
}

function enqueueProjectFile<T>(projectFilePath: string, operation: () => Promise<T>): Promise<T> {
  const key = projectOperationKey(projectFilePath);
  const previous = projectFileQueues.get(key) ?? Promise.resolve();
  const run = previous.then(operation, operation);
  const settled = run.then(() => undefined, () => undefined);
  projectFileQueues.set(key, settled);
  void settled.finally(() => {
    if (projectFileQueues.get(key) === settled) projectFileQueues.delete(key);
  });
  return run;
}

export function projectOperationKey(
  candidate: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const platformPath = platform === 'win32' ? path.win32 : path.posix;
  const normalized = platformPath.normalize(platformPath.resolve(candidate));
  return platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function comparablePath(candidate: string): string {
  return projectOperationKey(candidate);
}

async function renameOver(tempPath: string, destination: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(tempPath, destination);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= RENAME_RETRIES || (code !== 'EPERM' && code !== 'EACCES')) throw error;
      await new Promise((resolve) => setTimeout(resolve, RENAME_RETRY_DELAY_MS * (attempt + 1)));
    }
  }
}

async function writeProjectFile(projectFilePath: string, config: GothicProjectFileV1): Promise<void> {
  const tempPath = `${projectFilePath}.${process.pid}-${tmpWriteCounter++}.tmp`;
  try {
    const handle = await fs.open(tempPath, 'w');
    try {
      await handle.writeFile(JSON.stringify(config, null, 2));
      try {
        await handle.sync();
      } catch {
        // Some filesystems do not support fsync; rename still prevents torn JSON.
      }
    } finally {
      await handle.close();
    }
    await renameOver(tempPath, projectFilePath);
  } catch (error) {
    await fs.unlink(tempPath).catch(() => undefined);
    throw error;
  }
}

async function waitForMigrationClaim(claimPath: string): Promise<void> {
  const deadline = Date.now() + MIGRATION_CLAIM_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      await fs.access(claimPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, MIGRATION_CLAIM_WAIT_MS));
  }
  throw new Error(`Timed out waiting for project migration claim: ${claimPath}`);
}

async function openExistingProject(projectFilePath: string): Promise<OpenOrMigrateResult> {
  const config = parseProjectFile(await fs.readFile(projectFilePath, 'utf8'));
  return { project: await resolveProjectConfig(projectFilePath, config), migrationCommitted: false };
}

export class ProjectConfigService {
  async openOrMigrate(projectRoot: string, legacyInstallPath: string | null): Promise<OpenOrMigrateResult> {
    const absoluteRoot = await fs.realpath(path.resolve(projectRoot));
    const defaultProjectFilePath = path.join(absoluteRoot, `${path.basename(absoluteRoot)}${PROJECT_FILE_SUFFIX}`);
    const initiallyDiscovered = await discoverProjectFile(absoluteRoot);

    return enqueueProjectFile(initiallyDiscovered ?? defaultProjectFilePath, async () => {
      const claimPath = `${defaultProjectFilePath}.migration.lock`;
      for (;;) {
        const discovered = await discoverProjectFile(absoluteRoot);
        if (discovered) return openExistingProject(discovered);

        let claimHandle;
        try {
          claimHandle = await fs.open(claimPath, 'wx');
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
          await waitForMigrationClaim(claimPath);
          continue;
        }

        try {
          await claimHandle.writeFile(`${process.pid}\n`);
          try {
            await claimHandle.sync();
          } catch {
            // The claim remains exclusive even where syncing it is unsupported.
          }
          const winner = await discoverProjectFile(absoluteRoot);
          if (winner) return openExistingProject(winner);

          const assetSources = ['.'];
          if (legacyInstallPath && comparablePath(legacyInstallPath) !== comparablePath(absoluteRoot)) {
            assetSources.push(legacyInstallPath);
          }
          const config = parseProjectFile({
            version: 1,
            target: 'g2-notr',
            scriptsRoot: '.',
            worlds: [],
            assetSources,
          });
          await writeProjectFile(defaultProjectFilePath, config);
          return { project: await resolveProjectConfig(defaultProjectFilePath, config), migrationCommitted: true };
        } finally {
          await claimHandle.close().catch(() => undefined);
          await fs.unlink(claimPath).catch(() => undefined);
        }
      }
    });
  }

  async save(projectFilePath: string, config: GothicProjectFileV1): Promise<void> {
    const absolutePath = path.resolve(projectFilePath);
    const validated = parseProjectFile(config);
    return enqueueProjectFile(absolutePath, () => writeProjectFile(absolutePath, validated));
  }
}

export async function resolveProjectConfig(
  projectFilePath: string,
  config: GothicProjectFileV1,
): Promise<OpenedProjectConfig> {
  const absoluteProjectFilePath = path.resolve(projectFilePath);
  const projectRoot = path.dirname(absoluteProjectFilePath);
  const resolvedAssetSources: string[] = [];
  const warnings: ProjectConfigWarning[] = [];

  for (const source of config.assetSources) {
    const resolvedPath = isPortableAbsolute(source) ? source : path.resolve(projectRoot, source);
    if (!await isAvailableDirectory(resolvedPath)) {
      warnings.push({
        code: 'asset-source-unavailable',
        source,
        resolvedPath,
        message: `Asset source is unavailable: ${source}`,
      });
      continue;
    }
    if (await isInstallShaped(resolvedPath)) {
      const portableRoot = resolvedPath.replace(/\\/g, '/');
      const expanded = gothicAssetSources(portableRoot, (candidate) => {
        try {
          const details = statSync(candidate);
          return candidate.endsWith('/_compiled') ? details.isDirectory() : details.isFile();
        } catch {
          return false;
        }
      });
      resolvedAssetSources.push(...expanded.map((candidate) => path.normalize(candidate)));
    } else {
      resolvedAssetSources.push(resolvedPath);
    }
  }

  return {
    projectFilePath: absoluteProjectFilePath,
    projectRoot,
    scriptsRoot: path.resolve(projectRoot, config.scriptsRoot),
    config,
    resolvedAssetSources,
    warnings,
  };
}
