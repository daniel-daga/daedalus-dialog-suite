/**
 * Logging utility for Daedalus Parser
 * Provides configurable logging levels and output formatting
 */

const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3,
  TRACE: 4
};

const LOG_LEVEL_NAMES = {
  0: 'ERROR',
  1: 'WARN',
  2: 'INFO',
  3: 'DEBUG',
  4: 'TRACE'
};

class Logger {
  constructor(name = 'DaedalusParser', level = LOG_LEVELS.INFO) {
    this.name = name;
    this.level = this.parseLogLevel(level);
    this.enabled = this.parseEnabled();
  }

  parseLogLevel(level) {
    if (typeof level === 'string') {
      const upperLevel = level.toUpperCase();
      return LOG_LEVELS[upperLevel] !== undefined ? LOG_LEVELS[upperLevel] : LOG_LEVELS.INFO;
    }
    return level;
  }

  parseEnabled() {
    const env = process.env.NODE_ENV;
    const logEnabled = process.env.DAEDALUS_LOG_ENABLED;

    // Disable by default in production unless explicitly enabled
    if (env === 'production' && logEnabled !== 'true') {
      return false;
    }

    // Enable by default in development and test
    return logEnabled !== 'false';
  }

  shouldLog(level) {
    return this.enabled && level <= this.level;
  }

  formatMessage(level, message, ...args) {
    const timestamp = new Date().toISOString();
    const levelName = LOG_LEVEL_NAMES[level];
    const prefix = `[${timestamp}] ${levelName} [${this.name}]`;

    if (args.length > 0) {
      return [prefix, message, ...args];
    }
    return [prefix, message];
  }

  error(message, ...args) {
    if (this.shouldLog(LOG_LEVELS.ERROR)) {
      console.error(...this.formatMessage(LOG_LEVELS.ERROR, message, ...args));
    }
  }

  warn(message, ...args) {
    if (this.shouldLog(LOG_LEVELS.WARN)) {
      console.warn(...this.formatMessage(LOG_LEVELS.WARN, message, ...args));
    }
  }

  info(message, ...args) {
    if (this.shouldLog(LOG_LEVELS.INFO)) {
      console.log(...this.formatMessage(LOG_LEVELS.INFO, message, ...args));
    }
  }

  debug(message, ...args) {
    if (this.shouldLog(LOG_LEVELS.DEBUG)) {
      console.log(...this.formatMessage(LOG_LEVELS.DEBUG, message, ...args));
    }
  }

  trace(message, ...args) {
    if (this.shouldLog(LOG_LEVELS.TRACE)) {
      console.log(...this.formatMessage(LOG_LEVELS.TRACE, message, ...args));
    }
  }

  // Performance logging
  time(label) {
    if (this.shouldLog(LOG_LEVELS.DEBUG)) {
      console.time(`${this.name}:${label}`);
    }
  }

  timeEnd(label) {
    if (this.shouldLog(LOG_LEVELS.DEBUG)) {
      console.timeEnd(`${this.name}:${label}`);
    }
  }

  // Create child logger with specific context
  child(name) {
    return new Logger(`${this.name}:${name}`, this.level);
  }
}

// Factory function for creating loggers
function createLogger(name, level) {
  return new Logger(name, level);
}

// Default logger instance
const defaultLogger = new Logger();

// Export both the class and convenience methods
module.exports = {
  Logger,
  createLogger,
  LOG_LEVELS,

  // Convenience methods using default logger
  error: (...args) => defaultLogger.error(...args),
  warn: (...args) => defaultLogger.warn(...args),
  info: (...args) => defaultLogger.info(...args),
  debug: (...args) => defaultLogger.debug(...args),
  trace: (...args) => defaultLogger.trace(...args),
  time: (label) => defaultLogger.time(label),
  timeEnd: (label) => defaultLogger.timeEnd(label)
};
