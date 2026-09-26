import React, { useMemo } from 'react';
import NPCList from './NPCList';
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

  return (
    <NPCList
      npcs={npcs}
      npcMap={npcMap}
      selectedNPC={selectedNPC}
      onSelectNPC={onSelectNPC}
      coverageNote={coverageNote}
    />
  );
};

export default NpcColumn;
