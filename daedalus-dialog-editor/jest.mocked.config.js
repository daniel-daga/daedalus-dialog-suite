// Explicit opt-in suite that always runs against the mocks, independent of
// whether daedalus-parser is installed. It layers the mock module mappings on
// the shared base config (jest.base.config.js) — it does NOT go through
// jest.config.js, so it never triggers that config's parser-presence guard.
const baseConfig = require('./jest.base.config');

module.exports = {
  ...baseConfig,
  moduleNameMapper: {
    ...baseConfig.moduleNameMapper,
    'daedalus-parser/semantic-model': '<rootDir>/tests/mocks/daedalus-parser-model.ts',
    'daedalus-parser/semantic-code-generator': '<rootDir>/tests/mocks/daedalus-parser-generator.ts',
  },
};
