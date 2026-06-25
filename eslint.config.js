import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      'eval/*.html',
      'fixtures/**/*.json',
    ],
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsparser,
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
    },
    plugins: { '@typescript-eslint': tseslint },
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          // Determinism: forbid Math.random / Date.now anywhere in shipped code.
          selector:
            "MemberExpression[object.name='Math'][property.name='random']",
          message:
            'Math.random() is forbidden (determinism rule §12). Use a seeded generator.',
        },
        {
          selector: "MemberExpression[object.name='Date'][property.name='now']",
          message: 'Date.now() is forbidden in shipped code (determinism rule §12).',
        },
      ],
    },
  },
  {
    // Tests and scripts may use time/random freely.
    files: ['**/*.test.{ts,tsx}', 'scripts/**/*.{ts,mjs}'],
    rules: { 'no-restricted-syntax': 'off' },
  },
];
