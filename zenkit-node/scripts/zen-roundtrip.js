'use strict';

// T7 — the `zen-roundtrip` fidelity harness (docs/plans/level-editor-phase-0.md
// §3 and §6). For every world it finds: load → save → save again → load, then
// compare the original against the re-save with both instruments we have.
//
// Two modes, because two different claims are on offer (phase-0 §2):
//
//   --fixtures        C2, "no regression": the checked-in fixtures. Runs in CI,
//                     needs no game install, and proves only that today's
//                     binding behaves like the last reviewed one.
//   --root <dir>      C1, "fidelity": a developer-local Gothic install. The
//                     original ZEN is its own reference, so no oracle is needed.
//
// A green run in --fixtures mode is NEVER a fidelity result. The report says
// which claim it carries, and the summary prints it.
//
// COVERAGE IS PART OF THE RESULT. `lib/container.js` walks the BinSafe entry
// stream; the 24 zCArchiverGeneric/ASCII .zen files in a retail G2 install have
// no such stream, so on those the only instrument is the struct dump — which is
// blind to container facts by construction. Those worlds are reported as
// `struct-only`, never as a clean fidelity pass, because a diff that cannot see
// a region must not be allowed to call it identical.
//
// Each world is measured in a CHILD PROCESS. ZenKit can abort the process on
// malformed input (a hard 0xC0000409 has been observed on the ASCII path), and
// a crash is a result to record, not the end of the run.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const { classifyDumps } = require('../lib/classify.js');
const { walk } = require('../lib/container.js');

const BLOCKING = new Set(['semantic-drift', 'unreadable', 'crashed']);

// ---------------------------------------------------------------------------
// argv

function parseArgs(argv) {
  const opts = {
    root: null, fixtures: false, game: 'g2', reportDir: null,
    drill: false, strict: false, only: null, one: null, out: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`${a} needs a value`);
      return argv[i];
    };
    if (a === '--') continue; // pnpm forwards its own separator
    if (a === '--root') opts.root = next();
    else if (a === '--fixtures') opts.fixtures = true;
    else if (a === '--game') opts.game = next();
    else if (a === '--report-dir') opts.reportDir = next();
    else if (a === '--drill') opts.drill = true;
    else if (a === '--strict') opts.strict = true;
    else if (a === '--only') opts.only = next().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--one') opts.one = next();
    else if (a === '--out') opts.out = next();
    else throw new Error(`unknown option ${a}`);
  }
  return opts;
}

// ---------------------------------------------------------------------------
// per-world measurement (runs in the child)

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// Blank the variable `date `/`user ` values in every ZenGin archive header (a
// world nests archives — the MeshAndBsp chunk carries its own). Two saves of one
// handle can straddle a second, so the raw bytes are compared too and reported
// separately: `deterministic` must mean "the writer is deterministic", not "the
// clock did not tick".
function withoutHeaderStamps(buf) {
  const header =
    /(ZenGin Archive\nver 1\n[^\n]*\n[^\n]*\nsaveGame \d+\n)date [^\n]*\nuser [^\n]*\n(END\n)/g;
  return Buffer.from(buf.toString('latin1').replace(header, '$1date\nuser\n$2'), 'latin1');
}

function archiveKind(buf) {
  const head = buf.toString('latin1', 0, 256).split('\n');
  return { archiver: head[2] || '<unknown>', format: head[3] || '<unknown>' };
}

// The MeshAndBsp blob, which both archive formats carry verbatim as
// `uint32 bspVersion, uint32 size, size bytes` right after the object header.
function blobOf(buf) {
  const marker = '[MeshAndBsp % 0 0]';
  const at = buf.indexOf(marker, 0, 'latin1');
  if (at < 0) return null;
  let p = at + marker.length;
  while (p < buf.length && (buf[p] === 0x0a || buf[p] === 0x0d || buf[p] === 0x09)) p += 1;
  const size = buf.readUInt32LE(p + 4);
  return buf.subarray(p + 8, p + 8 + size);
}

// Event-aligned byte diff, BinSafe only (tools/bytediff.js in library form).
// Reports the coverage gap first: only with gap 0 does "the rest is identical"
// mean anything.
function byteDiff(a, b, drill) {
  const ga = walk(a);
  const gb = walk(b);
  const ha = ga.next().value;
  const hb = gb.next().value;
  const ea = [];
  const eb = [];
  for (const ev of ga) ea.push(ev);
  for (const ev of gb) eb.push(ev);

  const spans = (evs, buf, hdr) => {
    const out = [];
    for (let i = 0; i < evs.length; i += 1) {
      const e = evs[i];
      if (e.kind === 'eos') break;
      let end = i + 1 < evs.length ? evs[i + 1].fileOffset : hdr.header.hashTableOffset;
      if (e.kind === 'rawBlob') end = e.fileOffset + buf.readUInt32LE(e.fileOffset - 4);
      out.push({ e, start: e.fileOffset, end });
    }
    return out;
  };
  const sa = spans(ea, a, ha);
  const sb = spans(eb, b, hb);

  const headA = a.subarray(0, ha.header.entryStart);
  const headB = b.subarray(0, hb.header.entryStart);
  const tailA = a.subarray(ha.header.hashTableOffset);
  const tailB = b.subarray(hb.header.hashTableOffset);
  const accounted = headA.length + sa.reduce((n, s) => n + (s.end - s.start), 0) + tailA.length;

  const result = {
    kind: 'event-aligned',
    events: [sa.length, sb.length],
    aligned: true,
    coverage: { accounted, total: a.length, gap: a.length - accounted },
    textHeaderIdentical: headA.equals(headB),
    hashTableIdentical: tailA.equals(tailB),
    identicalEventBytes: 0,
    differing: [],
    samples: [],
  };

  const classes = new Map();
  const n = Math.min(sa.length, sb.length);
  for (let i = 0; i < n; i += 1) {
    const x = sa[i];
    const y = sb[i];
    if (x.e.kind !== y.e.kind || x.e.entryName !== y.e.entryName) {
      result.aligned = false;
      result.alignBreakAt = i;
      break;
    }
    const ba = a.subarray(x.start, x.end);
    const bb = b.subarray(y.start, y.end);
    if (ba.equals(bb)) {
      result.identicalEventBytes += ba.length;
      continue;
    }
    const p = x.e.path;
    const cls = p.length ? p[p.length - 1].split(':')[1] : '<root>';
    const key = `${x.e.kind} ${cls} ${x.e.entryName || ''} ${x.e.entryType || ''}`.trim();
    classes.set(key, (classes.get(key) || 0) + 1);
    if (drill && result.samples.length < 8) {
      result.samples.push({
        key,
        offsetOriginal: x.start,
        original: ba.toString('hex').slice(0, 160),
        resaved: bb.toString('hex').slice(0, 160),
      });
    }
  }
  result.differing = [...classes].map(([key, count]) => ({ key, count }));
  return result;
}

function measure(file, game, drill) {
  const zk = require('..');
  const original = fs.readFileSync(file);
  const kind = archiveKind(original);
  const row = {
    file,
    name: path.basename(file),
    archiver: kind.archiver,
    format: kind.format,
    gameVersion: game,
    size: original.length,
  };

  let handle;
  try {
    handle = zk.loadWorld(file, game);
  } catch (err) {
    // A .zen with no MeshAndBsp is a VOB library, not a world: out of scope for
    // a world round-trip, and saying "skipped" is more honest than "failed".
    const notAWorld = /no MeshAndBsp section/.test(err.message);
    row.status = notAWorld ? 'skipped' : 'unreadable';
    row.verdict = notAWorld ? 'not-a-world' : 'unreadable';
    row.instrument = 'none';
    row.error = err.message;
    return row;
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zen-roundtrip-'));
  try {
    const out1 = path.join(dir, 'resave1.zen');
    const out2 = path.join(dir, 'resave2.zen');
    zk.saveWorld(handle, out1);
    zk.saveWorld(handle, out2);

    const resaved = fs.readFileSync(out1);
    const resavedAgain = fs.readFileSync(out2);
    row.resavedSize = resaved.length;
    row.savesBitIdentical = sha256(resaved) === sha256(resavedAgain);
    row.deterministic = row.savesBitIdentical
      || withoutHeaderStamps(resaved).equals(withoutHeaderStamps(resavedAgain));
    row.wholeFileIdentical = original.equals(resaved);

    const blobA = blobOf(original);
    const blobB = blobOf(resaved);
    row.blob = blobA && blobB
      ? { original: blobA.length, resaved: blobB.length, identical: blobA.equals(blobB) }
      : null;

    let reloaded;
    try {
      reloaded = zk.loadWorld(out1, game);
    } catch (err) {
      row.status = 'unreadable';
      row.verdict = 'unreadable';
      row.instrument = 'none';
      row.error = `re-saved world failed to load: ${err.message}`;
      return row;
    }

    const result = classifyDumps(zk.normalizeWorld(handle), zk.normalizeWorld(reloaded));
    row.status = 'ok';
    row.verdict = result.classification;
    row.containerCoverage = result.containerCoverage;
    row.findings = result.findings.map((f) => ({ class: f.class, path: f.path, detail: String(f.detail) }));
    if (!drill) row.findings = row.findings.slice(0, 20);

    row.byteDiff = kind.format === 'BIN_SAFE'
      ? byteDiff(original, resaved, drill)
      : { kind: 'whole-file', identical: row.wholeFileIdentical, sizeDelta: resaved.length - original.length };

    // What the measurement is actually worth. `struct-only` means the container
    // instrument never looked at these bytes — the struct dump alone cannot
    // support a fidelity claim (phase-0 §5, the "clean diff / broken engine" cell).
    row.instrument = row.containerCoverage ? 'full' : 'struct-only';
    return row;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// discovery + driver (runs in the parent)

function discover(root) {
  const out = [];
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (/\.zen$/i.test(entry.name)) out.push(full);
    }
  };
  visit(root);
  return out.sort((a, b) => a.localeCompare(b));
}

function runChild(file, opts) {
  const outFile = path.join(os.tmpdir(), `zen-roundtrip-${crypto.randomBytes(8).toString('hex')}.json`);
  const args = [__filename, '--one', file, '--out', outFile, '--game', opts.game];
  if (opts.drill) args.push('--drill');
  const proc = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  try {
    if (fs.existsSync(outFile)) return JSON.parse(fs.readFileSync(outFile, 'utf8'));
  } finally {
    fs.rmSync(outFile, { force: true });
  }
  // No result file: the child died before it could write one. Describe the file
  // from the parent so a crashed row still says which archive format it was —
  // "20 ASCII worlds crashed" is a finding, "20 rows crashed" is not.
  const head = Buffer.alloc(256);
  const fd = fs.openSync(file, 'r');
  try {
    fs.readSync(fd, head, 0, 256, 0);
  } finally {
    fs.closeSync(fd);
  }
  const kind = archiveKind(head);
  return {
    file,
    name: path.basename(file),
    archiver: kind.archiver,
    format: kind.format,
    size: fs.statSync(file).size,
    status: 'crashed',
    verdict: 'crashed',
    instrument: 'none',
    exitCode: proc.status,
    exitCodeHex: proc.status === null ? null : `0x${(proc.status >>> 0).toString(16).toUpperCase()}`,
    signal: proc.signal,
    error: (proc.stderr || '').trim().split('\n').slice(-6).join('\n'),
  };
}

function summarize(rows, claim) {
  const lines = [];
  const width = Math.max(...rows.map((r) => r.name.length), 4);
  for (const row of rows) {
    const bits = [];
    if (row.deterministic === false) bits.push('NONDETERMINISTIC');
    else if (row.savesBitIdentical === false) bits.push('deterministic bar the header stamp');
    if (row.exitCodeHex) bits.push(`exit ${row.exitCodeHex}`);
    if (row.blob && !row.blob.identical) bits.push('blob differs');
    if (row.byteDiff && row.byteDiff.kind === 'event-aligned') {
      bits.push(`gap ${row.byteDiff.coverage.gap}`);
      const d = row.byteDiff.differing.reduce((n, x) => n + x.count, 0);
      bits.push(`${d} differing events`);
    }
    if (row.instrument === 'struct-only') bits.push('STRUCT-ONLY');
    if (row.error) bits.push(row.error.split('\n')[0].slice(0, 80));
    lines.push(`  ${row.name.padEnd(width)}  ${row.verdict.padEnd(15)} ${bits.join(', ')}`);
  }

  const measured = rows.filter((r) => r.status === 'ok');
  const full = measured.filter((r) => r.instrument === 'full');
  const partial = measured.filter((r) => r.instrument === 'struct-only');
  const skipped = rows.filter((r) => r.status === 'skipped');
  const blocked = rows.filter((r) => BLOCKING.has(r.verdict));

  lines.push('');
  lines.push(`CLAIM: ${claim}`);
  // Denominator = every file found, not every file that survived. A run where
  // most worlds never produced a measurement must not print a full-coverage line.
  const crashed = rows.filter((r) => r.status === 'crashed');
  const unreadable = rows.filter((r) => r.status === 'unreadable');
  lines.push(`COVERAGE: ${rows.length} .zen found; ${measured.length} measured` +
    ` (${full.length} container-instrumented, ${partial.length} struct-dump only` +
    `${partial.length ? ` — ${[...new Set(partial.map((r) => r.archiver))].join(', ')}` : ''}),` +
    ` ${crashed.length} crashed, ${unreadable.length} unreadable, ${skipped.length} skipped (not worlds)`);
  if (partial.length) {
    lines.push('  A struct-only row is NOT a fidelity pass: lib/container.js walks the BinSafe');
    lines.push('  entry stream only, so on those worlds nothing checked the archive container.');
  }
  const byVerdict = new Map();
  for (const row of rows) {
    const key = `${row.verdict} [${row.format || '?'}]`;
    byVerdict.set(key, (byVerdict.get(key) || 0) + 1);
  }
  lines.push(`VERDICTS: ${[...byVerdict].sort().map(([k, n]) => `${n}× ${k}`).join(', ')}`);
  lines.push(`BLOCKING: ${blocked.length}${blocked.length ? ` — ${blocked.map((r) => `${r.name} (${r.verdict})`).join(', ')}` : ''}`);
  return lines.join('\n');
}

function main(argv) {
  const opts = parseArgs(argv);

  if (opts.one) {
    const row = measure(opts.one, opts.game, opts.drill);
    fs.writeFileSync(opts.out, JSON.stringify(row));
    return 0;
  }

  if (opts.fixtures === (opts.root !== null)) {
    throw new Error('pass exactly one of --fixtures (C2, CI) or --root <dir> (C1, developer-local)');
  }
  const root = opts.fixtures ? path.join(__dirname, '..', 'test', 'fixtures') : opts.root;
  const claim = opts.fixtures
    ? 'C2 (no regression against the checked-in fixtures) — NOT a fidelity result'
    : 'C1 (fidelity: each original ZEN is its own reference)';

  let files = discover(root);
  if (opts.only) files = files.filter((f) => opts.only.includes(path.basename(f)));
  if (!files.length) throw new Error(`no .zen files under ${root}`);

  const rows = [];
  for (const file of files) {
    process.stderr.write(`  ${path.basename(file)} ... `);
    const row = runChild(file, opts);
    rows.push(row);
    process.stderr.write(`${row.verdict}\n`);
  }

  const report = {
    claim,
    root,
    game: opts.game,
    generated: new Date().toISOString(),
    worlds: rows,
  };
  if (opts.reportDir) {
    fs.mkdirSync(opts.reportDir, { recursive: true });
    const at = path.join(opts.reportDir, 'zen-roundtrip.json');
    fs.writeFileSync(at, `${JSON.stringify(report, null, 2)}\n`);
    process.stderr.write(`report: ${at}\n`);
  }

  console.log(summarize(rows, claim));

  return opts.strict && rows.some((r) => BLOCKING.has(r.verdict)) ? 1 : 0;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    console.error(`zen-roundtrip: ${err.message}`);
    process.exitCode = 2;
  }
}

module.exports = { main, measure, byteDiff, parseArgs };
