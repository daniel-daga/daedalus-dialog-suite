import React, { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { Box, Chip, Typography } from '@mui/material';
import { HelpOutline } from '@mui/icons-material';
import BaseNode from './BaseNode';
import ReferenceLink from '../../common/ReferenceLink';
import ExpressionText from '../../common/ExpressionText';

const ConditionNode: React.FC<NodeProps> = ({ data, selected }) => {
  return (
    <BaseNode
      label={<ReferenceLink symbolName={data.label || ''} sx={{ color: '#fff' }}>{data.label || 'Condition'}</ReferenceLink>}
      headerColor="#ffc107" // Amber
      icon={<HelpOutline fontSize="small" />}
      selected={selected}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
          {data.negated && (
            <Chip
              size="small"
              label="NOT"
              sx={{ height: 18, fontSize: 9, bgcolor: '#c62828', color: '#fff' }}
            />
          )}
          {data.kind === 'logical' && data.operator && (
            <Chip
              size="small"
              label={String(data.operator)}
              sx={{ height: 18, fontSize: 9, bgcolor: '#6a1b9a', color: '#fff' }}
            />
          )}
        </Box>

        <Box sx={{ bgcolor: '#1a1a1a', p: 1, borderRadius: 1 }}>
          <Typography variant="body2" component="div" sx={{ fontSize: 11, fontFamily: 'monospace', color: '#81d4fa' }}>
            <ExpressionText expression={data.expression || 'TRUE'} />
          </Typography>
        </Box>

        {/* Handles */}
        <Box sx={{ position: 'relative', mt: 1, height: 20 }}>
          {/* Output: Boolean */}
          <Box sx={{ position: 'absolute', right: -20, top: 5, display: 'flex', alignItems: 'center', flexDirection: 'row-reverse' }}>
            <Handle
              type="source"
              position={Position.Right}
              id="out-bool"
              style={{ background: '#ffeb3b', width: 10, height: 10 }}
            />
            <Typography variant="caption" sx={{ mr: 1, fontSize: 9, color: '#aaa' }}>Result</Typography>
          </Box>
        </Box>
      </Box>
    </BaseNode>
  );
};

export default memo(ConditionNode);
