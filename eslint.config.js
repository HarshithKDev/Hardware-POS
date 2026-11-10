import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

export default [
  { ignores: ['dist'] },
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      'no-unused-vars': ['warn', { varsIgnorePattern: '^_', argsIgnorePattern: '^_' }],
      'react-hooks/exhaustive-deps': 'warn',
      // New strict rule in eslint-plugin-react-hooks v7. The existing hits are intentional
      // "reset state when a modal opens / key changes" effects with loop guards; rewriting them
      // would risk regressions in the live cart/checkout. Kept visible as a warning.
      'react-hooks/set-state-in-effect': 'warn',
      'react/prop-types': 'off',
    },
  },
]