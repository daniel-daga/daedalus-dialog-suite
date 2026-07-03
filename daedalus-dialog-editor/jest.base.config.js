// Shared Jest settings for both the real-parser suite (jest.config.js) and the
// explicit mocked suite (jest.mocked.config.js). Neither the parser-presence
// guard nor the mock mappings live here — each consuming config layers its own
// concern on top, so the mocked suite stays runnable with the parser absent.
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/tests', '<rootDir>/src'],
  testMatch: ['**/*.test.ts?(x)'], // Run both .test.ts and .test.tsx
  testPathIgnorePatterns: ['/node_modules/', 'encoding.test.ts'], // Exclude encoding test (runs separately)
  moduleNameMapper: {
    '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
  },
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        jsx: 'react-jsx',
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
