// @ts-check
import js from '@eslint/js'
import jsdoc from 'eslint-plugin-jsdoc'

export default [
  {
    ignores: ['node_modules/', 'coverage/', 'dist/', 'build/', '.refactoring/']
  },
  js.configs.recommended,
  jsdoc.configs['flat/recommended-typescript-flavor'],
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        console: 'readonly',
        performance: 'readonly',
        Symbol: 'readonly',
        Uint8Array: 'readonly'
      }
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // JSDoc: для проекта на // @ts-check + JSDoc — типы обязательны для публичных API,
      // но не для каждого приватного метода.
      'jsdoc/require-jsdoc': 'off',
      'jsdoc/require-param-description': 'off',
      'jsdoc/require-returns-description': 'off',
      'jsdoc/no-undefined-types': 'off',
      'jsdoc/valid-types': 'off',
      'jsdoc/tag-lines': 'off',
      'jsdoc/check-tag-names': ['warn', { definedTags: ['template'] }],
      'jsdoc/reject-any-type': 'off'
    }
  },
  {
    files: ['test/**/*.js'],
    rules: {
      'jsdoc/require-param': 'off',
      'jsdoc/require-returns': 'off'
    }
  }
]
