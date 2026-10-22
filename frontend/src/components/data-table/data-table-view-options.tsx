'use client'

import type { Table } from '@tanstack/react-table'
import { Settings2 } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { useTableAppearance } from './table-appearance'

interface DataTableViewOptionsProps<TData> extends React.ComponentProps<
  typeof PopoverContent
> {
  table: Table<TData>
  disabled?: boolean
}

export function DataTableViewOptions<TData>({
  table,
  disabled,
  className,
  ...props
}: DataTableViewOptionsProps<TData>) {
  const { density, setDensity } = useTableAppearance()
  const tableColumns = table.getAllColumns()
  const columns = React.useMemo(
    () =>
      tableColumns.filter(
        (column) =>
          typeof column.accessorFn !== 'undefined' && column.getCanHide(),
      ),
    [tableColumns],
  )

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            aria-label="Toggle columns"
            role="combobox"
            variant="outline"
            className="ms-auto h-8 font-normal"
            disabled={disabled}
          />
        }
      >
        <Settings2 className="text-muted-foreground" />
        Display
      </PopoverTrigger>
      <PopoverContent className={cn('w-60 gap-0 p-0', className)} {...props}>
        <div className="space-y-2 border-b p-3">
          <p className="text-xs font-medium text-muted-foreground">
            Row density
          </p>
          <div className="flex gap-1" role="group" aria-label="Row density">
            {(['compact', 'comfortable'] as const).map((value) => (
              <Button
                key={value}
                size="sm"
                variant={density === value ? 'secondary' : 'ghost'}
                aria-pressed={density === value}
                onClick={() => setDensity(value)}
                className="flex-1 capitalize"
              >
                {value === 'compact' ? 'Compact' : 'Comfortable'}
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Drag a column edge to resize.
          </p>
        </div>
        <Command>
          <CommandInput placeholder="Search columns..." />
          <CommandList>
            <CommandEmpty>No columns found.</CommandEmpty>
            <CommandGroup>
              {columns.map((column) => (
                <CommandItem
                  key={column.id}
                  data-checked={column.getIsVisible()}
                  onSelect={() =>
                    column.toggleVisibility(!column.getIsVisible())
                  }
                >
                  <span className="truncate">
                    {column.columnDef.meta?.label ?? column.id}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
        <div className="border-t p-2">
          <Button
            variant="ghost"
            size="sm"
            className="w-full"
            onClick={() => {
              table.resetColumnVisibility()
              table.resetColumnSizing()
              setDensity('compact')
            }}
          >
            Reset display
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
