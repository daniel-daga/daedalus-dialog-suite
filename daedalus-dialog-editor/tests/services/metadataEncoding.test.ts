/**
 * Encoding unification for the metadata extraction path (D4).
 *
 * FileService.readFile, MetadataWorkerPool.processFileInline and
 * metadata.worker.ts all decode files through the shared encodingUtils helper,
 * so windows-1252/windows-1250 files yield intact special characters instead of
 * U+FFFD from a hard-coded utf-8 read. This suite covers the pure helper; the
 * end-to-end pipeline (buildProjectIndex → inline decode → parse) is asserted in
 * ProjectService.test.ts (kept there to avoid instantiating a second native
 * parser in a separate jest worker). Detection itself is the parser's
 * `source-encoding`, and its byte rules are tested there (#395).
 * @jest-environment node
 */

import * as iconv from 'iconv-lite';
import { decodeBuffer, detectEncoding } from '../../src/main/utils/encodingUtils';

describe('encodingUtils', () => {
  it('decodes windows-1252 umlauts round-trip', () => {
    const original = '// Bärbel Grüße Köln Mörder Straße\ninstance DIA_Bärbel (C_INFO) { npc = Baerbel; };';
    const buffer = iconv.encode(original, 'windows-1252');

    const { content } = decodeBuffer(buffer);
    expect(content).toBe(original);
  });

  it('applies the Central-European heuristic for windows-1250 bytes', () => {
    // 'č' is 0xE8 in windows-1250 but 'è' in windows-1252 — decoding the wrong
    // table silently corrupts it, which the heuristic prevents.
    const original = '// Čapek Dvořák Škoda Žižka Řež\ninstance DIA_Cech (C_INFO) { npc = Npc_1; };';
    const buffer = iconv.encode(original, 'windows-1250');

    const encoding = detectEncoding(buffer);
    expect(encoding).toBe('windows-1250');

    const { content } = decodeBuffer(buffer);
    expect(content).toBe(original);
    expect(content).toContain('Čapek');
  });
});
