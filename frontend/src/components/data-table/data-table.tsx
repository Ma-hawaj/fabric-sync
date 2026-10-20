import { flexRender } from '@tanstack/react-table'
import type { Row, Table as TanstackTable } from '@tanstack/react-table'
import { Fragment, useEffect, useRef, useState } from 'react'
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
import { TableAppearanceContext } from './table-appearance'
import type { TableDensity } from './table-appearance'

interface DataTableProps<TData> extends React.ComponentProps<'div'> {
  table: TanstackTable<TData>
  actionBar?: React.ReactNode
  renderExpandedRow?: (row: Row<TData>) => React.ReactNode
  isLoading?: boolean
}

export function DataTable<TData>({
  table,
  actionBar,
  renderExpandedRow,
  children,
  className,
  isLoading = false,
  ...props
}: DataTableProps<TData>) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [density, setDensityState] = useState<TableDensity>(() => {
    try {
      return localStorage.getItem('fabric-sync:density') === 'comfortable'
        ? 'comfortable'
        : 'compact'
    } catch {
      return 'compact'
    }
  })
  const setDensity = (next: TableDensity) => {
    setDensityState(next)
    try {
      localStorage.setItem('fabric-sync:density', next)
    } catch {
      /* Optional browser preference. */
    }
  }
  const { pageIndex, pageSize } = table.getState().pagination
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [pageIndex, pageSize])

  return (
    <TableAppearanceContext.Provider value={{ density, setDensity }}>
      <div
        data-density={density}
        aria-busy={isLoading}
        className={cn(
          'group/data-table flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden rounded-lg border bg-background',
          renderExpandedRow && '[container-type:inline-size]',
          className,
        )}
        {...props}
      >
        {children}
        <Table
          containerRef={scrollRef}
          containerClassName="min-h-0 flex-1 overflow-auto overscroll-contain"
          className="min-w-full table-fixed"
          style={{ width: table.getTotalSize() }}
          aria-label="Records"
        >
          <TableHeader className="sticky top-0 z-20">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    colSpan={header.colSpan}
                    style={{
                      ...getColumnPinningStyle({ column: header.column }),
                    }}
                    data-pinned={header.column.getIsPinned() || undefined}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                    {header.column.getCanResize() && (
                      <div
                        role="separator"
                        aria-orientation="vertical"
                        aria-label={`Resize ${header.column.columnDef.meta?.label ?? header.column.id} column`}
                        tabIndex={0}
                        onMouseDown={header.getResizeHandler()}
                        onTouchStart={header.getResizeHandler()}
                        onDoubleClick={() => header.column.resetSize()}
                        onKeyDown={(event) => {
                          if (
                            event.key !== 'ArrowLeft' &&
                            event.key !== 'ArrowRight'
                          )
                            return
                          event.preventDefault()
                          table.setColumnSizing((previous) => ({
                            ...previous,
                            [header.column.id]: Math.max(
                              64,
                              Math.min(
                                600,
                                header.column.getSize() +
                                  (event.key === 'ArrowRight' ? 10 : -10),
                              ),
                            ),
                          }))
                        }}
                        className="absolute inset-y-0 end-0 w-[5px] cursor-col-resize touch-none hover:bg-ring focus-visible:bg-ring"
                      />
                    )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 8 }, (_, index) => (
                <TableRow key={index}>
                  {table.getVisibleLeafColumns().map((column) => (
                    <TableCell key={column.id}>
                      <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <Fragment key={row.id}>
                  <TableRow data-state={row.getIsSelected() && 'selected'}>
                    {row.getVisibleCells().map((cell) => (
                      <TableCell
                        key={cell.id}
                        title={
                          typeof cell.getValue() === 'string'
                            ? cell.getValue<string>()
                            : undefined
                        }
                        data-pinned={cell.column.getIsPinned() || undefined}
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
        <div className="shrink-0 border-t bg-background px-3 py-2">
          <DataTablePagination table={table} />
          {actionBar &&
            table.getFilteredSelectedRowModel().rows.length > 0 &&
            actionBar}
        </div>
      </div>
    </TableAppearanceContext.Provider>
  )
}
