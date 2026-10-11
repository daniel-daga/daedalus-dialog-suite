import * as fs from 'fs';
import * as path from 'path';

/**
 * Local-only crash logging (fix-08 §5).
 *
 * Privacy stance (non-negotiable): no network reporting, no telemetry, no
 * automatic submission. One local log file the user can attach to a bug report.
 * We log messages and stacks only — never file contents or project paths beyond
 * what an error message itself happens to contain.
 *
 * The base directory is injected so the service is testable without Electron;
 * the composition root passes `app.getPath('userData')`.
 */

// Rotate once the live file grows past ~1 MiB, keeping exactly one predecessor.
const MAX_LOG_BYTES = 1024 * 1024;

export type LogLevel = 'error' | 'warn' | 'info';

export class LogService {
  private readonly logDir: string;
  private readonly logFile: string;
  private readonly rotatedFile: string;
  private bannerWritten = false;

  constructor(
    baseDir: string,
    private readonly appVersion: string
  ) {
    this.logDir = path.join(baseDir, 'logs');
    this.logFile = path.join(this.logDir, 'main.log');
    this.rotatedFile = path.join(this.logDir, 'main.log.1');
  }

  getLogFilePath(): string {
    return this.logFile;
  }

  log(level: LogLevel, source: string, message: string, stack?: string): void {
    try {
      fs.mkdirSync(this.logDir, { recursive: true });
      this.rotateIfNeeded();
      if (!this.bannerWritten) {
        fs.appendFileSync(this.logFile, this.buildBanner());
        this.bannerWritten = true;
      }
      fs.appendFileSync(this.logFile, this.buildEntry(level, source, message, stack));
    } catch {
      // Logging must never throw into a crash path; if the disk write fails
      // there is nowhere left to report it.
    }
  }

  /** Collapse newlines/carriage returns so every entry stays a single line. */
  private oneLine(value: string): string {
    return value.replace(/\r?\n/g, ' ');
  }

  private buildBanner(): string {
    const ts = new Date().toISOString();
    const electron = process.versions.electron ?? 'unknown';
    return `[${ts}] === Session started === app ${this.appVersion} | electron ${electron} | ${process.platform}/${process.arch}\n`;
  }

  private buildEntry(level: LogLevel, source: string, message: string, stack?: string): string {
    const ts = new Date().toISOString();
    let line = `[${ts}] ${level.toUpperCase()} [${source}] ${this.oneLine(message)}`;
    if (stack) {
      line += ` :: ${this.oneLine(stack)}`;
    }
    return `${line}\n`;
  }

  private rotateIfNeeded(): void {
    let size = 0;
    try {
      size = fs.statSync(this.logFile).size;
    } catch {
      return; // No file yet — nothing to rotate.
    }
    if (size < MAX_LOG_BYTES) {
      return;
    }
    // Overwrite any existing predecessor: we intentionally keep only one.
    fs.renameSync(this.logFile, this.rotatedFile);
    // A fresh session banner is not re-emitted after rotation; the header
    // already went out once this session.
  }
}
