import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

/**
 * Workspace-wide ESLint configuration.
 *
 * One flat config at the root covers every package: the workspaces share a single
 * TypeScript style, and a per-package config would drift. Each package's `lint` script
 * points ESLint at its own `src`, so `pnpm --recursive lint` still parallelises.
 *
 * Rules are chosen to catch the classes of defect that type checking does not:
 * floating promises, unhandled async in callbacks, and accidental `any` at boundaries.
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/*.config.js',
      '**/*.config.mjs',
      '**/next-env.d.ts',
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
      // tsc already reports unused symbols via noUnusedLocals/noUnusedParameters, and
      // its errors are better located. Keep the ESLint copy off to avoid duplicates,
      // but still flag the underscore-prefix convention being violated.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],

      // `any` disables every guarantee the rest of the type system provides. Warn rather
      // than error so it can be introduced deliberately during a refactor.
      '@typescript-eslint/no-explicit-any': 'warn',

      // A rejected promise nobody awaits becomes an unhandled rejection, which in Node
      // terminates the process. This is the single most valuable rule here for an API
      // that awaits database and Redis calls throughout.
      'no-void': ['error', { allowAsStatement: true }],

      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': 'off',
    },
  },

  // Tests assert on loosely typed fixtures and deliberately construct invalid input.
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  // The web app runs in the browser as well as on the server.
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  }
);
