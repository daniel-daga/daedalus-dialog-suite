import React, { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { Box, Typography } from '@mui/material';
import { CheckCircleOutline, ErrorOutline, PlaylistPlay } from '@mui/icons-material';
import BaseNode from './BaseNode';
import ReferenceLink from '../../common/ReferenceLink';

const QuestStateNode: React.FC<NodeProps> = ({ data, selected }) => {
  let icon = <PlaylistPlay fontSize="small" />;
  let color = '#ff9800'; // Running (Orange)
  let text = 'Set Running';

  if (data.status === 'SUCCESS' || data.type === 'success') {
    icon = <CheckCircleOutline fontSize="small" />;
    color = '#4caf50'; // Green
    text = 'Success';
  } else if (data.status === 'FAILED' || data.type === 'failed') {
    icon = <ErrorOutline fontSize="small" />;
    color = '#f44336'; // Red
    text = 'Failed';
  }

  return (
    <BaseNode
      label={<ReferenceLink symbolName={data.label || ''} sx={{ color: '#fff' }}>{data.label || 'Quest State'}</ReferenceLink>}
      headerColor={color}
      icon={icon}
      selected={selected}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <ReferenceLink symbolName={data.variableName || ''} variant="caption" sx={{ color: '#aaa', fontSize: 10, display: 'block' }}>
          {data.variableName || 'MIS_Unknown'}
        </ReferenceLink>

        <Box sx={{ bgcolor: '#1a1a1a', p: 1, borderRadius: 1 }}>
          <Typography variant="body2" sx={{ fontSize: 11, color: '#ccc', fontWeight: 'bold' }}>
            {text}
          </Typography>
        </Box>

        {/* Handles */}
        <Box sx={{ position: 'relative', mt: 1, height: 20 }}>
          {/* Input: Trigger */}
          <Box sx={{ position: 'absolute', left: -20, top: 5, display: 'flex', alignItems: 'center' }}>
            <Handle
              type="target"
              position={Position.Left}
              id="in-trigger"
              style={{ background: '#2196f3', width: 10, height: 10 }}
            />
            <Typography variant="caption" sx={{ ml: 1, fontSize: 9, color: '#aaa' }}>Set</Typography>
          </Box>

          {/* Output: State Check */}
          <Box sx={{ position: 'absolute', right: -20, top: 5, display: 'flex', alignItems: 'center', flexDirection: 'row-reverse' }}>
            <Handle
              type="source"
              position={Position.Right}
              id="out-state"
              style={{ background: '#4caf50', width: 10, height: 10 }}
            />
            <Typography variant="caption" sx={{ mr: 1, fontSize: 9, color: '#aaa' }}>Is Active</Typography>
          </Box>
        </Box>
      </Box>
    </BaseNode>
  );
};

export default memo(QuestStateNode);
