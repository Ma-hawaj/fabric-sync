import { flexRender } from '@tanstack/react-table'
import type { Row, Table as TanstackTable } from '@tanstack/react-table'
import { Fragment } from 'react'
import type * as React from 'react'

import { DataTablePagination } from '@/components/data-table/data-table-pagination'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { getColumnPinningStyle } from '@/lib/data-table'
import { cn } from '@/lib/utils'

interface DataTableProps<TData> extends React.ComponentProps<'div'> {
  table: TanstackTable<TData>
  actionBar?: React.ReactNode
  renderExpandedRow?: (row: Row<TData>) => React.ReactNode
}

export function DataTable<TData>({
  table,
  actionBar,
  renderExpandedRow,
  children,
  className,
  ...props
}: DataTableProps<TData>) {
  return (
    <div
      className={cn(
        'flex w-full flex-col gap-2.5 overflow-auto',
        renderExpandedRow && '[container-type:inline-size]',
        className,
      )}
      {...props}
    >
      {children}
      <div className="overflow-hidden rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    colSpan={header.colSpan}
                    style={{
                      ...getColumnPinningStyle({ column: header.column }),
                    }}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <Fragment key={row.id}>
                  <TableRow data-state={row.getIsSelected() && 'selected'}>
                    {row.getVisibleCells().map((cell) => (
                      <TableCell
                        key={cell.id}
                        style={{
                          ...getColumnPinningStyle({ column: cell.column }),
                        }}
                      >
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext(),
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                  {row.getIsExpanded() && renderExpandedRow && (
                    <TableRow>
                      <TableCell
                        colSpan={row.getVisibleCells().length}
                        className="bg-muted/20"
                      >
                        {/* Keep details within the visible width as columns scroll. */}
                        <div className="sticky left-0 w-[calc(100cqw-1rem)] p-2">
                          {renderExpandedRow(row)}
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={table.getAllColumns().length}
                  className="h-24 text-center"
                >
                  No results.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="flex flex-col gap-2.5">
        <DataTablePagination table={table} />
        {actionBar &&
          table.getFilteredSelectedRowModel().rows.length > 0 &&
          actionBar}
      </div>
    </div>
  )
}
