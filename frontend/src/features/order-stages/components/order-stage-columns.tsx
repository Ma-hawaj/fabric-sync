import { Link } from '@tanstack/react-router'
import { PencilIcon, PowerIcon } from 'lucide-react'
import type { ColumnDef } from '@tanstack/react-table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import type { OrderStage } from '../types/order-stage'

export const DELIVERIES_ONLY_LABEL = 'Deliveries only'
export const EVERY_ORDER_LABEL = 'Every order'

export function appliesToLabel(stage: OrderStage): string {
  return stage.requiresDelivery ? DELIVERIES_ONLY_LABEL : EVERY_ORDER_LABEL
}

// Shared by the "Applies to" and "Status" columns: both filter an array-valued
// cell against the multiSelect toolbar filter, which hands over a string[].
function matchesAnySelected(cellValue: string[], filterValue: unknown) {
  if (
    !filterValue ||
    (Array.isArray(filterValue) && filterValue.length === 0)
  ) {
    return true
  }
  return (filterValue as string[]).some((value) => cellValue.includes(value))
}

export const getOrderStageColumns = (
  onToggleActive: (stage: OrderStage) => void,
  isToggling: boolean,
): ColumnDef<OrderStage, any>[] => [
  {
    accessorKey: 'sortOrder',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Position" />
    ),
    cell: ({ row }) => (
      <div className="font-mono">{row.getValue('sortOrder')}</div>
    ),
    enableSorting: true,
    enableColumnFilter: false,
    meta: { label: 'Position', variant: 'number' },
  },
  {
    accessorKey: 'name',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Stage" />
    ),
    cell: ({ row }) => (
      <div className="font-medium">{row.getValue('name')}</div>
    ),
    enableSorting: true,
    enableColumnFilter: true,
    filterFn: (row, columnId, filterValue) => {
      const val = row.getValue<string>(columnId)
      return val.toLowerCase().includes(String(filterValue).toLowerCase())
    },
    meta: {
      label: 'Stage',
      placeholder: 'Filter stage...',
      variant: 'text',
    },
  },
  {
    id: 'appliesTo',
    accessorFn: (stage) => [appliesToLabel(stage)],
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Applies To" />
    ),
    cell: ({ row }) => (
      <Badge variant="outline">{appliesToLabel(row.original)}</Badge>
    ),
    enableSorting: false,
    enableColumnFilter: true,
    filterFn: (row, columnId, filterValue) =>
      matchesAnySelected(row.getValue<string[]>(columnId), filterValue),
    meta: {
      label: 'Applies To',
      placeholder: 'Filter...',
      variant: 'multiSelect',
      options: [
        { label: EVERY_ORDER_LABEL, value: EVERY_ORDER_LABEL },
        { label: DELIVERIES_ONLY_LABEL, value: DELIVERIES_ONLY_LABEL },
      ],
    },
  },
  {
    id: 'status',
    accessorFn: (stage) => [stage.isActive ? 'Active' : 'Retired'],
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Status" />
    ),
    cell: ({ row }) =>
      row.original.isActive ? (
        <Badge variant="secondary">Active</Badge>
      ) : (
        <Badge variant="outline" className="text-muted-foreground">
          Retired
        </Badge>
      ),
    enableSorting: false,
    enableColumnFilter: true,
    filterFn: (row, columnId, filterValue) =>
      matchesAnySelected(row.getValue<string[]>(columnId), filterValue),
    meta: {
      label: 'Status',
      placeholder: 'Filter status...',
      variant: 'multiSelect',
      options: [
        { label: 'Active', value: 'Active' },
        { label: 'Retired', value: 'Retired' },
      ],
    },
  },
  {
    id: 'actions',
    header: 'Actions',
    cell: ({ row }) => (
      <div className="flex items-center gap-1">
        <Button
          nativeButton={false}
          variant="ghost"
          size="sm"
          className="h-8 w-auto px-2"
          render={
            <Link
              to="/order-stages/$stageId/edit"
              params={{ stageId: row.original.id }}
            />
          }
        >
          <PencilIcon className="mr-1.5 h-4 w-4" />
          Edit
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={isToggling}
          onClick={() => onToggleActive(row.original)}
          className="h-8 w-auto px-2"
        >
          <PowerIcon className="mr-1.5 h-4 w-4" />
          {row.original.isActive ? 'Retire' : 'Restore'}
        </Button>
      </div>
    ),
  },
]
