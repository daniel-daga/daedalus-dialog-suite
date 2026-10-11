// Node environment, not jsdom: zen-world is pure domain logic and must never
// acquire a dependency on a DOM being there (level-editor.md §6).
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test', '<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
};
