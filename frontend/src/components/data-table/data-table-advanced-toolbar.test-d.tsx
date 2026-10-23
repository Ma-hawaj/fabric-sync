import { expectTypeOf, test } from 'vitest'
import type { ColumnDef, Table } from '@tanstack/react-table'

import { DataTableAdvancedToolbar } from './data-table-advanced-toolbar'
import { useDataTable } from '@/hooks/use-data-table'
import { defineColumns } from '@/lib/define-columns'
import type { DataTableColumnId } from '@/types/data-table'

interface Item {
  title: string
  active: boolean
  unlisted: string
  contact: { phone: string }
}

const columns = defineColumns<Item>()([
  { accessorKey: 'title', cell: ({ row }) => row.original.title },
  { id: 'phase', accessorFn: (item) => (item.active ? 'active' : 'inactive') },
  { id: 'renamed', accessorKey: 'active' },
  { accessorKey: 'contact.phone' },
  { header: 'Tools', cell: () => null },
  {
    id: 'group',
    columns: [{ id: 'nested', accessorFn: (item) => item.title }],
  },
])

function useItemTable() {
  return useDataTable({ data: [] as Item[], columns })
}

declare const table: ReturnType<typeof useItemTable>['table']
declare const untypedTable: Table<Item>
declare const arbitraryId: string

test('derives IDs with TanStack precedence, nested keys, and grouped columns', () => {
  expectTypeOf<DataTableColumnId<typeof columns>>().toEqualTypeOf<
    | 'title'
    | 'phase'
    | 'renamed'
    | 'contact_phone'
    | 'Tools'
    | 'group'
    | 'nested'
  >()
  expectTypeOf<DataTableColumnId<ColumnDef<Item>[]>>().toEqualTypeOf<never>()
})

test('accepts only IDs inferred from the table', () => {
  ;<DataTableAdvancedToolbar
    table={table}
    defaultSearchColumnId="title"
    quickFilter={{ columnId: 'phase', allLabel: 'All phases' }}
  />
  ;<DataTableAdvancedToolbar
    table={table}
    // @ts-expect-error A typo must not widen the IDs inferred from the table.
    quickFilter={{ columnId: 'phaze', allLabel: 'All phases' }}
  />
  ;<DataTableAdvancedToolbar
    table={table}
    // @ts-expect-error Row fields without columns are not valid column IDs.
    quickFilter={{ columnId: 'unlisted', allLabel: 'All' }}
  />
  ;<DataTableAdvancedToolbar
    table={table}
    // @ts-expect-error The explicit ID replaces the accessor key.
    quickFilter={{ columnId: 'active', allLabel: 'All' }}
  />
  ;<DataTableAdvancedToolbar
    table={table}
    // @ts-expect-error A broad string cannot guarantee a valid column ID.
    quickFilter={{ columnId: arbitraryId, allLabel: 'All' }}
  />
  ;<DataTableAdvancedToolbar
    table={table}
    // @ts-expect-error Default searches must also refer to actual columns.
    defaultSearchColumnId="missing"
  />
  ;<DataTableAdvancedToolbar
    table={untypedTable}
    // @ts-expect-error Erased column definitions cannot prove an ID is valid.
    quickFilter={{ columnId: 'title', allLabel: 'All' }}
  />
})
