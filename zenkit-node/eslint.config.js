const js = require('@eslint/js');

module.exports = [
  {
    ignores: [
      'node_modules/**', 'build/**', 'vendor/**', 'vendor-build/**', 'prebuilds/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['lib/**/*.js', 'scripts/**/*.js', 'test/**/*.js'],
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
];
