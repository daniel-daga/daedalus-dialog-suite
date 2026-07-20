import React, { useMemo } from 'react';
import { Typography } from '@mui/material';

interface CodeDiffViewProps {
  beforeCode: string;
  afterCode: string;
  maxHeight?: number;
  'data-testid'?: string;
}

// Above this many lines per side the LCS table gets too large; fall back to
// the positional comparison rather than allocating hundreds of MB.
const LCS_LINE_LIMIT = 5000;

/**
 * Line diff: unchanged lines are prefixed with a space, removed (before-only)
 * lines with `-`, added (after-only) lines with `+`. Lines are aligned with a
 * longest-common-subsequence pass so a single insertion or deletion does not
 * mark every following line as changed — essential for the external-conflict
 * and review-before-save dialogs, which diff disk content against generated
 * code. Shared by those two dialogs and the quest diff preview.
 */
export const buildLineDiff = (beforeCode: string, afterCode: string): string => {
  const beforeLines = beforeCode.split('\n');
  const afterLines = afterCode.split('\n');
  const output: string[] = [];

  if (beforeLines.length > LCS_LINE_LIMIT || afterLines.length > LCS_LINE_LIMIT) {
    const max = Math.max(beforeLines.length, afterLines.length);
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
  }

  // Trim the common prefix/suffix first — dialog files mostly match, so this
  // keeps the LCS table small in the typical case.
  let start = 0;
  while (
    start < beforeLines.length &&
    start < afterLines.length &&
    beforeLines[start] === afterLines[start]
  ) {
    output.push(` ${beforeLines[start]}`);
    start += 1;
  }
  let beforeEnd = beforeLines.length;
  let afterEnd = afterLines.length;
  while (beforeEnd > start && afterEnd > start && beforeLines[beforeEnd - 1] === afterLines[afterEnd - 1]) {
    beforeEnd -= 1;
    afterEnd -= 1;
  }

  const beforeMid = beforeLines.slice(start, beforeEnd);
  const afterMid = afterLines.slice(start, afterEnd);
  const rows = beforeMid.length;
  const cols = afterMid.length;

  // LCS lengths; lcs[i][j] = LCS of beforeMid[i..] and afterMid[j..].
  const width = cols + 1;
  const lcs = new Uint32Array((rows + 1) * width);
  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = cols - 1; j >= 0; j -= 1) {
      lcs[i * width + j] = beforeMid[i] === afterMid[j]
        ? lcs[(i + 1) * width + j + 1] + 1
        : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
    }
  }

  let i = 0;
  let j = 0;
  while (i < rows && j < cols) {
    if (beforeMid[i] === afterMid[j]) {
      output.push(` ${beforeMid[i]}`);
      i += 1;
      j += 1;
    } else if (lcs[(i + 1) * width + j] >= lcs[i * width + j + 1]) {
      output.push(`-${beforeMid[i]}`);
      i += 1;
    } else {
      output.push(`+${afterMid[j]}`);
      j += 1;
    }
  }
  while (i < rows) {
    output.push(`-${beforeMid[i]}`);
    i += 1;
  }
  while (j < cols) {
    output.push(`+${afterMid[j]}`);
    j += 1;
  }

  for (let k = beforeEnd; k < beforeLines.length; k += 1) {
    output.push(` ${beforeLines[k]}`);
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
