const js = require('@eslint/js');

module.exports = [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        // Node.js globals
        global: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        console: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        exports: 'writable',
        module: 'writable',
        require: 'readonly',

        // Test globals
        test: 'readonly',
        assert: 'readonly'
      }
    },
    files: ['src/**/*.js', 'test/**/*.js', 'bin/**/*.js'],
    rules: {
      // Possible Errors
      'no-console': 'off', // Allow console for CLI tools and debugging
      'no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_'
      }],
      'no-undef': 'error',

      // Best Practices
      'curly': 'error',
      'eqeqeq': ['error', 'always'],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-proto': 'error',
      'no-script-url': 'error',
      'no-self-compare': 'error',
      'no-sequences': 'error',
      'no-throw-literal': 'error',
      'no-unmodified-loop-condition': 'error',
      'no-unused-expressions': 'error',
      'no-useless-call': 'error',
      'no-useless-concat': 'error',
      'no-void': 'error',
      'no-with': 'error',
      'prefer-promise-reject-errors': 'error',
      'radix': 'error',
      'wrap-iife': ['error', 'inside'],
      'yoda': 'error',

      // Stylistic Issues
      'array-bracket-spacing': ['error', 'never'],
      'block-spacing': 'error',
      'brace-style': ['error', '1tbs', { allowSingleLine: true }],
      'comma-dangle': ['error', 'never'],
      'comma-spacing': ['error', { before: false, after: true }],
      'comma-style': ['error', 'last'],
      'computed-property-spacing': ['error', 'never'],
      'eol-last': 'error',
      'func-call-spacing': ['error', 'never'],
      'indent': ['error', 2, { SwitchCase: 1 }],
      'key-spacing': ['error', { beforeColon: false, afterColon: true }],
      'keyword-spacing': 'error',
      'linebreak-style': ['error', 'unix'],
      'max-len': ['error', {
        code: 120,
        tabWidth: 2,
        ignoreUrls: true,
        ignoreStrings: true,
        ignoreTemplateLiterals: true,
        ignoreRegExpLiterals: true
      }],
      'new-cap': ['error', { newIsCap: true, capIsNew: false }],
      'new-parens': 'error',
      'no-array-constructor': 'error',
      'no-mixed-spaces-and-tabs': 'error',
      'no-multiple-empty-lines': ['error', { max: 2, maxEOF: 1 }],
      'no-new-object': 'error',
      'no-tabs': 'error',
      'no-trailing-spaces': 'error',
      'no-whitespace-before-property': 'error',
      'object-curly-spacing': ['error', 'always'],
      'operator-linebreak': ['error', 'before'],
      'padded-blocks': ['error', 'never'],
      'quote-props': ['error', 'as-needed'],
      'quotes': ['error', 'single', { avoidEscape: true }],
      'semi': ['error', 'always'],
      'semi-spacing': ['error', { before: false, after: true }],
      'space-before-blocks': 'error',
      'space-before-function-paren': ['error', 'never'],
      'space-in-parens': ['error', 'never'],
      'space-infix-ops': 'error',
      'space-unary-ops': 'error',
      'spaced-comment': ['error', 'always'],

      // ES6
      'arrow-spacing': 'error',
      'constructor-super': 'error',
      'no-class-assign': 'error',
      'no-const-assign': 'error',
      'no-dupe-class-members': 'error',
      'no-duplicate-imports': 'error',
      'no-new-symbol': 'error',
      'no-this-before-super': 'error',
      'no-useless-computed-key': 'error',
      'no-useless-constructor': 'error',
      'no-useless-rename': 'error',
      'no-var': 'error',
      'object-shorthand': 'error',
      'prefer-arrow-callback': 'error',
      'prefer-const': 'error',
      'prefer-destructuring': ['error', {
        VariableDeclarator: { array: false, object: true },
        AssignmentExpression: { array: false, object: false }
      }],
      'prefer-rest-params': 'error',
      'prefer-spread': 'error',
      'prefer-template': 'error',
      'rest-spread-spacing': ['error', 'never'],
      'template-curly-spacing': 'error'
    }
  },
  {
    // Specific overrides for test files
    files: ['test/**/*.js'],
    rules: {
      'max-len': ['error', { code: 150 }], // Allow longer lines in tests
      'no-unused-expressions': 'off' // Allow assert expressions
    }
  },
  {
    // Specific overrides for generated or vendor files
    files: ['node_modules/**', 'prebuilds/**', 'bindings/**'],
    ignores: ['node_modules/**', 'prebuilds/**', 'bindings/**']
  }
];