'use strict';

/**
 * The one encoding detector for Daedalus sources, shared by `parseFile`, the
 * formatter, the corpus script and the editor (#395). Deterministic byte rules,
 * no statistics: jschardet read German scripts as ISO-8859-7 or x-mac-cyrillic,
 * chardet as ISO-8859-2, and neither recognises Windows-1251 in script-sized
 * text. Pure JS with no native dependency, so the editor's main process can
 * import it without loading the parser's addon.
 */

// Bytes windows-1252 leaves unassigned, so seeing one at all says the file is
// not windows-1252: 0x8D (Ť), 0x8F (Ź), 0x9D (ť).
const DECISIVE_1250_BYTES = [0x8D, 0x8F, 0x9D];

// Bytes that mean a Central European letter in windows-1250 but an ordinary
// Western one in windows-1252, so each is on its own as likely French, Nordic
// or Italian as it is Czech or Polish:
// 0x8A (Š/Š), 0x8C (Ś/Œ), 0x8E (Ž/Ž)
// 0x9A (š/š), 0x9C (ś/œ), 0x9E (ž/ž), 0x9F (ź/Ÿ)
// 0xA5 (Ą/¥), 0xAA (Ş/ª), 0xAF (Ż/¯)
// 0xB9 (ą/¹), 0xBA (ş/º), 0xBC (ľ/¼), 0xBE (ż/¾), 0xBF (ż/¿)
// 0xC8 (Č/È), 0xD2 (Ň/Ò), 0xD5 (Ő/Õ), 0xD8 (Ř/Ø), 0xDD (Ý/Ý)
// 0xE8 (č/è), 0xF2 (ň/ò), 0xF5 (ő/õ), 0xF8 (ř/ø)
const AMBIGUOUS_1250_BYTES = [
  0x8A, 0x8C, 0x8E,
  0x9A, 0x9C, 0x9E, 0x9F,
  0xA5, 0xAA, 0xAF,
  0xB9, 0xBA, 0xBC, 0xBE, 0xBF,
  0xC8, 0xD2, 0xD5, 0xD8, 0xDD,
  0xE8, 0xF2, 0xF5, 0xF8
];

// Special characters typically appear early; scanning past this buys nothing.
const MAX_SCAN_SIZE = 256 * 1024;

/** @param {Buffer} buffer */
function hasCentralEuropeanBytes(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, MAX_SCAN_SIZE));
  if (DECISIVE_1250_BYTES.some(byte => sample.includes(byte))) { return true; }
  // Corroboration for the ambiguous half: one accented byte is a loanword in an
  // otherwise Western file, and flipping the whole file on it mis-decodes every
  // other high byte in it. Two distinct ones is the Central European reading.
  let distinct = 0;
  for (const byte of AMBIGUOUS_1250_BYTES) {
    if (sample.includes(byte) && ++distinct === 2) { return true; }
  }
  return false;
}

/**
 * Pure ASCII → windows-1252 (identical bytes, and an edit that adds `ä` must
 * be written in Gothic's encoding, not UTF-8); valid UTF-8 → utf8; Central
 * European bytes → windows-1250; anything else → windows-1252. Other legacy
 * encodings (Windows-1251 among them) must be named explicitly.
 * @param {Buffer} buffer
 * @returns {'utf8' | 'windows-1250' | 'windows-1252'}
 */
function detectSourceEncoding(buffer) {
  if (!buffer.some(byte => byte > 0x7F)) { return 'windows-1252'; }
  if (Buffer.from(buffer.toString('utf8'), 'utf8').equals(buffer)) { return 'utf8'; }
  return hasCentralEuropeanBytes(buffer) ? 'windows-1250' : 'windows-1252';
}

module.exports = { detectSourceEncoding };
