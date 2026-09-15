//  @ts-check

import { tanstackConfig } from '@tanstack/eslint-config'

export default [
  ...tanstackConfig,
  {
    rules: {
      'import/no-cycle': 'off',
      'import/order': 'off',
      'sort-imports': 'off',
      '@typescript-eslint/array-type': 'off',
      '@typescript-eslint/require-await': 'off',
      'pnpm/json-enforce-catalog': 'off',
    },
  },
  {
    // Emitted by `pnpm exec shadcn add chart` and kept as the CLI writes it so
    // it can be regenerated. Its optional chains guard shapes that recharts'
    // types describe more optimistically than they behave — a tooltip label is
    // looked up in a config Record that usually does not hold it — so these
    // type-driven rules would "fix away" guards that do real work at runtime.
    files: ['src/components/ui/chart.tsx'],
    rules: {
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      'no-shadow': 'off',
    },
  },
  {
    ignores: ['eslint.config.js', 'prettier.config.js'],
  },
]
