import React, { useCallback, useEffect, useMemo, useState } from 'react';
import NPCList from './NPCList';
import NpcEditorDialog from './NpcEditorDialog';
import CreateNpcDialog from './CreateNpcDialog';
import { useProjectStore } from '../store/projectStore';
import type { SemanticModel, DialogMetadata } from '../types/global';
import type { ProjectIndex } from '../../shared/types';

interface NpcColumnProps {
  isProjectMode: boolean;
  projectNpcs: string[];
  dialogIndex: Map<string, DialogMetadata[]>;
  semanticModelDialogs: SemanticModel['dialogs'];
  selectedNPC: string | null;
  onSelectNPC: (npc: string) => void;
}

// #281: a project opened on a folder below its NPC files lists only the NPCs
// that have a dialog. Say so rather than show a short list as complete.
const npcCoverageNote = (
  coverage: ProjectIndex['npcCoverage'] | null,
  npcCount: number
): string | null => {
  if (!coverage) return null;
  if (coverage.npcInstancesFound === 0 && npcCount > 0) {
    return 'No NPC files under the opened folder — only NPCs with a dialog are listed. Open the scripts\' Content folder to see all of them.';
  }
  if (coverage.missingPrototypes.length > 0) {
    const names = coverage.missingPrototypes.join(', ');
    return `${names} ${coverage.missingPrototypes.length > 1 ? 'are' : 'is'} not under the opened folder, so NPCs derived from it are listed only if they have a daily routine or a dialog.`;
  }
  return null;
};

// A modder works in the mod's own folder and is not interested in the base
// scripts' cast, but the whole tree must stay loaded for its symbols. So the
// list, not the project, is narrowed to a folder: an NPC belongs to it when it
// is declared there or has a dialog there. Remembered per project.
const NPC_FOLDER_STORAGE_PREFIX = 'npcFolder:';

const relativeDir = (filePath: string, root: string): string => {
  const path = filePath.replace(/\\/g, '/');
  const base = root.replace(/\\/g, '/').replace(/\/$/, '') + '/';
  const rel = path.toLowerCase().startsWith(base.toLowerCase()) ? path.slice(base.length) : path;
  return rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
};

const isInFolder = (dir: string, folder: string): boolean =>
  dir.toLowerCase() === folder.toLowerCase() || dir.toLowerCase().startsWith(folder.toLowerCase() + '/');

const readStoredFolder = (projectPath: string | null): string => {
  if (!projectPath) return '';
  try {
    return localStorage.getItem(NPC_FOLDER_STORAGE_PREFIX + projectPath) ?? '';
  } catch {
    return '';
  }
};

const NpcColumn: React.FC<NpcColumnProps> = ({
  isProjectMode,
  projectNpcs,
  dialogIndex,
  semanticModelDialogs,
  selectedNPC,
  onSelectNPC,
}) => {
  const npcCoverage = useProjectStore((s) => s.npcCoverage);
  const { npcMap, npcs } = useMemo(() => {
    if (isProjectMode) {
      const map = new Map<string, string[]>();
      dialogIndex.forEach((dialogMetadataArray, npcId) => {
        const dialogNames = dialogMetadataArray.map(metadata => metadata.dialogName);
        map.set(npcId, dialogNames);
      });
      return { npcMap: map, npcs: projectNpcs };
    }

    const map = new Map<string, string[]>();
    Object.entries(semanticModelDialogs || {}).forEach(([dialogName, dialog]) => {
      const npcName = dialog.properties?.npc || 'Unknown NPC';
      if (!map.has(npcName)) {
        map.set(npcName, []);
      }
      map.get(npcName)!.push(dialogName);
    });

    const npcList = Array.from(map.keys()).sort();

    return { npcMap: map, npcs: npcList };
  }, [isProjectMode, projectNpcs, dialogIndex, semanticModelDialogs]);

  const coverageNote = isProjectMode ? npcCoverageNote(npcCoverage, npcs.length) : null;

  // Only an NPC the index knows a declaring file for can be edited — a name
  // that appears only as a dialog's `npc` has no instance to open.
  const npcFileIndex = useProjectStore((s) => s.npcFileIndex);

  const projectPath = useProjectStore((s) => s.projectPath);
  const [npcFolder, setNpcFolder] = useState(() => readStoredFolder(projectPath));
  useEffect(() => { setNpcFolder(readStoredFolder(projectPath)); }, [projectPath]);
  const changeNpcFolder = useCallback((folder: string) => {
    setNpcFolder(folder);
    if (!projectPath) return;
    try {
      localStorage.setItem(NPC_FOLDER_STORAGE_PREFIX + projectPath, folder);
    } catch {
      // A full or disabled localStorage loses the preference, not the filter.
    }
  }, [projectPath]);

  // Each NPC's directories: where it is declared and where its dialogs are.
  const npcDirs = useMemo(() => {
    const dirs = new Map<string, string[]>();
    if (!isProjectMode || !projectPath) return dirs;
    for (const npc of npcs) {
      const files = (dialogIndex.get(npc) || []).map((meta) => meta.filePath);
      const declared = npcFileIndex[npc.toUpperCase()];
      if (declared) files.push(declared);
      dirs.set(npc, files.map((file) => relativeDir(file, projectPath)));
    }
    return dirs;
  }, [isProjectMode, projectPath, npcs, dialogIndex, npcFileIndex]);

  const npcFolders = useMemo(() => {
    const folders = new Set<string>();
    npcDirs.forEach((dirs) => {
      for (const dir of dirs) {
        const parts = dir.split('/').filter(Boolean);
        for (let i = 1; i <= parts.length; i++) folders.add(parts.slice(0, i).join('/'));
      }
    });
    return Array.from(folders).sort((a, b) => a.localeCompare(b));
  }, [npcDirs]);

  // A remembered folder the project no longer has shows everything.
  const activeFolder = npcFolders.includes(npcFolder) ? npcFolder : '';
  const listedNpcs = useMemo(
    () => activeFolder
      ? npcs.filter((npc) => (npcDirs.get(npc) || []).some((dir) => isInFolder(dir, activeFolder)))
      : npcs,
    [npcs, npcDirs, activeFolder],
  );
  const [editing, setEditing] = useState<string | null>(null);
  const canEditNPC = useCallback(
    (npc: string) => isProjectMode && !!npcFileIndex[npc.toUpperCase()],
    [isProjectMode, npcFileIndex],
  );
  const editingFile = editing ? npcFileIndex[editing.toUpperCase()] : undefined;
  // A new NPC is a copy of one with a declaring file (#285), so there must be one.
  const [creating, setCreating] = useState(false);
  const canCreate = isProjectMode && Object.keys(npcFileIndex).length > 0;
  const openCreate = useCallback(() => setCreating(true), []);

  return (
    <>
      <NPCList
        npcs={listedNpcs}
        npcMap={npcMap}
        selectedNPC={selectedNPC}
        onSelectNPC={onSelectNPC}
        coverageNote={coverageNote}
        canEditNPC={canEditNPC}
        onEditNPC={setEditing}
        onCreateNPC={canCreate ? openCreate : undefined}
        npcFolders={isProjectMode && npcFolders.length > 1 ? npcFolders : undefined}
        npcFolder={activeFolder}
        onNpcFolderChange={changeNpcFolder}
      />
      {creating && (
        <CreateNpcDialog
          initialTemplate={selectedNPC}
          onClose={() => setCreating(false)}
          onCreated={(npc) => {
            setCreating(false);
            setEditing(npc);
          }}
        />
      )}
      {editing && editingFile && (
        <NpcEditorDialog npcName={editing} filePath={editingFile} onClose={() => setEditing(null)} />
      )}
    </>
  );
};

export default NpcColumn;
