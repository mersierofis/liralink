// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

const MONEY = 'Money is a decimal string end to end: use the helpers in src/common/money.ts.';

export default tseslint.config(
  { ignores: ['dist/', 'coverage/', 'src/generated/', 'eslint.config.mjs'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-restricted-globals': [
        'error',
        { name: 'parseFloat', message: MONEY },
        { name: 'parseInt', message: MONEY },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Number', property: 'parseFloat', message: MONEY },
        { object: 'Number', property: 'parseInt', message: MONEY },
      ],
      'no-restricted-syntax': [
        'error',
        { selector: "CallExpression[callee.name='Number']", message: MONEY },
        { selector: "CallExpression[callee.property.name='toNumber']", message: MONEY },
        { selector: "UnaryExpression[operator='+'][argument.type!='Literal']", message: MONEY },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [{ name: 'decimal.js', message: `${MONEY} Only that file imports decimal.js.` }],
          patterns: [{ group: ['@prisma/client/runtime/*'], message: MONEY }],
        },
      ],
    },
  },
  {
    files: ['src/common/money.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
);
