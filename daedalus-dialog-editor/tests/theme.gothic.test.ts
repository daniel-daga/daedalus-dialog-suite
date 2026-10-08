import { themes } from '../src/renderer/theme';

describe('Gothic theme', () => {
  it('uses a dark, cool palette with a blood-red primary accent', () => {
    expect(themes.gothic.palette.mode).toBe('dark');
    expect(themes.gothic.palette.background.default).toBe('#0b080d');
    expect(themes.gothic.palette.background.paper).toBe('#171118');
    expect(themes.gothic.palette.primary.main).toBe('#c04c63');
    expect(themes.gothic.palette.text.primary).toBe('#f2eaf0');
  });

  it('carries the dark crimson treatment through the app bar and panels', () => {
    const appBar = themes.gothic.components?.MuiAppBar?.styleOverrides as
      | { root?: { backgroundImage?: string; borderBottom?: string } }
      | undefined;
    const paper = themes.gothic.components?.MuiPaper?.styleOverrides as
      | { root?: { borderColor?: string; boxShadow?: string } }
      | undefined;

    expect(appBar?.root?.backgroundImage).toContain('#21121d');
    expect(appBar?.root?.borderBottom).toContain('192, 55, 79');
    expect(paper?.root?.borderColor).toContain('192, 55, 79');
    expect(paper?.root?.boxShadow).toContain('0, 0, 0');
  });
});
