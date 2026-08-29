const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
    plugins: {
      // Placeholder so pre-existing inline `eslint-disable import/*` directives
      // resolve without pulling in the full eslint-plugin-import dependency.
      import: {
        rules: {
          'no-unresolved': { create: () => ({}) },
        },
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': 'off',
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'warn',
      'no-constant-condition': ['warn', { checkLoops: false }],
      'no-unused-private-class-members': 'off',
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
    linterOptions: {
      reportUnusedDisableDirectives: false,
    },
  },
  {
    ignores: ['node_modules/', 'prisma/migrations/', 'src/data/scout/'],
  },
];
