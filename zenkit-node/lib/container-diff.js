'use strict';

// Event-aligned byte diff of two archives, in one place.
//
// For every archive event (object frame, entry, raw blob) it compares the raw
// bytes of that event's span and groups the differences by class and entry —
// the instrument that found the byte-fidelity defects of `patches/0010`–`0019`.
//
// It dispatches on the archive format exactly as `containerFromBuffer` does:
// BinSafe through `lib/container.js`'s `walk`, ASCII through
// `lib/container-ascii.js`'s `walkAscii`, and BINARY not at all — for that one
// the caller gets a `whole-file` verdict, which is an honest "nothing looked
// inside these bytes" rather than a diff that skipped a region and called it
// clean.
//
// It lives here because there were two copies: `tools/bytediff.js` (the CLI)
// and `scripts/zen-roundtrip.js` (library form, feeding the report). Only the
// CLI ever learned ASCII, which is why every ASCII row in the harness report
// said `whole-file`.
//
// The coverage numbers are the point: `accounted` sums the text header, every
// event span and the trailing region, and `gap` is what nothing looked at. Only
// with `gap 0` does "the rest is identical" mean anything.

const { walk, readHeader } = require('./container.js');
const { walkAscii } = require('./container-ascii.js');

// Every ZenGin archive header carries a `date`/`user` stamp taken from the clock
// at write time, and a world nests archives — the `MeshAndBsp` blob has a header
// of its own. Two files written a second apart therefore differ in bytes that
// say nothing about the writer, and patch 0018's `%d.%d.%d` means the stamp's
// *length* varies too, so the difference is not even offset-preserving.
//
// Only the VALUES are dropped, never the lines: `container.js`'s `headerSection`
// makes the same split for the same reason, and a missing or added stamp line is
// real drift (ZenGin omits them in nested headers).
const HEADER_STAMPS =
  /(ZenGin Archive\nver 1\n[^\n]*\n[^\n]*\nsaveGame \d+\n)date [^\n]*\nuser [^\n]*\n(END\n)/g;
const ARCHIVE_MAGIC = Buffer.from('ZenGin Archive', 'latin1');

function withoutHeaderStamps(buf) {
  return Buffer.from(buf.toString('latin1').replace(HEADER_STAMPS, '$1date\nuser\n$2'), 'latin1');
}

// Byte equality that a clock tick cannot break. The strip is attempted only for
// spans that actually contain an archive header, which keeps the cost off the
// hundreds of thousands of ordinary events a retail world has — and states the
// rule the normalization is allowed to have: bytes outside a header are compared
// exactly, so a writer regression anywhere else is still a difference.
function equalIgnoringStamps(a, b) {
  if (a.equals(b)) return true;
  if (a.indexOf(ARCHIVE_MAGIC) < 0 || b.indexOf(ARCHIVE_MAGIC) < 0) return false;
  return withoutHeaderStamps(a).equals(withoutHeaderStamps(b));
}

function walkerFor(buf) {
  const format = readHeader(buf).lines[3];
  if (format === 'BIN_SAFE') return walk;
  if (format === 'ASCII') return walkAscii;
  return null;
}

// The BinSafe stream ends at the hash table; the ASCII stream ends at EOF and
// has no table. `streamEnd` is the one number the two formats disagree on.
function streamEnd(hdr, buf) {
  return hdr.header.hashTableOffset !== undefined ? hdr.header.hashTableOffset : buf.length;
}

// Byte span per event: [fileOffset, next event's fileOffset), except the raw
// blob, which both walkers report with its declared size — so nothing here has
// to know where the length prefix sits in either format.
function spans(evs, buf, hdr) {
  const out = [];
  for (let i = 0; i < evs.length; i += 1) {
    const e = evs[i];
    if (e.kind === 'eos') break;
    const end = e.kind === 'rawBlob'
      ? e.fileOffset + e.size
      : (i + 1 < evs.length ? evs[i + 1].fileOffset : streamEnd(hdr, buf));
    out.push({ e, start: e.fileOffset, end });
  }
  return out;
}

function eventsOf(gen) {
  const out = [];
  for (const ev of gen) out.push(ev);
  return out;
}

function byteDiff(a, b, drill) {
  if (!walkerFor(a) || !walkerFor(b)) {
    return { kind: 'whole-file', identical: a.equals(b), sizeDelta: b.length - a.length };
  }
  const ga = walkerFor(a)(a);
  const gb = walkerFor(b)(b);
  const ha = ga.next().value;
  const hb = gb.next().value;
  const sa = spans(eventsOf(ga), a, ha);
  const sb = spans(eventsOf(gb), b, hb);

  const headA = a.subarray(0, ha.header.entryStart);
  const headB = b.subarray(0, hb.header.entryStart);
  const tailA = a.subarray(streamEnd(ha, a));
  const tailB = b.subarray(streamEnd(hb, b));
  const accounted = headA.length + sa.reduce((n, s) => n + (s.end - s.start), 0) + tailA.length;

  const result = {
    kind: 'event-aligned',
    events: [sa.length, sb.length],
    aligned: true,
    coverage: { accounted, total: a.length, gap: a.length - accounted },
    textHeaderIdentical: equalIgnoringStamps(headA, headB),
    // The BinSafe hash table, or — on ASCII, which has none — an empty region.
    trailerIdentical: equalIgnoringStamps(tailA, tailB),
    identicalEventBytes: 0,
    differing: [],
    samples: [],
    blob: null,
  };

  const classes = new Map();
  const n = Math.min(sa.length, sb.length);
  for (let i = 0; i < n; i += 1) {
    const x = sa[i];
    const y = sb[i];
    if (x.e.kind !== y.e.kind || x.e.entryName !== y.e.entryName) {
      result.aligned = false;
      result.alignBreakAt = i;
      result.alignBreak = { at: i, original: x.e, resaved: y.e };
      break;
    }
    if (x.e.kind === 'rawBlob') {
      result.blob = {
        original: { start: x.start, size: x.e.size },
        resaved: { start: y.start, size: y.e.size },
      };
    }
    const ba = a.subarray(x.start, x.end);
    const bb = b.subarray(y.start, y.end);
    if (equalIgnoringStamps(ba, bb)) {
      result.identicalEventBytes += ba.length;
      continue;
    }
    const p = x.e.path;
    const cls = p.length ? p[p.length - 1].split(':')[1] : '<root>';
    const key = `${x.e.kind} ${cls} ${x.e.entryName || ''} ${x.e.entryType || ''}`.trim();
    const rec = classes.get(key) || { key, count: 0, sizeDelta: 0, examples: [] };
    rec.count += 1;
    rec.sizeDelta += bb.length - ba.length;
    if (rec.examples.length < 2) {
      rec.examples.push({
        offA: x.start, offB: y.start,
        a: x.e.payloadSummary, b: y.e.payloadSummary,
        la: ba.length, lb: bb.length,
      });
    }
    classes.set(key, rec);
    if (drill && result.samples.length < 8) {
      result.samples.push({
        key,
        offsetOriginal: x.start,
        original: ba.toString('hex').slice(0, 160),
        resaved: bb.toString('hex').slice(0, 160),
      });
    }
  }
  result.differing = [...classes.values()];
  return result;
}

module.exports = { byteDiff, walkerFor, streamEnd, spans, withoutHeaderStamps, equalIgnoringStamps };
