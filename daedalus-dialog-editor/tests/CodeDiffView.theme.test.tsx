/**
 * The diff view hardcoded `#111` on `#ddd` and so was a dark slab in the Light
 * and Gothic themes (production-readiness F13). It reads the palette now.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ThemeProvider } from '@mui/material/styles';
import CodeDiffView from '../src/renderer/components/common/CodeDiffView';
import { themes } from '../src/renderer/theme';

const rgb = (hex: string): string => {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};

describe('CodeDiffView theming', () => {
  it('uses theme tokens in light mode', () => {
    render(
      <ThemeProvider theme={themes.light}>
        <CodeDiffView beforeCode="a" afterCode="b" />
      </ThemeProvider>
    );
    const view = screen.getByTestId('code-diff-view');
    expect(view).toHaveStyle({ backgroundColor: rgb(themes.light.palette.background.default) });
    expect(view).not.toHaveStyle({ backgroundColor: rgb('#111111') });
    expect(view).toHaveStyle({ color: themes.light.palette.text.primary });
  });

  it('follows the gothic palette too', () => {
    render(
      <ThemeProvider theme={themes.gothic}>
        <CodeDiffView beforeCode="a" afterCode="b" />
      </ThemeProvider>
    );
    expect(screen.getByTestId('code-diff-view')).toHaveStyle({
      backgroundColor: rgb(themes.gothic.palette.background.default)
    });
  });
});
