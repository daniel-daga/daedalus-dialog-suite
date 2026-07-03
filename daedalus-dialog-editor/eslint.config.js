const js = require('@eslint/js');
const tseslint = require('typescript-eslint');
const reactHooks = require('eslint-plugin-react-hooks');
const globals = require('globals');

const tsFiles = ['src/**/*.{ts,tsx}', 'tests/**/*.{ts,tsx}'];

module.exports = [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'build/**',
      'out/**',
      'coverage/**',
      'playwright-report/**',
      'blob-report/**',
      'all-blob-reports/**',
      'test-results/**'
    ]
  },
  // Base recommended rule sets for TypeScript sources and tests
  // (non-type-checked; type-checked lint is a follow-up).
  { ...js.configs.recommended, files: tsFiles },
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: tsFiles
  })),
  // React hooks recommended rules (rules-of-hooks: error, exhaustive-deps: warn).
  { ...reactHooks.configs['recommended-latest'], files: tsFiles },
  // Environments
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } }
  },
  {
    files: ['src/main/**/*.ts', 'src/shared/**/*.ts', 'scripts/**/*.js'],
    languageOptions: { globals: { ...globals.node } }
  },
  {
    files: ['tests/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node, ...globals.jest }
    }
  },
  // Node scripts: recommended JS rules only (no TS parser needed).
  { ...js.configs.recommended, files: ['scripts/**/*.js'] },
  // Shared rule tuning (parser parity)
  {
    files: tsFiles,
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_'
      }],
      // TODO: many deliberate `any`s across renderer/main paths (litegraph,
      // IPC payloads, semantic-model interop). Re-enable once those are typed.
      '@typescript-eslint/no-explicit-any': 'off'
    }
  }
];
