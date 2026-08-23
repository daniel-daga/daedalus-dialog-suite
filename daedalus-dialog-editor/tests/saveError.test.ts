/**
 * Tests for the save-error classification and user-facing copy in
 * src/renderer/utils/saveError.ts.
 *
 * @jest-environment node
 */

import { classifySaveError, describeSaveError } from '../src/renderer/utils/saveError';

describe('describeSaveError', () => {
  it('advises removing/replacing characters the file encoding (windows-1252) cannot represent — never converting to UTF-8', () => {
    const saveError = classifySaveError(
      new Error("ENCODING_LOSS: 1 character(s) cannot be written in windows-1252: '✓' (position 12)")
    );
    expect(saveError?.kind).toBe('encoding');

    const copy = describeSaveError(saveError!);
    // The pipeline deliberately writes windows-1252 (Gothic tooling format);
    // telling the user to convert the file to UTF-8 is wrong advice.
    expect(copy).not.toMatch(/UTF-8/i);
    expect(copy).toMatch(/windows-1252/);
    expect(copy).toMatch(/remove or replace/i);
  });
});
