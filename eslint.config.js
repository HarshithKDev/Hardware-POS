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
      ...js.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      // We are downgrading unused variables to a warning and telling it to ignore 'React'
      'no-unused-vars': ['warn', { varsIgnorePattern: '^[A-Z_]|React' }],
      // We are turning off the strict dependency checker for background hooks
      'react-hooks/exhaustive-deps': 'off',
      // We turn off prop-types (a strict data validation rule)
      'react/prop-types': 'off',
    },
  },
]