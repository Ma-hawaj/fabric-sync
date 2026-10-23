import type { ColumnDef } from '@tanstack/react-table'

/** Keep literal column IDs while contextually typing accessors and renderers. */
export function defineColumns<TData>() {
  return <const TColumns extends ColumnDef<TData, any>[]>(columns: TColumns) =>
    columns
}
