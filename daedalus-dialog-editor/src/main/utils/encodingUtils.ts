import * as iconv from 'iconv-lite';
import { detectSourceEncoding } from 'daedalus-parser/source-encoding';

/**
 * Pure encoding detection/decoding shared by FileService (read-before-write)
 * and the metadata extraction path (metadata.worker + MetadataWorkerPool inline).
 *
 * The metadata path runs in worker threads where `electron`'s `dialog` is
 * unavailable, so it cannot import FileService. This module has no such
 * dependencies and can be imported from either process.
 */

/**
 * The parser's detector (`daedalus-parser/source-encoding`), so the editor and
 * the parser read a file the same way (#395). It is pure JS: importing it does
 * not load the parser's native addon into this process.
 */
export function detectEncoding(buffer: Buffer): string {
  return detectSourceEncoding(buffer);
}

/**
 * Decode a buffer using the detected encoding, returning both the decoded
 * string and the encoding used (so callers can cache it for write-back).
 */
export function decodeBuffer(buffer: Buffer): { content: string; encoding: string } {
  const encoding = detectEncoding(buffer);
  return { content: iconv.decode(buffer, encoding), encoding };
}

/**
 * A character that did not survive an encode → decode roundtrip in a given
 * encoding, with its (code-point) position in the original string.
 */
export interface LossyChar {
  char: string;
  position: number;
}

/**
 * Encode `content` in `encoding` and verify it roundtrips losslessly.
 *
 * iconv-lite silently substitutes unmappable characters with `?` on encode;
 * comparing the decoded-back string against the original detects that loss
 * without ever writing the mangled bytes. Returns the encoded buffer plus the
 * list of offending characters (empty when the roundtrip is lossless).
 */
export function encodeWithRoundtripCheck(
  content: string,
  encoding: string
): { buffer: Buffer; lossyChars: LossyChar[] } {
  const buffer = iconv.encode(content, encoding);
  const decoded = iconv.decode(buffer, encoding);

  const lossyChars: LossyChar[] = [];
  if (decoded !== content) {
    // Compare by code point so astral characters (e.g. emoji) count as one.
    const original = Array.from(content);
    const back = Array.from(decoded);
    for (let i = 0; i < original.length; i++) {
      if (original[i] !== back[i]) {
        lossyChars.push({ char: original[i], position: i });
      }
    }
  }

  return { buffer, lossyChars };
}
