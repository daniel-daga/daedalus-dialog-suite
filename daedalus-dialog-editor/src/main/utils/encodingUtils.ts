import * as chardet from 'chardet';
import * as iconv from 'iconv-lite';

/**
 * Pure encoding detection/decoding shared by FileService (read-before-write)
 * and the metadata extraction path (metadata.worker + MetadataWorkerPool inline).
 *
 * The metadata path runs in worker threads where `electron`'s `dialog` is
 * unavailable, so it cannot import FileService. This module has no such
 * dependencies and can be imported from either process.
 */

/**
 * Detect if a buffer contains Central European character byte patterns
 * specific to windows-1250 encoding (chardet frequently reports these as
 * windows-1252 / ISO-8859-1).
 */
function detectCentralEuropeanPattern(buffer: Buffer): boolean {
  // Bytes windows-1252 leaves unassigned, so seeing one at all says the file is
  // not windows-1252: 0x8D (Ť), 0x8F (Ź), 0x9D (ť).
  const decisiveBytes = [0x8D, 0x8F, 0x9D];

  // Bytes that mean a Central European letter in windows-1250 but an ordinary
  // Western one in windows-1252, so each is on its own as likely French, Nordic
  // or Italian as it is Czech or Polish:
  // 0x8A (Š/Š), 0x8C (Ś/Œ), 0x8E (Ž/Ž)
  // 0x9A (š/š), 0x9C (ś/œ), 0x9E (ž/ž), 0x9F (ź/Ÿ)
  // 0xA5 (Ą/¥), 0xAA (Ş/ª), 0xAF (Ż/¯)
  // 0xB9 (ą/¹), 0xBA (ş/º), 0xBC (ľ/¼), 0xBE (ż/¾), 0xBF (ż/¿)
  // 0xC8 (Č/È), 0xD2 (Ň/Ò), 0xD5 (Ő/Õ), 0xD8 (Ř/Ø), 0xDD (Ý/Ý)
  // 0xE8 (č/è), 0xF2 (ň/ò), 0xF5 (ő/õ), 0xF8 (ř/ø)
  const ambiguousBytes = [
    0x8A, 0x8C, 0x8E,
    0x9A, 0x9C, 0x9E, 0x9F,
    0xA5, 0xAA, 0xAF,
    0xB9, 0xBA, 0xBC, 0xBE, 0xBF,
    0xC8, 0xD2, 0xD5, 0xD8, 0xDD,
    0xE8, 0xF2, 0xF5, 0xF8
  ];

  // Limit the scan to the first 256KB of the file: a massive speedup for large
  // files while remaining accurate, as special characters typically appear early.
  const MAX_SCAN_SIZE = 256 * 1024;
  const limit = Math.min(buffer.length, MAX_SCAN_SIZE);
  const sample = buffer.subarray(0, limit);

  for (const byte of decisiveBytes) {
    if (sample.includes(byte)) {
      return true;
    }
  }

  // Corroboration for the ambiguous half: one accented byte is a loanword in an
  // otherwise Western file, and flipping the whole file on it mis-decodes every
  // other high byte in it. Two distinct ones is the Central European reading.
  let distinct = 0;
  for (const byte of ambiguousBytes) {
    if (sample.includes(byte) && ++distinct === 2) {
      return true;
    }
  }

  return false;
}

/**
 * Detect the encoding of a buffer, applying the windows-1250 heuristic that
 * corrects chardet's frequent Central-European-as-windows-1252 confusion.
 */
export function detectEncoding(buffer: Buffer): string {
  let detectedEncoding = chardet.detect(buffer);

  if (detectedEncoding === 'windows-1252' || detectedEncoding === 'ISO-8859-1') {
    if (detectCentralEuropeanPattern(buffer)) {
      detectedEncoding = 'windows-1250';
    }
  }

  return detectedEncoding || 'utf8';
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
