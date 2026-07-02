import React, { useMemo } from 'react';
import NPCList from './NPCList';
import type { SemanticModel, DialogMetadata } from '../types/global';

interface NpcColumnProps {
  isProjectMode: boolean;
  projectNpcs: string[];
  dialogIndex: Map<string, DialogMetadata[]>;
  semanticModelDialogs: SemanticModel['dialogs'];
  selectedNPC: string | null;
  onSelectNPC: (npc: string) => void;
}

const NpcColumn: React.FC<NpcColumnProps> = ({
  isProjectMode,
  projectNpcs,
  dialogIndex,
  semanticModelDialogs,
  selectedNPC,
  onSelectNPC,
}) => {
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

  return (
    <NPCList
      npcs={npcs}
      npcMap={npcMap}
      selectedNPC={selectedNPC}
      onSelectNPC={onSelectNPC}
    />
  );
};

export default NpcColumn;
