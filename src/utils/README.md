# Logging System

The Daedalus Parser includes a production-ready logging system that replaces direct console output with configurable, level-based logging.

## Usage

### Basic Usage

```javascript
const { createLogger } = require('./utils/logger');

// Create a named logger
const logger = createLogger('MyModule');

// Log at different levels
logger.error('Critical error occurred');
logger.warn('Warning message');
logger.info('Information message');
logger.debug('Debug information');
logger.trace('Detailed trace information');
```

### Convenience Methods

```javascript
const { error, warn, info, debug, trace } = require('./utils/logger');

// Use default logger directly
error('Critical error occurred');
warn('Warning message');
info('Information message');
```

### Performance Logging

```javascript
logger.time('operation');
// ... perform operation
logger.timeEnd('operation');
```

### Child Loggers

```javascript
const parentLogger = createLogger('Parser');
const childLogger = parentLogger.child('AST');
// Logs as: [Parser:AST] message
```

## Configuration

### Environment Variables

- `NODE_ENV=production` - Disables logging by default in production
- `DAEDALUS_LOG_ENABLED=true/false` - Override logging enable/disable
- `DAEDALUS_LOG_LEVEL=error|warn|info|debug|trace` - Set log level

### Log Levels

1. **ERROR** (0) - Critical errors only
2. **WARN** (1) - Warnings and errors
3. **INFO** (2) - General information, warnings, and errors
4. **DEBUG** (3) - Debug information and above
5. **TRACE** (4) - All logging including detailed traces

### Production Behavior

- Logging is **disabled by default** in production (`NODE_ENV=production`)
- Set `DAEDALUS_LOG_ENABLED=true` to enable logging in production
- Production logging defaults to WARN level to minimize performance impact

### Examples

```bash
# Enable debug logging in development
DAEDALUS_LOG_LEVEL=debug npm test

# Enable minimal logging in production
NODE_ENV=production DAEDALUS_LOG_ENABLED=true DAEDALUS_LOG_LEVEL=error npm start

# Disable all logging
DAEDALUS_LOG_ENABLED=false npm start
```

## Migration from console

The logging system has been integrated throughout the codebase, replacing direct console usage:

- `console.error()` → `logger.error()`
- `console.warn()` → `logger.warn()`
- `console.log()` → `logger.info()` or `logger.debug()`

This provides better control over output and improves production performance.