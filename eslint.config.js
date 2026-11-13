import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

// The core no-unused-vars rule does not count <Component /> in JSX as a use, which buried
// real unused code under hundreds of false warnings. This marks JSX element names as used
// (what eslint-plugin-react's jsx-uses-vars does) without adding another dependency.
const jsxUsesVars = {
  meta: { type: 'problem', schema: [] },
  create(context) {
    const sourceCode = context.sourceCode
    return {
      JSXOpeningElement(node) {
        let name = node.name
        while (name.type === 'JSXMemberExpression') name = name.object // <Foo.Bar /> uses Foo
        if (name.type === 'JSXIdentifier' && !/^[a-z]/.test(name.name)) {
          sourceCode.markVariableAsUsed(name.name, node)
        }
      },
    }
  },
}

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
      local: { rules: { 'jsx-uses-vars': jsxUsesVars } },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      'local/jsx-uses-vars': 'error',
      'no-unused-vars': ['warn', { varsIgnorePattern: '^_', argsIgnorePattern: '^_', caughtErrors: 'none' }],
      // Catches names that are used but never defined (e.g. a missing constant or import),
      // which otherwise only shows up as a crash in the browser.
      'no-undef': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // New strict rule in eslint-plugin-react-hooks v7. The existing hits are intentional
      // "reset state when a modal opens / key changes" effects with loop guards; rewriting them
      // would risk regressions in the live cart/checkout. Kept visible as a warning.
      'react-hooks/set-state-in-effect': 'warn',
      'react/prop-types': 'off',
    },
  },
  {
    // Test files may use the test runner's built-in names without importing them
    files: ['src/__tests__/**/*.{js,jsx}', 'vitest.setup.js'],
    languageOptions: {
      globals: {
        describe: 'readonly', it: 'readonly', test: 'readonly', expect: 'readonly', vi: 'readonly',
        beforeEach: 'readonly', afterEach: 'readonly', beforeAll: 'readonly', afterAll: 'readonly',
      },
    },
  },
]
