//  @ts-check

import { plugin as shadcn } from '@shadcn/lint'
import { tanstackConfig } from '@tanstack/eslint-config'

export default [
  ...tanstackConfig,
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    plugins: { shadcn },
  },
  {
    name: 'shadcn/rules',
    rules: {
      'shadcn/no-restyle': [
        'error',
        {
          allow: ['layout'],
          // The app is a thin composition layer over the ui primitives. The
          // contracts below record, per primitive, which styling categories
          // app surfaces (data-table controls, filter bars, sheets, form
          // fields, sidebar) legitimately override — either because they build
          // a higher-level control or because the primitive's default variant
          // doesn't cover the compound they need.
          contracts: [
            {
              pattern: '^Button$',
              allow: [
                'layout',
                'spacing',
                'color',
                'typography',
                'shape',
                'effects',
              ],
            },
            {
              pattern: '^Badge$',
              allow: ['layout', 'spacing', 'color', 'typography', 'shape'],
            },
            {
              pattern:
                '^DropdownMenu(?:Trigger|Item|CheckboxItem|RadioItem|SubTrigger)$',
              allow: ['layout', 'spacing', 'color', 'shape', 'motion'],
            },
            {
              pattern: '^PopoverContent$',
              allow: ['layout', 'spacing'],
            },
            {
              pattern: '^Select(?:Trigger|Content|Item)$',
              allow: ['layout', 'spacing', 'color', 'shape', 'typography'],
            },
            {
              pattern: '^Input$',
              allow: [
                'layout',
                'spacing',
                'color',
                'shape',
                'typography',
                'effects',
              ],
            },
            {
              pattern: '^Combobox(?:Input|Content|Empty|Item|Trigger|List)$',
              allow: [
                'layout',
                'spacing',
                'color',
                'shape',
                'typography',
                'effects',
              ],
            },
            {
              pattern:
                '^Sheet(?:Content|Header|Title|Description|Footer|Close)$',
              allow: [
                'layout',
                'spacing',
                'color',
                'typography',
                'shape',
                'effects',
              ],
            },
            {
              pattern: '^TableCell$',
              allow: ['layout', 'typography', 'color'],
            },
            {
              pattern: '^TableHead$',
              allow: ['layout', 'typography'],
            },
            {
              pattern: '^TableRow$',
              allow: ['layout', 'color'],
            },
            {
              pattern: '^Skeleton$',
              allow: ['layout', 'shape'],
            },
            {
              pattern: '^SidebarHeader$',
              allow: ['layout', 'spacing'],
            },
          ],
        },
      ],
      // Off-token design constants (the tiny measurement/chip/diagram sizes,
      // the scrub-cursor shadow and flag rounding) are deliberate; layout
      // arbitrary values are allowed by the rule option below.
      'shadcn/no-arbitrary-values': [
        'error',
        {
          allow: [
            'layout',
            'text-[10.4px]',
            'px-[5.12px]',
            'rounded-[3.2px]',
            'text-[10px]',
            'text-[8.5px]',
            'text-[13px]',
            'drop-shadow-[0_1px_1px_#0008]',
            "[&_svg:not([class*='size-'])]:rounded-[5px]",
          ],
        },
      ],
      // Inline styles are allowed only for measurements that Tailwind utility
      // classes can't express statically (column widths fed by dynamic data,
      // and the dynamic column-count grids in form option controls).
      'shadcn/no-inline-styles': [
        'error',
        {
          allow: ['width', 'minWidth', 'gridTemplateColumns'],
        },
      ],
      'shadcn/no-raw-colors': [
        'error',
        {
          // `ring-none!` is a ring-width utility (shape), not a color, but
          // the linter's grammar reads it as a candidate theme color.
          allow: ['ring-none'],
        },
      ],
      'shadcn/no-unknown-classes': [
        'error',
        {
          // `toaster` is sonner's own root class, supplied by its stylesheet.
          allow: ['toaster'],
        },
      ],
    },
  },
  {
    name: 'shadcn/components',
    files: ['src/components/ui/**'],
    rules: {
      'shadcn/no-restyle': 'off',
      'shadcn/no-arbitrary-values': 'off',
      'shadcn/require-static-classes': 'off',
    },
  },
  {
    // Keep the CLI's generated syntax intact; app code keeps the project rules.
    name: 'shadcn/generated-style',
    files: ['src/components/ui/**', 'src/lib/utils.ts'],
    rules: {
      'import/consistent-type-specifier-style': 'off',
      'no-shadow': 'off',
    },
  },
  {
    // Upstream FieldError guards its computed error array with an optional chain.
    files: ['src/components/ui/field.tsx'],
    rules: { '@typescript-eslint/no-unnecessary-condition': 'off' },
  },
  {
    // Pinned-table and drag-and-drop geometry is computed at runtime (sticky
    // offsets and width from column state; transform/transition from drag
    // state), so the linter cannot verify those style objects statically.
    files: [
      'src/components/data-table/data-table.tsx',
      'src/components/ui/sortable.tsx',
    ],
    rules: {
      'shadcn/no-inline-styles': 'off',
    },
  },
  {
    name: 'react/named-state-hook',
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/components/ui/**', 'src/hooks/use-mobile.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'React',
          property: 'useState',
          message:
            'Import useState from react and call it directly. Keep generated shadcn files unchanged.',
        },
      ],
    },
  },
  {
    name: 'architecture/shared-boundaries',
    files: [
      'src/components/**/*.{ts,tsx}',
      'src/hooks/**/*.{ts,tsx}',
      'src/lib/**/*.{ts,tsx}',
      'src/config/**/*.{ts,tsx}',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@/features',
                '#/features',
                '**/features/**',
                '@/app',
                '#/app',
                '**/app/**',
                '@/routes',
                '#/routes',
                '**/routes/**',
              ],
              message:
                'Shared code must not depend on features, app composition, or routes. Pass configuration or move the component to its owner.',
            },
          ],
        },
      ],
    },
  },
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
    ignores: ['eslint.config.js', 'prettier.config.js'],
  },
]
