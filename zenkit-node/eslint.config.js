const js = require('@eslint/js');

module.exports = [
  {
    ignores: [
      'node_modules/**', 'build/**', 'vendor/**', 'vendor-build/**', 'prebuilds/**',
      'spike/*/node_modules/**', 'spike/*/payload/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['lib/**/*.js', 'scripts/**/*.js', 'test/**/*.js',
      'spike/*/extract.js', 'spike/*/serve.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        module: 'writable',
        exports: 'writable',
        require: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // The viewport spike's browser half: an ES module that runs in a page, not
    // in node. Linted like everything else — a throwaway instrument still has
    // to be a correct one.
    files: ['spike/*/main.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        console: 'readonly',
        document: 'readonly',
        window: 'readonly',
        fetch: 'readonly',
        performance: 'readonly',
        requestAnimationFrame: 'readonly',
        setTimeout: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
];
