const fs = require('fs');
const path = require('path');

const baseConfig = require('./jest.base.config');

// The default suite runs against the REAL parser. If daedalus-parser is missing
// (e.g. a broken/partial install) we fail loudly instead of silently mapping to
// mocks — a green "real-parser" suite running on mocks is a QA hazard. The
// explicit mocked suite lives in jest.mocked.config.js (npm run test:mocked).
const daedalusParserPath = path.resolve(__dirname, 'node_modules/daedalus-parser');
const daedalusParserRootPath = path.resolve(__dirname, '../node_modules/daedalus-parser');
// existsSync returns false for broken symlinks
const hasDaedalusParser = fs.existsSync(daedalusParserPath) || fs.existsSync(daedalusParserRootPath);

if (!hasDaedalusParser) {
  throw new Error('daedalus-parser is not installed — run pnpm install. For the mocked suite use npm run test:mocked.');
}

module.exports = baseConfig;
