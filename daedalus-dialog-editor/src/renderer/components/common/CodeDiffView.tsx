import React, { useMemo } from 'react';
import { Typography } from '@mui/material';

interface CodeDiffViewProps {
  beforeCode: string;
  afterCode: string;
  maxHeight?: number;
  'data-testid'?: string;
}

/**
 * Naive positional line diff: unchanged lines are prefixed with a space,
 * removed (before-only) lines with `-`, added (after-only) lines with `+`.
 * Extracted from QuestDiffPreviewDialog so the same rendering backs the
 * quest diff preview, the external-conflict dialog and review-before-save.
 */
export const buildLineDiff = (beforeCode: string, afterCode: string): string => {
  const beforeLines = beforeCode.split('\n');
  const afterLines = afterCode.split('\n');
  const max = Math.max(beforeLines.length, afterLines.length);
  const output: string[] = [];

  for (let index = 0; index < max; index += 1) {
    const beforeLine = beforeLines[index];
    const afterLine = afterLines[index];
    if (beforeLine === afterLine) {
      output.push(` ${beforeLine ?? ''}`);
      continue;
    }
    if (beforeLine !== undefined) {
      output.push(`-${beforeLine}`);
    }
    if (afterLine !== undefined) {
      output.push(`+${afterLine}`);
    }
  }

  return output.join('\n');
};

const CodeDiffView: React.FC<CodeDiffViewProps> = ({
  beforeCode,
  afterCode,
  maxHeight = 480,
  'data-testid': dataTestId = 'code-diff-view'
}) => {
  const preview = useMemo(() => buildLineDiff(beforeCode, afterCode), [beforeCode, afterCode]);

  return (
    <Typography
      component="pre"
      data-testid={dataTestId}
      sx={{
        m: 0,
        p: 1.5,
        borderRadius: 1,
        bgcolor: '#111',
        color: '#ddd',
        maxHeight,
        overflow: 'auto',
        fontFamily: 'Consolas, Monaco, monospace',
        fontSize: 12,
        lineHeight: 1.4
      }}
    >
      {preview}
    </Typography>
  );
};

export default CodeDiffView;
