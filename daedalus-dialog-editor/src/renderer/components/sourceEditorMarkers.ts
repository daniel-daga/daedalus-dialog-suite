import type { ParseError } from '../../shared/types';

export interface EditorMarker {
  severity: number;
  message: string;
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

/**
 * Map parser errors to Monaco marker ranges. Parser positions are 1-based
 * (see daedalus-parser `Position`), matching Monaco's coordinates 1:1.
 */
export function toMonacoMarkers(errors: ParseError[], severity: number): EditorMarker[] {
  return errors.map(err => {
    const row = err.position ? err.position.row : 1;
    const col = err.position ? err.position.column : 1;
    return {
      severity,
      message: err.message,
      startLineNumber: row,
      startColumn: col,
      endLineNumber: row,
      endColumn: col + (err.text?.length || 1),
    };
  });
}
