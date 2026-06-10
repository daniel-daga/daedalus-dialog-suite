import { toMonacoMarkers } from '../src/renderer/components/sourceEditorMarkers';
import type { ParseError } from '../src/shared/types';

describe('toMonacoMarkers', () => {
  it('maps 1-based parser positions 1:1 to Monaco marker coordinates', () => {
    const errors: ParseError[] = [
      {
        type: 'syntax_error',
        message: 'Syntax error at line 3, column 7',
        position: { row: 3, column: 7 },
        text: '!!!',
      },
    ];

    const markers = toMonacoMarkers(errors, 8);

    expect(markers).toEqual([
      {
        severity: 8,
        message: 'Syntax error at line 3, column 7',
        startLineNumber: 3,
        startColumn: 7,
        endLineNumber: 3,
        endColumn: 10,
      },
    ]);
  });

  it('falls back to line 1, column 1 when position is missing', () => {
    const markers = toMonacoMarkers(
      [{ type: 'syntax_error', message: 'err' }],
      8
    );

    expect(markers[0].startLineNumber).toBe(1);
    expect(markers[0].startColumn).toBe(1);
    expect(markers[0].endColumn).toBe(2);
  });
});
