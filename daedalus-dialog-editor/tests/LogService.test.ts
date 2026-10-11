/**
 * Unit tests for LogService — local crash logging (fix-08 §5).
 *
 * The service writes single-line timestamped entries to a rotating log file
 * under an injected base directory (in production: app.getPath('userData')).
 *
 * @jest-environment node
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { LogService } from '../src/main/services/LogService';

describe('LogService', () => {
  let baseDir: string;
  let logPath: string;

  beforeEach(() => {
    baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dde-log-'));
    logPath = path.join(baseDir, 'logs', 'main.log');
  });

  afterEach(() => {
    fs.rmSync(baseDir, { recursive: true, force: true });
  });

  it('appends a single-line timestamped entry with level, source, and message', () => {
    const service = new LogService(baseDir, '9.9.9');
    service.log('error', 'renderer', 'boom happened');

    const contents = fs.readFileSync(logPath, 'utf8');
    const lines = contents.split('\n').filter((l) => l.length > 0);
    // First line is the session banner; the entry is the last line.
    const entry = lines[lines.length - 1];

    expect(entry).toContain('ERROR');
    expect(entry).toContain('[renderer]');
    expect(entry).toContain('boom happened');
    // ISO-ish timestamp prefix.
    expect(entry).toMatch(/^\[?\d{4}-\d{2}-\d{2}T/);
    // Whole file ends in a newline (append-friendly).
    expect(contents.endsWith('\n')).toBe(true);
  });

  it('collapses newlines in message and stack so each entry stays one line', () => {
    const service = new LogService(baseDir, '9.9.9');
    service.log('error', 'main', 'line one\nline two', 'at foo\n  at bar');

    const contents = fs.readFileSync(logPath, 'utf8');
    const entryLines = contents.split('\n').filter((l) => l.length > 0);
    // banner + exactly one entry line (no extra lines from the embedded \n).
    expect(entryLines).toHaveLength(2);
    const entry = entryLines[1];
    expect(entry).toContain('line one');
    expect(entry).toContain('line two');
    expect(entry).toContain('at foo');
    expect(entry).toContain('at bar');
  });

  it('writes the startup banner exactly once per session', () => {
    const service = new LogService(baseDir, '1.2.3');
    service.log('error', 'main', 'first');
    service.log('error', 'main', 'second');

    const contents = fs.readFileSync(logPath, 'utf8');
    const bannerCount = (contents.match(/Session started/g) || []).length;
    expect(bannerCount).toBe(1);
    // Banner carries the bug-report header.
    expect(contents).toContain('1.2.3');
    expect(contents).toContain(process.platform);
    expect(contents).toContain(process.arch);
  });

  it('rotates main.log -> main.log.1 when the file exceeds the size cap', () => {
    // Pre-seed an oversized log so a single append trips rotation deterministically.
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    const marker = 'OLD-CONTENT-MARKER';
    fs.writeFileSync(logPath, marker + 'x'.repeat(1024 * 1024 + 10), 'utf8');

    const service = new LogService(baseDir, '9.9.9');
    service.log('error', 'main', 'fresh entry after rotation');

    const rotatedPath = path.join(baseDir, 'logs', 'main.log.1');
    expect(fs.existsSync(rotatedPath)).toBe(true);
    // The predecessor holds the old bytes.
    expect(fs.readFileSync(rotatedPath, 'utf8')).toContain(marker);

    // The live file was reset and only holds new content.
    const live = fs.readFileSync(logPath, 'utf8');
    expect(live).toContain('fresh entry after rotation');
    expect(live).not.toContain(marker);
  });

  it('keeps only one predecessor (main.log.1 is overwritten on the next rotation)', () => {
    const service = new LogService(baseDir, '9.9.9');
    fs.mkdirSync(path.dirname(logPath), { recursive: true });

    // First rotation.
    fs.writeFileSync(logPath, 'ROTATION-A'.padEnd(1024 * 1024 + 10, 'x'), 'utf8');
    service.log('error', 'main', 'entry one');

    // Second rotation.
    fs.writeFileSync(logPath, 'ROTATION-B'.padEnd(1024 * 1024 + 10, 'x'), 'utf8');
    service.log('error', 'main', 'entry two');

    const rotated = fs.readFileSync(path.join(baseDir, 'logs', 'main.log.1'), 'utf8');
    expect(rotated).toContain('ROTATION-B');
    expect(rotated).not.toContain('ROTATION-A');
    // No second predecessor.
    expect(fs.existsSync(path.join(baseDir, 'logs', 'main.log.2'))).toBe(false);
  });

  it('exposes the log file path', () => {
    const service = new LogService(baseDir, '9.9.9');
    expect(service.getLogFilePath()).toBe(logPath);
  });
});
