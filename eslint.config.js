import js from '@eslint/js';
import globals from 'globals';
import reactPlugin from 'eslint-plugin-react';

export default [
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  js.configs.recommended,

  // src/core — pure scheduling engine. Zero DOM imports (SPEC §12). The lint
  // rule is the enforcement mentioned in the spec: no React/JSX/CSS imports,
  // no direct `document` DOM access. Guarded global access (window.storage /
  // localStorage via typeof checks) is allowed — that is how StorageAdapter
  // feature-detects backends without importing the DOM.
  {
    files: ['src/core/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['react', 'react-dom', 'react/*', 'react-dom/*'], message: 'src/core is pure JS — no React imports.' },
            { group: ['*.jsx', '*.css', '*.scss'], message: 'src/core is pure JS — no UI imports.' },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        { selector: "MemberExpression[object.name='document']", message: 'src/core is pure JS — no DOM (document) access.' },
      ],
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },

  // UI + tests. The react plugin's jsx-uses-vars rule teaches no-unused-vars to
  // count JSX references, so imported components aren't flagged as unused.
  {
    files: ['src/**/*.{js,jsx}', 'tests/**/*.{js,jsx}'],
    plugins: { react: reactPlugin },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      'react/jsx-uses-vars': 'error',
      'react/jsx-uses-react': 'error',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
];
