const fs = require('fs');
const path = require('path');

// Check if daedalus-parser is available (either in node_modules or as a sibling)
// We check node_modules first because that's where the code imports it from
const daedalusParserPath = path.resolve(__dirname, 'node_modules/daedalus-parser');
const daedalusParserRootPath = path.resolve(__dirname, '../node_modules/daedalus-parser');
// existsSync returns false for broken symlinks
const hasDaedalusParser = fs.existsSync(daedalusParserPath) || fs.existsSync(daedalusParserRootPath);

const moduleNameMapper = {
  '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
};

// Only use mocks if the real parser is not available
if (!hasDaedalusParser) {
  console.log('Using mocks for daedalus-parser');
  moduleNameMapper['^daedalus-parser/semantic-code-generator$'] = '<rootDir>/tests/mocks/semantic-code-generator.ts';
  moduleNameMapper['^daedalus-parser/semantic-model$'] = '<rootDir>/tests/mocks/semantic-model.ts';
}

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/tests', '<rootDir>/src'],
  testMatch: ['**/*.test.ts?(x)'], // Run both .test.ts and .test.tsx
  testPathIgnorePatterns: ['/node_modules/', 'encoding.test.ts'], // Exclude encoding test (runs separately)
  moduleNameMapper: moduleNameMapper,
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        jsx: 'react',
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
      }
    }]
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/main/main.ts',
  ],
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/tests/',
  ],
};
