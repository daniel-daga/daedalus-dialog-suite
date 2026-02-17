import React, { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { Box, Typography } from '@mui/material';
import { ChatBubbleOutline } from '@mui/icons-material';
import BaseNode from './BaseNode';
import ReferenceLink from '../../common/ReferenceLink';

const DialogNode: React.FC<NodeProps> = ({ data, selected }) => {
  return (
    <BaseNode
      label={<ReferenceLink symbolName={data.label || ''} sx={{ color: '#fff' }}>{data.label || 'Dialog'}</ReferenceLink>}
      headerColor="#3f51b5" // Blue
      icon={<ChatBubbleOutline fontSize="small" />}
      selected={selected}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <ReferenceLink symbolName={data.npc || ''} symbolType="npc" variant="caption" sx={{ color: '#aaa', fontSize: 10, display: 'block' }}>
          {data.npc || 'Unknown NPC'}
        </ReferenceLink>

        <Box sx={{ bgcolor: '#1a1a1a', p: 1, borderRadius: 1, maxHeight: 60, overflow: 'hidden' }}>
          <Typography variant="body2" sx={{ fontSize: 11, fontStyle: 'italic', color: '#ccc' }}>
            "{data.description || '...'}"
          </Typography>
          {data.inferred && (
            <Typography variant="caption" sx={{ color: '#ffb74d', fontSize: 10 }}>
              inferred
            </Typography>
          )}
        </Box>

        {/* Handles */}
        <Box sx={{ position: 'relative', mt: 1, height: 20 }}>
          {/* Input: Condition */}
          <Box sx={{ position: 'absolute', left: -20, top: 5, display: 'flex', alignItems: 'center' }}>
            <Handle
              type="target"
              position={Position.Left}
              id="in-condition"
              style={{ background: '#4caf50', width: 10, height: 10 }}
            />
            <Typography variant="caption" sx={{ ml: 1, fontSize: 9, color: '#aaa' }}>Available</Typography>
          </Box>

          {/* Output: Finished */}
          <Box sx={{ position: 'absolute', right: -20, top: 5, display: 'flex', alignItems: 'center', flexDirection: 'row-reverse' }}>
            <Handle
              type="source"
              position={Position.Right}
              id="out-finished"
              style={{ background: '#2196f3', width: 10, height: 10 }}
            />
            <Typography variant="caption" sx={{ mr: 1, fontSize: 9, color: '#aaa' }}>Finished</Typography>
          </Box>
        </Box>
      </Box>
    </BaseNode>
  );
};

export default memo(DialogNode);
