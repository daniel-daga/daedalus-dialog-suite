import React, { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { Box, Chip, Typography, Tooltip } from '@mui/material';
import { CheckCircleOutline, ErrorOutline, PlaylistPlay, HelpOutline } from '@mui/icons-material';
import BaseNode from './BaseNode';
import ReferenceLink from '../../common/ReferenceLink';

const QuestStateNode: React.FC<NodeProps> = ({ data, selected }) => {
  let icon = <PlaylistPlay fontSize="small" />;
  let color = '#ff9800'; // Running (Orange)
  let text = 'Set Running';

  if (data.status === 'SUCCESS' || data.type === 'success' || String(data.description || '').includes('LOG_SUCCESS')) {
    icon = <CheckCircleOutline fontSize="small" />;
    color = '#4caf50'; // Green
    text = 'Success';
  } else if (data.status === 'FAILED' || data.type === 'failed' || String(data.description || '').includes('LOG_FAILED')) {
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
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
          {data.sourceKind && (
            <Chip
              size="small"
              variant="outlined"
              label={String(data.sourceKind).toUpperCase()}
              sx={{ height: 18, fontSize: 9, borderColor: '#666', color: '#bbb' }}
            />
          )}
          {data.entrySurface && (
            <Chip
              size="small"
              label="ENTRY"
              sx={{ height: 18, fontSize: 9, bgcolor: '#1b5e20', color: '#e8f5e9' }}
            />
          )}
          {data.latentEntry && (
            <Chip
              size="small"
              label="LATENT"
              sx={{ height: 18, fontSize: 9, bgcolor: '#e65100', color: '#fff3e0' }}
            />
          )}
        </Box>

        {data.variableName ? (
            <ReferenceLink symbolName={data.variableName} symbolType="variable" variant="caption" sx={{ color: '#aaa', fontSize: 10, display: 'block' }}>
                {data.variableName}
            </ReferenceLink>
        ) : (
            <Tooltip title="Method A: Implicit state tracking via KnowsInfo/Items. No global variable needed.">
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Typography variant="caption" sx={{ color: '#888', fontSize: 10, fontStyle: 'italic' }}>
                        Implicit State
                    </Typography>
                    <HelpOutline sx={{ fontSize: 10, color: '#888' }} />
                </Box>
            </Tooltip>
        )}

        <Box sx={{ bgcolor: '#1a1a1a', p: 1, borderRadius: 1 }}>
          <Typography variant="body2" sx={{ fontSize: 11, color: '#ccc', fontWeight: 'bold' }}>
            {data.description || text}
          </Typography>
          <Typography variant="caption" sx={{ color: '#888', fontSize: 10 }}>
            {data.kind || 'state'}
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
