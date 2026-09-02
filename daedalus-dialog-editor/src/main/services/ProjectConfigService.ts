import { constants, existsSync } from 'node:fs';
import { access, readdir, stat } from 'node:fs/promises';
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
  const entries = await readdir(projectRoot, { withFileTypes: true });
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
  if (scriptsRoot.length === 0 || path.isAbsolute(scriptsRoot)) {
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
    const details = await stat(candidate);
    if (!details.isDirectory()) return false;
    await access(candidate, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function isInstallShaped(candidate: string): Promise<boolean> {
  const probes = [
    ...ARCHIVES.flatMap((archive) => [path.join(candidate, 'Data', archive), path.join(candidate, 'Data', `${archive}.disabled`)]),
    ...COMPILED_FOLDERS.map((folder) => path.join(candidate, '_work', 'Data', folder, '_compiled')),
  ];
  for (const probe of probes) {
    try {
      await access(probe, constants.R_OK);
      return true;
    } catch {
      // Continue probing known install markers.
    }
  }
  return false;
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
    const resolvedPath = path.resolve(projectRoot, source);
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
      const expanded = gothicAssetSources(portableRoot, existsSync);
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
