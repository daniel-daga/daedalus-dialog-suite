/**
 * Encoding unification for the metadata extraction path (D4).
 *
 * FileService.readFile, MetadataWorkerPool.processFileInline and
 * metadata.worker.ts all decode files through the shared encodingUtils helper,
 * so windows-1252/windows-1250 files yield intact special characters instead of
 * U+FFFD from a hard-coded utf-8 read. This suite covers the pure helper; the
 * end-to-end pipeline (buildProjectIndex → inline decode → parse) is asserted in
 * ProjectService.test.ts (kept there to avoid instantiating a second native
 * parser in a separate jest worker).
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

  it('does not misclassify a plain windows-1252 file as Central European', () => {
    const buffer = iconv.encode('// Grüße Köln Straße\nvar int test = 1;', 'windows-1252');
    // No windows-1250-specific bytes present, so the heuristic must not fire.
    expect(detectEncoding(buffer)).not.toBe('windows-1250');
  });

  it('does not flip a whole windows-1252 file on a lone accented byte', () => {
    // 'è' is 0xE8 — 'č' in windows-1250, so it is on the heuristic's list, but a
    // single ambiguous byte is French, not Czech. Flipping the file here decodes
    // every other high byte through the wrong table.
    const original = '// Après la mort de Noël\ninstance DIA_Test (C_INFO) { npc = Npc_1; };';
    const buffer = iconv.encode(original, 'windows-1252');

    expect(detectEncoding(buffer)).not.toBe('windows-1250');
    expect(decodeBuffer(buffer).content).toBe(original);
  });

  it('still flips on a byte windows-1252 does not assign at all', () => {
    // 0x8D is 'Ť' in windows-1250 and unassigned in windows-1252, so one
    // occurrence is decisive on its own.
    const original = '// Ťava\nvar int test = 1;';
    const buffer = iconv.encode(original, 'windows-1250');

    expect(buffer.includes(0x8d)).toBe(true);
    expect(detectEncoding(buffer)).toBe('windows-1250');
  });
});
