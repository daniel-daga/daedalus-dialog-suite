import { themes } from '../src/renderer/theme';

describe('Theme typography scaling', () => {
  const modes: Array<'dark' | 'light' | 'gothic'> = ['dark', 'light', 'gothic'];

  test.each(modes)('%s theme sets html font-size to 80%', (mode) => {
    const styleOverrides = themes[mode].components?.MuiCssBaseline?.styleOverrides as
      | { html?: { fontSize?: string } }
      | undefined;

    expect(styleOverrides).toBeDefined();
    expect(styleOverrides?.html?.fontSize).toBe('80%');
  });
});
