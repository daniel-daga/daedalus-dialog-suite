const baseConfig = require('./jest.config');

module.exports = {
  ...baseConfig,
  moduleNameMapper: {
    ...baseConfig.moduleNameMapper,
    'daedalus-parser/semantic-model': '<rootDir>/tests/mocks/daedalus-parser-model.ts',
    'daedalus-parser/semantic-code-generator': '<rootDir>/tests/mocks/daedalus-parser-generator.ts',
  },
};
