import type {
  ColumnDef,
  ColumnSort,
  Row,
  RowData,
  Table,
} from '@tanstack/react-table'
import type { DataTableConfig } from '@/config/data-table'
import type { FilterItemSchema } from '@/lib/parsers'

declare module '@tanstack/react-table' {
  interface TableMeta<TData extends RowData> {
    queryKeys?: QueryKeys
    advancedFilters?: boolean
  }

  interface ColumnMeta<TData extends RowData, TValue> {
    label?: string
    align?: 'start' | 'end'
    placeholder?: string
    variant?: FilterVariant
    options?: Option[]
    range?: [number, number]
    unit?: string
    icon?: React.ComponentType<React.ComponentProps<'svg'>>
  }
}

export interface QueryKeys {
  page: string
  perPage: string
  sort: string
  filters: string
  joinOperator: string
}

export interface Option {
  label: string
  value: string
  count?: number
  icon?: React.ComponentType<React.ComponentProps<'svg'>>
}

export type FilterOperator = DataTableConfig['operators'][number]
export type FilterVariant = DataTableConfig['filterVariants'][number]
export type JoinOperator = DataTableConfig['joinOperators'][number]

export interface ExtendedColumnSort<TData> extends Omit<ColumnSort, 'id'> {
  id: Extract<keyof TData, string>
}

export interface ExtendedColumnFilter<TData> extends FilterItemSchema {
  id: Extract<keyof TData, string>
}

export interface DataTableRowAction<TData> {
  row: Row<TData>
  variant: 'update' | 'delete'
}

/** The columns passed to the hook retain their IDs on the table instance. */
export type DataTableInstance<
  TData,
  TColumns extends ColumnDef<TData, any>[],
> = Table<TData> & { options: { columns: TColumns } }

type AccessorColumnId<TKey extends string> =
  TKey extends `${infer Head}.${infer Tail}`
    ? `${Head}_${AccessorColumnId<Tail>}`
    : TKey

type ColumnId<TColumn> = TColumn extends { id: infer TId extends string }
  ? TId
  : TColumn extends { accessorKey: infer TKey extends string }
    ? AccessorColumnId<TKey>
    : TColumn extends { header: infer THeader extends string }
      ? THeader
      : never

type LiteralColumnId<TColumn> =
  string extends ColumnId<TColumn> ? never : ColumnId<TColumn>

/** Follow TanStack's explicit ID, accessor key, then string header precedence. */
export type DataTableColumnId<TColumns extends readonly unknown[]> =
  TColumns[number] extends infer TColumn
    ? TColumn extends { columns: infer TChildren extends readonly unknown[] }
      ? LiteralColumnId<TColumn> | DataTableColumnId<TChildren>
      : LiteralColumnId<TColumn>
    : never
