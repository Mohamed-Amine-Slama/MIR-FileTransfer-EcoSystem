import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      'test-data/dicom/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      // Unused code is usually a half-finished refactor. Allow a leading
      // underscore for deliberately-ignored parameters.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],

      // `any` disables exactly the type checking that stops a patient id being
      // passed where a study id belongs.
      '@typescript-eslint/no-explicit-any': 'error',

      // A non-null assertion is a claim the compiler cannot verify. In this
      // codebase the thing being asserted is usually a database row that a
      // row-level-security policy may legitimately have filtered out.
      '@typescript-eslint/no-non-null-assertion': 'error',

      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },

  {
    // BUILD_SPEC P1.6 / §6: configuration is read once, through the validated
    // schema. Reading process.env directly anywhere else reintroduces exactly
    // the unvalidated, undocumented config the schema exists to eliminate —
    // and it bypasses the boot-time failure, so the mistake surfaces at
    // request time instead.
    files: ['apps/api/src/**/*.ts'],
    ignores: [
      // The config module IS the validated boundary.
      'apps/api/src/shared/config/**',
      // Bootstrap: reads env to build the config, before config exists.
      'apps/api/src/main.ts',
      // Standalone CLI tools run outside the application lifecycle entirely —
      // they have no Nest container to resolve a config service from.
      'apps/api/src/shared/db/migrate-cli.ts',
      // Test infrastructure points at a local database, and must keep working
      // when the application config is deliberately invalid.
      'apps/api/src/shared/db/testing/**',
      'apps/api/src/**/*.test.ts',
      'apps/api/src/**/*.spec.ts',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          // Matching `process.env` itself covers every access form —
          // `process.env.X`, `process.env['X']`, and destructuring — with one
          // selector. Adding a second selector for the member access made the
          // rule report each violation twice.
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message:
            'Read configuration from the validated config service, not process.env directly ' +
            '(BUILD_SPEC P1.6). Add the variable to config.schema.ts so a missing value fails at boot.',
        },
      ],
    },
  },

  {
    files: ['**/*.test.ts', '**/*.spec.ts', 'apps/web/e2e/**/*.ts'],
    rules: {
      // Tests legitimately construct malformed input to prove it is rejected.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  {
    files: ['apps/web/**/*.tsx', 'apps/web/**/*.ts'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },

  {
    files: ['**/*.mjs', '**/*.cjs', 'scripts/**/*.mjs', 'test-data/**/*.mjs'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);
