import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'node_modules/**'] },

  eslint.configs.recommended,
  tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  {
    // The load-bearing architectural rule of this project: the simulation must stay
    // renderer-agnostic. If `three` leaks into src/sim/, the game logic stops being
    // testable headlessly and the sim/render split quietly rots. Enforce it here
    // rather than relying on discipline.
    files: ['src/sim/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'three',
              message:
                'src/sim/ must stay renderer-agnostic so it can be unit tested headlessly. Keep three.js usage in src/render/.',
            },
          ],
          patterns: [
            {
              group: ['three/*', '../render/*', '../../render/*', '**/render/**'],
              message:
                'src/sim/ must not depend on the render layer. Pass plain data outward instead.',
            },
          ],
        },
      ],
    },
  },

  {
    files: ['**/*.ts'],
    rules: {
      // Unused args are usually a real mistake, but interface-driven callbacks
      // legitimately ignore leading params. Allow the underscore convention.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },

  {
    files: ['tests/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },

  {
    // This file is plain JS and so is not part of the TypeScript program; the
    // type-aware rules have no type information to work from here.
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },

  // Must stay last so it can switch off stylistic rules that fight Prettier.
  prettier,
);
