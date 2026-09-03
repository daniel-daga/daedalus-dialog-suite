import { constants, promises as fs, statSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { gothicAssetSources } from 'zen-world';

import type {
  GothicProjectFileV1,
  GothicTarget,
  OpenedProjectConfig,
  ProjectConfigWarning,
} from '../../shared/projectConfigTypes';
import { PROJECT_ASSET_SOURCE_LIMITS } from '../../shared/projectConfigTypes';
import { findGmbtProject } from './gmbtProject';

const PROJECT_FILE_SUFFIX = '.gothicproject.json';
const TARGETS = new Set<GothicTarget>(['g1', 'g2', 'g2-notr']);
const ARCHIVES = ['Textures.vdf', 'Textures_Addon.vdf', 'Meshes.vdf', 'Meshes_Addon.vdf', 'Anims.vdf', 'Anims_Addon.vdf'];
const COMPILED_FOLDERS = ['Meshes', 'Textures', 'Anims'];
const RENAME_RETRIES = 4;
const RENAME_RETRY_DELAY_MS = 10;
const TEMP_CREATE_RETRIES = 8;
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
  const rawAssetSources = root.assetSources;
  if (rawAssetSources.length > PROJECT_ASSET_SOURCE_LIMITS.maxCount) {
    throw new Error(`assetSources must contain at most ${PROJECT_ASSET_SOURCE_LIMITS.maxCount} entries`);
  }
  const assetSources = Array.from({ length: rawAssetSources.length }, (_, index) => {
    if (!Object.prototype.hasOwnProperty.call(rawAssetSources, index)) {
      throw new Error(`assetSources[${index}] must be present`);
    }
    const source = stringAt(rawAssetSources[index], `assetSources[${index}]`);
    if (source.length === 0 || source.length > PROJECT_ASSET_SOURCE_LIMITS.maxLength
      || /\p{Cc}/u.test(source)) {
      throw new Error(`assetSources[${index}] must be 1-${PROJECT_ASSET_SOURCE_LIMITS.maxLength} characters without control characters`);
    }
    return source;
  });
  if (!assetSources.includes('.')) throw new Error('assetSources must include "."');

  let gmbtProjectDir: string | undefined;
  if (root.gmbtProjectDir !== undefined) {
    gmbtProjectDir = stringAt(root.gmbtProjectDir, 'gmbtProjectDir');
    if (gmbtProjectDir.length === 0 || gmbtProjectDir.length > PROJECT_ASSET_SOURCE_LIMITS.maxLength
      || /\p{Cc}/u.test(gmbtProjectDir)) {
      throw new Error(`gmbtProjectDir must be 1-${PROJECT_ASSET_SOURCE_LIMITS.maxLength} characters without control characters`);
    }
  }

  return {
    version: 1,
    target: root.target as GothicTarget,
    scriptsRoot,
    worlds,
    assetSources,
    ...(gmbtProjectDir === undefined ? {} : { gmbtProjectDir }),
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

/** A GMBT project folder is the directory `gmbt` reads its `.gmbt.yml` from —
 *  a folder without one is a wrong path, not a usable project (§16.29). */
async function gmbtProjectProblem(candidate: string): Promise<string | null> {
  if (!await isAvailableDirectory(candidate)) return 'GMBT project folder is unavailable';
  try {
    if ((await fs.stat(path.join(candidate, '.gmbt.yml'))).isFile()) return null;
  } catch {
    // Reported as the missing config below, like any other wrong path.
  }
  return 'GMBT project folder has no .gmbt.yml';
}

/**
 * A path as the project file should carry it: relative to the project root,
 * forward slashes, so a detected folder is as committable as a hand-written
 * one. A folder on another drive has no relative spelling and stays absolute.
 */
function projectRelative(projectRoot: string, target: string): string {
  const relative = path.relative(projectRoot, target);
  if (relative.length === 0) return '.';
  if (isPortableAbsolute(relative)) return target;
  return relative.split(path.sep).join('/');
}

/**
 * Asset sources for a project folder that sits inside a GMBT tree
 * (level-editor.md §16.31), **in GMBT's own mount order**: `gothicRoot` first
 * when it is an install, then `modFiles.assets` as the file lists them, with
 * the project root written as `.` wherever it appears among them.
 *
 * The order is the point. Later wins here as it does in GMBT, so the retail
 * install has to be the base and the mod folder has to be last — a list that
 * put `.` first would let retail content override the mod's own.
 */
async function gmbtSeededAssetSources(
  projectRoot: string,
  gmbt: Awaited<ReturnType<typeof findGmbtProject>>,
): Promise<string[]> {
  const seeded: string[] = [];
  const seen = new Set<string>();
  const add = (candidate: string) => {
    const key = comparablePath(candidate);
    if (seen.has(key)) return;
    seen.add(key);
    seeded.push(projectRelative(projectRoot, candidate));
  };
  if (gmbt !== null) {
    if (gmbt.gothicRoot !== null && await isAvailableDirectory(gmbt.gothicRoot)
      && await isInstallShaped(gmbt.gothicRoot)) {
      add(gmbt.gothicRoot);
    }
    for (const assetDir of gmbt.assetDirs) add(assetDir);
  }
  // Required, and last when the GMBT list did not already place it.
  add(projectRoot);
  return seeded;
}

export interface OpenOrMigrateResult {
  project: OpenedProjectConfig;
  migrationCommitted: boolean;
  legacyCleanupSafe: boolean;
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

async function openExclusiveTemp(projectFilePath: string): Promise<{
  tempPath: string;
  handle: Awaited<ReturnType<typeof fs.open>>;
}> {
  for (let attempt = 0; attempt < TEMP_CREATE_RETRIES; attempt++) {
    const token = randomBytes(16).toString('hex');
    const tempPath = `${projectFilePath}.${process.pid}-${token}.tmp`;
    try {
      return { tempPath, handle: await fs.open(tempPath, 'wx') };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST'
        || attempt === TEMP_CREATE_RETRIES - 1) throw error;
    }
  }
  throw new Error('Unable to create a temporary project file');
}

async function writeProjectFile(
  projectFilePath: string,
  config: GothicProjectFileV1,
  expectedContents?: string,
): Promise<void> {
  let tempPath: string | undefined;
  try {
    const opened = await openExclusiveTemp(projectFilePath);
    tempPath = opened.tempPath;
    const handle = opened.handle;
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
    if (expectedContents !== undefined
      && await fs.readFile(projectFilePath, 'utf8') !== expectedContents) {
      throw new Error('Project file changed externally before the asset sources could be saved');
    }
    await renameOver(tempPath, projectFilePath);
  } catch (error) {
    if (tempPath) await fs.unlink(tempPath).catch(() => undefined);
    throw error;
  }
}

async function createProjectFile(projectFilePath: string, config: GothicProjectFileV1): Promise<boolean> {
  const { tempPath, handle } = await openExclusiveTemp(projectFilePath);
  try {
    try {
      await handle.writeFile(JSON.stringify(config, null, 2));
      try {
        await handle.sync();
      } catch {
        // Some filesystems do not support fsync; publication remains atomic.
      }
    } finally {
      await handle.close();
    }
    try {
      // Unlike rename, hard-link creation never replaces an existing file. The
      // fully written inode becomes visible atomically or EEXIST identifies the
      // other process as the migration winner.
      await fs.link(tempPath, projectFilePath);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw error;
    }
  } finally {
    await fs.unlink(tempPath).catch(() => undefined);
  }
}

/**
 * A project file that names no GMBT project adopts the one it sits inside
 * (§16.31), and the adoption is written back so the quick test is configured
 * from then on. Only that one field: the asset list is the user's ordering and
 * is never rewritten — the Asset sources dialog offers the rest by hand.
 */
async function adoptGmbtProject(
  projectFilePath: string,
  contents: string,
  config: GothicProjectFileV1,
): Promise<GothicProjectFileV1> {
  if (config.gmbtProjectDir !== undefined) return config;
  const projectRoot = path.dirname(projectFilePath);
  const gmbt = await findGmbtProject(projectRoot);
  if (gmbt === null) return config;
  const adopted = { ...config, gmbtProjectDir: projectRelative(projectRoot, gmbt.dir) };
  try {
    await writeProjectFile(projectFilePath, adopted, contents);
  } catch (error) {
    // A project file that cannot be written is still perfectly openable; the
    // adoption simply happens again next time.
    console.warn('[ProjectConfig] could not record the detected GMBT project:', error);
  }
  return adopted;
}

async function openExistingProject(
  projectFilePath: string,
  legacyInstallPath: string | null,
): Promise<OpenOrMigrateResult> {
  const contents = await fs.readFile(projectFilePath, 'utf8');
  const config = await adoptGmbtProject(projectFilePath, contents, parseProjectFile(contents));
  const project = await resolveProjectConfig(projectFilePath, config);
  const legacyCleanupSafe = legacyInstallPath !== null && (
    comparablePath(legacyInstallPath) === comparablePath(project.projectRoot)
    || config.assetSources.some((source) => isPortableAbsolute(source)
      && comparablePath(source) === comparablePath(legacyInstallPath))
  );
  return { project, migrationCommitted: false, legacyCleanupSafe };
}

export class ProjectConfigService {
  async openOrMigrate(projectRoot: string, legacyInstallPath: string | null): Promise<OpenOrMigrateResult> {
    const absoluteRoot = await fs.realpath(path.resolve(projectRoot));
    const defaultProjectFilePath = path.join(absoluteRoot, `${path.basename(absoluteRoot)}${PROJECT_FILE_SUFFIX}`);
    const initiallyDiscovered = await discoverProjectFile(absoluteRoot);

    return enqueueProjectFile(initiallyDiscovered ?? defaultProjectFilePath, async () => {
      const discovered = await discoverProjectFile(absoluteRoot);
      if (discovered) return openExistingProject(discovered, legacyInstallPath);

      const gmbt = await findGmbtProject(absoluteRoot);
      const assetSources = await gmbtSeededAssetSources(absoluteRoot, gmbt);
      if (legacyInstallPath && comparablePath(legacyInstallPath) !== comparablePath(absoluteRoot)) {
        assetSources.push(legacyInstallPath);
      }
      const config = parseProjectFile({
        version: 1,
        target: 'g2-notr',
        scriptsRoot: '.',
        worlds: [],
        assetSources,
        ...(gmbt === null ? {} : { gmbtProjectDir: projectRelative(absoluteRoot, gmbt.dir) }),
      });
      const committed = await createProjectFile(defaultProjectFilePath, config);
      if (!committed) return openExistingProject(defaultProjectFilePath, legacyInstallPath);
      return {
        project: await resolveProjectConfig(defaultProjectFilePath, config),
        migrationCommitted: true,
        legacyCleanupSafe: legacyInstallPath !== null,
      };
    });
  }

  async save(projectFilePath: string, config: GothicProjectFileV1): Promise<void> {
    const absolutePath = path.resolve(projectFilePath);
    const validated = parseProjectFile(config);
    return enqueueProjectFile(absolutePath, () => writeProjectFile(absolutePath, validated));
  }

  /**
   * The paths the Asset sources dialog owns: the ordered list, and the GMBT
   * project folder beside it (§16.29). `gmbtProjectDir` is `null` for "clear
   * it" and omitted for "leave it alone" — the two are different answers, and
   * a save that always wrote what it was handed could not express the second.
   */
  async updateProjectPaths(
    projectFilePath: string,
    assetSources: string[],
    gmbtProjectDir?: string | null,
  ): Promise<OpenedProjectConfig> {
    const absolutePath = path.resolve(projectFilePath);
    return enqueueProjectFile(absolutePath, async () => {
      const originalContents = await fs.readFile(absolutePath, 'utf8');
      const current = parseProjectFile(originalContents);
      const { gmbtProjectDir: currentGmbt, ...rest } = current;
      const next = gmbtProjectDir === undefined ? currentGmbt : (gmbtProjectDir ?? undefined);
      const updated = parseProjectFile({
        ...rest,
        assetSources,
        ...(next === undefined ? {} : { gmbtProjectDir: next }),
      });
      await writeProjectFile(absolutePath, updated, originalContents);
      return resolveProjectConfig(absolutePath, updated);
    });
  }
}

export async function resolveProjectConfig(
  projectFilePath: string,
  config: GothicProjectFileV1,
): Promise<OpenedProjectConfig> {
  const absoluteProjectFilePath = path.resolve(projectFilePath);
  const projectRoot = path.dirname(absoluteProjectFilePath);
  const resolvedAssetSources: string[] = [];
  const resolvedAssetRoots: string[] = [];
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
    resolvedAssetRoots.push(resolvedPath);
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

  let gmbtProjectDir: string | null = null;
  if (config.gmbtProjectDir !== undefined) {
    const resolvedPath = isPortableAbsolute(config.gmbtProjectDir)
      ? config.gmbtProjectDir
      : path.resolve(projectRoot, config.gmbtProjectDir);
    const problem = await gmbtProjectProblem(resolvedPath);
    if (problem === null) gmbtProjectDir = resolvedPath;
    else {
      warnings.push({
        code: 'gmbt-project-dir-unavailable',
        source: config.gmbtProjectDir,
        resolvedPath,
        message: `${problem}: ${config.gmbtProjectDir}`,
      });
    }
  }

  // What the GMBT project mounts that the list does not — an offer for the
  // Asset sources dialog, never applied here (§16.31).
  const gmbtAssetSources: string[] = [];
  if (gmbtProjectDir !== null) {
    const configured = new Set(resolvedAssetRoots.map(comparablePath));
    const gmbt = await findGmbtProject(gmbtProjectDir, 0);
    for (const assetDir of gmbt?.assetDirs ?? []) {
      if (configured.has(comparablePath(assetDir))) continue;
      configured.add(comparablePath(assetDir));
      gmbtAssetSources.push(projectRelative(projectRoot, assetDir));
    }
    if (gmbt?.gothicRoot != null && !configured.has(comparablePath(gmbt.gothicRoot))
      && await isAvailableDirectory(gmbt.gothicRoot) && await isInstallShaped(gmbt.gothicRoot)) {
      gmbtAssetSources.push(projectRelative(projectRoot, gmbt.gothicRoot));
    }
  }

  return {
    projectFilePath: absoluteProjectFilePath,
    projectRoot,
    scriptsRoot: path.resolve(projectRoot, config.scriptsRoot),
    config,
    resolvedAssetSources,
    resolvedAssetRoots,
    gmbtAssetSources,
    gmbtProjectDir,
    warnings,
  };
}
